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
 *      a shared password, checked against the frontend's login screen.
 *      You can also set SITE_PASSWORD_2 and SITE_PASSWORD_3 (both optional)
 *      to allow up to 3 different valid passwords.
 *      If none of the three are set, the password gate is disabled (any
 *      request is allowed).
 *   4. (optional) set ALLOWED_ORIGIN in wrangler.toml to your GitHub Pages
 *      / custom domain to restrict who can call this worker.
 *   5. (optional) wrangler secret put TAVILY_API_KEY — get a free key at
 *      https://app.tavily.com/home. Grounds the model's answer in real web
 *      search results when the frontend asks for it (automatically, for
 *      messages that look like they need live/current info, and always
 *      alongside groq/compound's own built-in search). If not set, web
 *      search requests are silently skipped and the model answers from its
 *      own knowledge as before.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length);
  let result = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return result === 0;
}

function extractMessageText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === "text");
    return textPart ? textPart.text : "";
  }
  return "";
}

async function tavilySearch(apiKey, query) {
  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, search_depth: "basic", max_results: 5, include_answer: false }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : null;
}

function formatSearchResults(results) {
  return results
    .map((r, i) => `${i + 1}. ${r.title || r.url} (${r.url})\n${(r.content || "").slice(0, 500)}`)
    .join("\n\n");
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

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      // No chat messages: this is just a login check from the frontend.
      // The password already passed above, so confirm success without
      // spending a Groq request.
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const modelId = body.model || "openai/gpt-oss-120b";
    const messages = body.messages.slice();

    if (body.webSearch && env.TAVILY_API_KEY) {
      const lastMessage = messages[messages.length - 1];
      const query = extractMessageText(lastMessage && lastMessage.content);
      if (query) {
        try {
          const results = await tavilySearch(env.TAVILY_API_KEY, query);
          if (results && results.length) {
            // Insert as a system message right before the current user
            // message (not after) so the last message stays the user's
            // turn — required for the image-content-array case, and it
            // also keeps the search context closest to the question it's
            // meant to help answer.
            messages.splice(messages.length - 1, 0, {
              role: "system",
              content:
                "Risultati di ricerca web aggiornati (fonte: Tavily). Usali se pertinenti per rispondere in modo accurato e aggiornato, citando le fonti quando utile:\n\n" +
                formatSearchResults(results),
            });
          }
        } catch (e) {
          // Web search is best-effort: if Tavily is down or errors out,
          // continue without it rather than failing the whole chat request.
        }
      }
    }

    const groqPayload = {
      model: modelId,
      messages: messages,
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
