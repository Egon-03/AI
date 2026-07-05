/**
 * Grassi AI — Cloudflare Worker proxy for Groq and OpenRouter.
 *
 * This worker exists so API keys never have to live in the browser. The
 * frontend calls this worker, the worker attaches the right secret key and
 * forwards the request to the chosen provider, streaming the response
 * straight back.
 *
 * Setup:
 *   1. wrangler deploy
 *   2. wrangler secret put GROQ_API_KEY
 *   3. (optional) wrangler secret put SITE_PASSWORD — protects the site with
 *      a shared password, checked against the frontend's login screen.
 *      You can also set SITE_PASSWORD_2 and SITE_PASSWORD_3 (both optional)
 *      to allow up to 3 different valid passwords.
 *      If none of the three are set, the password gate is disabled (any
 *      request is allowed).
 *   4. (optional) set ALLOWED_ORIGIN in wrangler.toml to your GitHub Pages
 *      / custom domain to restrict who can call this worker.
 *   5. (optional) wrangler secret put OPENROUTER_API_KEY — get a free key at
 *      https://openrouter.ai/. Adds a second provider alongside Groq: the
 *      frontend's model menu lists OpenRouter's currently free models
 *      (fetched live from OpenRouter, so it never goes stale) under their
 *      own group. If not set, that group is simply left empty.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models";

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let result = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    if (!env.GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY is not configured on this worker. Run: wrangler secret put GROQ_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Up to 3 valid passwords — SITE_PASSWORD_2 and SITE_PASSWORD_3 are
    // both optional. If none of the three secrets are set, the gate stays
    // disabled (same behavior as before).
    const validPasswords = [env.SITE_PASSWORD, env.SITE_PASSWORD_2, env.SITE_PASSWORD_3].filter(Boolean);
    if (validPasswords.length > 0) {
      const provided = String(body.password || "");
      const isValid = validPasswords.some((pw) => timingSafeEqual(provided, pw));
      if (!isValid) {
        return new Response(JSON.stringify({ error: "Wrong password" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body.listModels === "openrouter") {
      if (!env.OPENROUTER_API_KEY) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      try {
        const res = await fetch(OPENROUTER_MODELS_ENDPOINT);
        const data = res.ok ? await res.json() : null;
        const models = ((data && data.data) || [])
          .filter((m) => m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0)
          .map((m) => ({ id: m.id, label: m.name || m.id }))
          .sort((a, b) => a.label.localeCompare(b.label));
        return new Response(JSON.stringify({ models }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (e) {
        // Listing is best-effort: if OpenRouter is unreachable, the frontend
        // just won't show the OpenRouter group for this session.
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      // No chat messages: this is just a login check from the frontend.
      // The password already passed above, so confirm success without
      // spending a request against either provider.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = body.provider === "openrouter" ? "openrouter" : "groq";

    if (provider === "openrouter" && !env.OPENROUTER_API_KEY) {
      return new Response(
        JSON.stringify({ error: "OPENROUTER_API_KEY is not configured on this worker. Run: wrangler secret put OPENROUTER_API_KEY" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const endpoint = provider === "openrouter" ? OPENROUTER_ENDPOINT : GROQ_ENDPOINT;
    const apiKey = provider === "openrouter" ? env.OPENROUTER_API_KEY : env.GROQ_API_KEY;
    const providerHeaders =
      provider === "openrouter"
        ? { "HTTP-Referer": env.ALLOWED_ORIGIN || "https://openrouter.ai", "X-Title": "Grassi AI" }
        : {};

    const chatPayload = {
      model: body.model || "openai/gpt-oss-120b",
      messages: body.messages,
      stream: true,
      temperature: 0.7,
      // No max_tokens cap: let each provider use its own default ceiling.
      // A fixed low cap (this used to be 2048) silently truncates long
      // code/calculation answers mid-stream with no closing ``` or \],
      // which then renders as broken raw markdown instead of a code
      // block or formula.
    };

    const providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...providerHeaders,
      },
      body: JSON.stringify(chatPayload),
    });

    if (!providerResponse.ok || !providerResponse.body) {
      const errText = await providerResponse.text();
      return new Response(errText, {
        status: providerResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(providerResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  },
};
