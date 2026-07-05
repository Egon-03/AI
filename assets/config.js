// Configurazione dell'app — modifica questi valori con i tuoi dati.
window.APP_CONFIG = {
  // Nome mostrato nell'interfaccia.
  appName: "Grassi AI",

  // URL del Cloudflare Worker che fa da proxy verso l'API Groq.
  // Dopo aver eseguito `wrangler deploy` nella cartella /worker, incolla qui
  // l'URL stampato in console (es. "https://grassi-ai-proxy.tuonome.workers.dev").
  workerUrl: "https://grassi-ai-proxy.egon-grassi2003.workers.dev/",

  // Modello Groq usato di default. Vedi https://console.groq.com/docs/models
  // (llama-3.3-70b-versatile è stato dichiarato deprecato da Groq il 17/06/2026,
  // dismissione prevista ad agosto 2026 — gpt-oss-120b è il sostituto consigliato).
  model: "openai/gpt-oss-120b",

  // Modelli selezionabili dal menu nell'header. "id" è il nome esatto del
  // modello per l'API Groq, "label" è il nome mostrato nell'interfaccia.
  models: [
    { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
    { id: "moonshotai/kimi-k2-instruct-0905", label: "Kimi K2" },
  ],

  // Messaggio di sistema che definisce la personalit&agrave; dell'assistente.
  systemPrompt:
    "Sei Grassi AI, un assistente AI utile, chiaro e amichevole. Rispondi in modo conciso ma completo, usa il markdown quando utile (elenchi, codice, grassetto) e rispondi nella lingua dell'utente.",
};
