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
 *   3. (optional) set ALLOWED_ORIGIN in wrangler.toml to your GitHub Pages
 *      / custom domain to restrict who can call this worker.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

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

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing 'messages' array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const groqPayload = {
      model: body.model || "llama-3.3-70b-versatile",
      messages: body.messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 2048,
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
