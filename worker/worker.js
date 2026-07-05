/**
 * Grassi AI — Cloudflare Worker proxy for the Groq API.
 *
 * This worker exists so the Groq API key never has to live in the browser.
 * The frontend calls this worker, the worker attaches the secret key and
 * forwards the request to Groq, streaming the response straight back.
 *
 * Setup:
 *   1. wrangler deploy
 *   2. wrangler secret put GROQ_API_KEY
 *   3. (optional) wrangler secret put SITE_PASSWORD — protects the site with
 *      a single shared password, checked against the frontend's login screen.
 *      If not set, the password gate is disabled (any request is allowed).
 *   4. (optional) set ALLOWED_ORIGIN in wrangler.toml to your GitHub Pages
 *      / custom domain to restrict who can call this worker.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

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

    if (env.SITE_PASSWORD && !timingSafeEqual(String(body.password || ""), env.SITE_PASSWORD)) {
      return new Response(JSON.stringify({ error: "Wrong password" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      // No chat messages: this is just a login check from the frontend.
      // The password already passed above, so confirm success without
      // spending a Groq request.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqPayload = {
      model: body.model || "openai/gpt-oss-120b",
      messages: body.messages,
      stream: true,
      temperature: 0.7,
      // No max_tokens cap: let Groq use each model's own default ceiling.
      // A fixed low cap (this used to be 2048) silently truncates long
      // code/calculation answers mid-stream with no closing ``` or \],
      // which then renders as broken raw markdown instead of a code
      // block or formula.
    };

    const groqResponse = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(groqPayload),
    });

    if (!groqResponse.ok || !groqResponse.body) {
      const errText = await groqResponse.text();
      return new Response(errText, {
        status: groqResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(groqResponse.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  },
};
