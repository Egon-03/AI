# Grassi AI — AI Chat

Un'interfaccia di chat AI in stile Claude / ChatGPT / Copilot: sidebar con cronologia, risposte in streaming, rendering markdown (elenchi, grassetto, blocchi di codice con pulsante copia), tema chiaro/scuro automatico, completamente responsive.

Frontend statico (HTML/CSS/JS puro, nessuna build) + un piccolo **Cloudflare Worker** che fa da proxy verso l'API di [Groq](https://console.groq.com/) per non esporre mai la chiave API nel browser.

## Struttura del progetto

```
index.html              pagina principale
assets/config.js         configurazione (nome app, URL del worker, modello)
assets/styles.css        stile
assets/app.js             logica della chat, rendering markdown, streaming
worker/worker.js          Cloudflare Worker (proxy verso Groq)
worker/wrangler.toml      configurazione del worker
.github/workflows/        pubblicazione automatica su GitHub Pages
```

## 1. Ottieni una API key Groq

1. Vai su [console.groq.com](https://console.groq.com/keys) e crea un account gratuito.
2. Crea una nuova API key e copiala (inizia con `gsk_...`).

## 2. Pubblica il Cloudflare Worker (proxy)

Il Worker è necessario perché GitHub Pages serve solo file statici: se la chiave Groq finisse nel codice del browser, chiunque potrebbe rubarla dagli strumenti di sviluppo. Il Worker la tiene al sicuro sul server.

Con [wrangler](https://developers.cloudflare.com/workers/wrangler/) (richiede un account Cloudflare gratuito, nessuna carta di credito):

```bash
npm install -g wrangler
cd worker
wrangler login
wrangler deploy
wrangler secret put GROQ_API_KEY
# incolla qui la chiave copiata al passo 1 e premi invio
```

### Proteggi il sito con una password (schermata di login)

Il sito mostra sempre una schermata di login, ma finché non imposti questo secret **chiunque può entrare inserendo una password qualsiasi**. Per proteggerlo davvero:

```bash
wrangler secret put SITE_PASSWORD
# scegli e incolla qui la password che vuoi usare per accedere al sito
```

La password non finisce mai nel codice pubblico: viene verificata lato server dal Worker a ogni richiesta. Per cambiarla in futuro basta rilanciare lo stesso comando; per rimuovere del tutto la protezione, esegui `wrangler secret delete SITE_PASSWORD`.

Al termine di `wrangler deploy`, in console vedrai un URL tipo:

```
https://grassi-ai-proxy.<tuo-account>.workers.dev
```

Copialo: ti servirà al passo successivo.

> **Alternativa senza CLI**: apri [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Create Worker, incolla il contenuto di `worker/worker.js`, poi in Settings → Variables aggiungi la variabile segreta `GROQ_API_KEY`.

## 3. Collega il frontend al worker

Apri `assets/config.js` e sostituisci `workerUrl` con l'URL ottenuto al passo 2:

```js
workerUrl: "https://grassi-ai-proxy.<tuo-account>.workers.dev",
```

Puoi anche personalizzare qui il nome dell'app (`appName`), il modello Groq usato (`model` — vedi l'elenco su [console.groq.com/docs/models](https://console.groq.com/docs/models)) e il messaggio di sistema (`systemPrompt`).

Fai commit e push della modifica.

## 4. Pubblica su GitHub Pages

1. Vai su **Settings → Pages** del repository.
2. In **Source**, seleziona **Deploy from a branch**, poi scegli `main` e cartella `/ (root)`.
3. Ogni push su `main` ricostruisce automaticamente il sito su `https://<utente>.github.io/<repo>/` (o sul tuo dominio custom, se configurato).

> Non usare la sorgente "GitHub Actions" con un workflow personalizzato insieme a questa modalità: le due pubblicazioni possono entrare in conflitto e far fallire il deploy con l'errore "Deployment failed, try again later.".

## 5. Custom domain

1. Sempre in **Settings → Pages**, sotto **Custom domain**, inserisci il tuo dominio (es. `ai.grassi.swiss`) e salva.
2. Dal pannello DNS del tuo dominio, aggiungi un record:
   - **Sottodominio** (es. `ai.grassi.swiss`): record `CNAME` verso `<utente>.github.io`
   - **Dominio radice** (es. `grassi.swiss`): quattro record `A` verso gli IP di GitHub Pages (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`)
3. Attendi la propagazione DNS, poi in GitHub Pages spunta **Enforce HTTPS**.
4. Aggiorna `ALLOWED_ORIGIN` in `worker/wrangler.toml` con il tuo dominio definitivo (es. `https://ai.grassi.swiss`) e rilancia `wrangler deploy`, così solo il tuo sito potrà usare il worker.

## Sviluppo locale

Non serve alcuna build. Basta un server statico qualsiasi, ad esempio:

```bash
python3 -m http.server 8080
```

poi apri `http://localhost:8080`. Aprire `index.html` direttamente da file system (`file://`) può bloccare le chiamate di rete al worker: usa sempre un server locale.

## Come funziona

- La cronologia delle conversazioni è salvata nel `localStorage` del browser (nessun database, nessun backend oltre al worker).
- Il messaggio dell'utente viene inviato al Worker insieme a tutta la conversazione corrente; il Worker inoltra la richiesta a Groq con `stream: true` e ne trasmette la risposta man mano che arriva (Server-Sent Events), che il frontend renderizza in tempo reale.
- Il rendering markdown (grassetto, elenchi, titoli, blocchi di codice con pulsante "copia") è generato da un piccolo parser incluso in `assets/app.js`, senza dipendenze esterne.
