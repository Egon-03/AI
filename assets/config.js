// Configurazione dell'app — modifica questi valori con i tuoi dati.
window.APP_CONFIG = {
  // Nome mostrato nell'interfaccia.
  appName: "Lumen",

  // URL del Cloudflare Worker che fa da proxy verso l'API Groq.
  // Dopo aver eseguito `wrangler deploy` nella cartella /worker, incolla qui
  // l'URL stampato in console (es. "https://lumen-ai-proxy.tuonome.workers.dev").
  workerUrl: "https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev",

  // Modello Groq da usare. Vedi https://console.groq.com/docs/models
  model: "llama-3.3-70b-versatile",

  // Messaggio di sistema che definisce la personalit&agrave; dell'assistente.
  systemPrompt:
    "Sei Lumen, un assistente AI utile, chiaro e amichevole. Rispondi in modo conciso ma completo, usa il markdown quando utile (elenchi, codice, grassetto) e rispondi nella lingua dell'utente.",
};
