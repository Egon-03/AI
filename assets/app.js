(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || {};
  var STORAGE_KEY = "lumen.conversations.v1";
  var THEME_KEY = "lumen.theme";
  var AUTH_KEY = "grassiai.auth";
  var MODEL_KEY = "grassiai.model";
  var AUTO_VALUE = "auto";
  var FALLBACK_MODEL = "openai/gpt-oss-120b";
  var VISION_MODEL = "qwen/qwen3.6-27b";
  var MAX_ATTACHMENTS = 4;
  var MAX_IMAGE_DIMENSION = 1600;

  var els = {
    app: document.getElementById("app"),
    scrim: document.getElementById("scrim"),
    sidebar: document.getElementById("sidebar"),
    sidebarOpen: document.getElementById("sidebarOpen"),
    sidebarClose: document.getElementById("sidebarClose"),
    newChatBtn: document.getElementById("newChatBtn"),
    history: document.getElementById("history"),
    themeToggle: document.getElementById("themeToggle"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    headerTitle: document.getElementById("headerTitle"),
    modelBadgeText: document.getElementById("modelBadgeText"),
    modelSelect: document.getElementById("modelSelect"),
    chatScroll: document.getElementById("chatScroll"),
    welcome: document.getElementById("welcome"),
    messages: document.getElementById("messages"),
    composer: document.getElementById("composer"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    stopBtn: document.getElementById("stopBtn"),
    attachBtn: document.getElementById("attachBtn"),
    imageInput: document.getElementById("imageInput"),
    attachmentsPreview: document.getElementById("attachmentsPreview"),
    loginForm: document.getElementById("loginForm"),
    loginPassword: document.getElementById("loginPassword"),
    loginBtn: document.getElementById("loginBtn"),
    loginError: document.getElementById("loginError"),
  };

  var state = {
    conversations: [],
    currentId: null,
    streaming: false,
    abortController: null,
    pendingAttachments: [],
    openrouterModels: [],
  };

  init();

  function init() {
    loadTheme();
    loadConversations();
    bindEvents();
    bindLoginEvents();
    renderHistory();
    applyBranding();
    initModelSelect();
    if (localStorage.getItem(AUTH_KEY)) {
      document.body.classList.add("authed");
      fetchOpenRouterModels();
    }
    // Runs after the "authed" class (if any) is applied, since the composer
    // is hidden (display:none) until then and scrollHeight would read as 0.
    autoResizeTextarea();
  }

  // ---------------------------------------------------------------
  // Login / logout
  // ---------------------------------------------------------------
  function bindLoginEvents() {
    els.loginForm.addEventListener("submit", onLoginSubmit);
    els.logoutBtn.addEventListener("click", logout);
  }

  function onLoginSubmit(e) {
    e.preventDefault();
    var pw = els.loginPassword.value;
    if (!pw || els.loginBtn.disabled) return;

    els.loginBtn.disabled = true;
    els.loginError.classList.add("hidden");

    fetch(CONFIG.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pw }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("bad credentials");
        return res.json();
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error("bad credentials");
        localStorage.setItem(AUTH_KEY, pw);
        els.loginPassword.value = "";
        document.body.classList.add("authed");
        autoResizeTextarea();
        fetchOpenRouterModels();
      })
      .catch(function () {
        els.loginError.textContent = "Password errata, riprova.";
        els.loginError.classList.remove("hidden");
      })
      .finally(function () {
        els.loginBtn.disabled = false;
      });
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    document.body.classList.remove("authed");
    els.loginPassword.value = "";
    els.loginError.classList.add("hidden");
    closeSidebarMobile();
  }

  function handleUnauthorized() {
    localStorage.removeItem(AUTH_KEY);
    document.body.classList.remove("authed");
    els.loginError.textContent = "Sessione scaduta o password cambiata. Reinserisci la password.";
    els.loginError.classList.remove("hidden");
  }

  function applyBranding() {
    var name = CONFIG.appName || "Grassi AI";
    els.modelBadgeText.textContent = name;
    document.title = name + " — AI Chat";
    var brandName = document.getElementById("brandName");
    if (brandName) brandName.textContent = name;
    var welcomeHeading = document.getElementById("welcomeHeading");
    if (welcomeHeading) welcomeHeading.textContent = "Ciao, sono " + name + ".";
    var composerHint = document.getElementById("composerHint");
    if (composerHint) composerHint.textContent = name + " può commettere errori. Verifica le informazioni importanti.";
    els.input.placeholder = "Scrivi un messaggio a " + name + "...";
  }

  // ---------------------------------------------------------------
  // Model selection
  // ---------------------------------------------------------------
  function getSelectedModel() {
    return localStorage.getItem(MODEL_KEY) || CONFIG.model;
  }

  function initModelSelect() {
    renderModelOptions();
    els.modelSelect.addEventListener("change", function () {
      localStorage.setItem(MODEL_KEY, els.modelSelect.value);
    });
  }

  // Ricostruisce le <option> del menu modelli: i modelli Groq fissi da
  // config.js, seguiti (se disponibili) dai modelli gratuiti scaricati in
  // tempo reale da OpenRouter — nello stesso elenco piatto, senza un
  // gruppo/etichetta separata, così il nome del provider non compare nella UI.
  // Va tenuta separata da initModelSelect perché viene richiamata di nuovo
  // quando arriva la lista di OpenRouter, senza voler registrare due volte
  // il listener.
  function renderModelOptions() {
    var models = CONFIG.models && CONFIG.models.length ? CONFIG.models : [{ id: CONFIG.model, label: CONFIG.model }];
    var current = getSelectedModel();
    els.modelSelect.innerHTML = "";
    models.concat(state.openrouterModels).forEach(function (m) {
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      if (m.id === current) opt.selected = true;
      els.modelSelect.appendChild(opt);
    });
  }

  // Toglie il suffisso "(free)" che OpenRouter include nel nome di molti
  // modelli gratuiti — qui è ridondante, dato che questi sono già gli unici
  // modelli gratuiti che chiediamo.
  function stripFreeSuffix(label) {
    return (label || "").replace(/\s*\(free\)\s*$/i, "").trim();
  }

  // Scarica dal Worker l'elenco dei modelli attualmente gratuiti su
  // OpenRouter (prezzo 0 sia in input che in output). Richiesto in tempo
  // reale invece di essere una lista fissa in config.js perché OpenRouter
  // cambia spesso quali modelli sono gratuiti — lo stesso problema di
  // deprecazione avuto più volte con i modelli Groq, qui evitato del tutto.
  function fetchOpenRouterModels() {
    fetch(CONFIG.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listModels: "openrouter", password: localStorage.getItem(AUTH_KEY) || "" }),
    })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data && Array.isArray(data.models) && data.models.length) {
          state.openrouterModels = data.models.map(function (m) {
            return { id: m.id, label: stripFreeSuffix(m.label) };
          });
          renderModelOptions();
        }
      })
      .catch(function () {
        // Best-effort: se OpenRouter non risponde, il menu resta con i soli modelli Groq.
      });
  }

  function getModelLabel(id) {
    var found = (CONFIG.models || []).concat(state.openrouterModels).filter(function (m) { return m.id === id; })[0];
    return found ? found.label : id;
  }

  // Usato dal router "auto" (sotto): frasi che suggeriscono che la
  // risposta richieda informazioni aggiornate/live, per instradare verso
  // groq/compound (che ha una ricerca web integrata).
  var LIVE_INFO_PATTERN = /\b(oggi|adesso|in questo momento|ultime notizie|notizie recenti|prezzo attuale|quotazione|meteo|previsioni del tempo|chi ha vinto|risultati di|classifica attuale|ultima versione|cerca (su internet|online)|news)\b/;

  // Sceglie un modello reale al posto di "auto", in base al contenuto
  // dell'ultimo messaggio dell'utente. Euristica semplice e trasparente:
  // niente chiamate extra, nessun costo aggiuntivo, scelta mostrata
  // all'utente sotto la risposta.
  function pickAutoModel(text) {
    var t = (text || "").toLowerCase();

    var mathPattern = /\b(calcola|quanto fa|risolvi|equazione|integrale|derivata|percentuale)\b|\d[\d\s+\-*/^%=]{3,}\d/;
    var visionPattern = /\b(immagine|foto|screenshot|nell'immagine)\b/;
    var codePattern = /```|\b(codice|funzione|bug|debug|script|python|javascript|typescript|java|c\+\+|c#|sql|html|css|refactor|libreria|framework|regex|json|api)\b/;
    var reasoningPattern = /\b(spiega (in dettaglio|passo passo|passo per passo)|analizza|confronta|pro e contro|dimostra|argomenta|approfondisci|strategia|pianifica|valuta)\b/;

    if (LIVE_INFO_PATTERN.test(t)) return "groq/compound";
    if (codePattern.test(t)) return "qwen/qwen3.6-27b";
    if (mathPattern.test(t)) return "groq/compound";
    if (visionPattern.test(t)) return "qwen/qwen3.6-27b";
    if (reasoningPattern.test(t) || t.length > 400) return "openai/gpt-oss-120b";
    if (t.length > 0 && t.length < 60) return "openai/gpt-oss-20b";
    return "openai/gpt-oss-120b";
  }

  // ---------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------
  function loadTheme() {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    }
  }

  function toggleTheme() {
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var current = document.documentElement.getAttribute("data-theme") || (prefersDark ? "dark" : "light");
    var next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  }

  // ---------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------
  function loadConversations() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      state.conversations = raw ? JSON.parse(raw) : [];
    } catch (e) {
      state.conversations = [];
    }
  }

  function saveConversations() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
  }

  function getCurrentConversation() {
    return state.conversations.find(function (c) { return c.id === state.currentId; }) || null;
  }

  // ---------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------
  function bindEvents() {
    els.newChatBtn.addEventListener("click", function () { startNewConversation(); closeSidebarMobile(); });
    els.themeToggle.addEventListener("click", toggleTheme);
    els.clearAllBtn.addEventListener("click", function () {
      if (!state.conversations.length) return;
      if (confirm("Eliminare tutta la cronologia delle chat? L'operazione non è reversibile.")) {
        state.conversations = [];
        saveConversations();
        startNewConversation();
      }
    });

    els.sidebarOpen.addEventListener("click", function () { els.app.classList.add("sidebar-visible"); });
    els.sidebarClose.addEventListener("click", closeSidebarMobile);
    els.scrim.addEventListener("click", closeSidebarMobile);

    els.composer.addEventListener("submit", onSubmit);
    els.input.addEventListener("input", autoResizeTextarea);
    els.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        els.composer.requestSubmit();
      }
    });

    els.stopBtn.addEventListener("click", function () {
      if (state.abortController) state.abortController.abort();
    });

    els.attachBtn.addEventListener("click", function () { els.imageInput.click(); });
    els.imageInput.addEventListener("change", function () {
      addAttachments(els.imageInput.files);
      els.imageInput.value = "";
    });

    els.input.addEventListener("paste", function (e) {
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var imageFiles = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === "file" && items[i].type.indexOf("image/") === 0) {
          imageFiles.push(items[i].getAsFile());
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        addAttachments(imageFiles);
      }
    });

    els.messages.addEventListener("click", function (e) {
      var copyCodeBtn = e.target.closest(".copy-code-btn");
      if (copyCodeBtn) {
        var block = copyCodeBtn.closest(".code-block");
        var code = block.querySelector("code");
        copyToClipboard(code.textContent, copyCodeBtn, "Copia");
        return;
      }
      var copyMsgBtn = e.target.closest(".copy-msg-btn");
      if (copyMsgBtn) {
        var msgEl = copyMsgBtn.closest(".msg");
        copyToClipboard(msgEl.dataset.raw || "", copyMsgBtn, "Copia risposta");
        return;
      }
    });
  }

  function closeSidebarMobile() {
    els.app.classList.remove("sidebar-visible");
  }

  function copyToClipboard(text, btn, restoreLabel) {
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var original = btn.innerHTML;
      btn.innerHTML = "Copiato ✓";
      setTimeout(function () { btn.innerHTML = original; }, 1400);
    });
  }

  // ---------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------
  function startNewConversation() {
    state.currentId = null;
    els.messages.innerHTML = "";
    showWelcome();
    renderHistory();
    els.input.value = "";
    autoResizeTextarea();
    els.input.focus();
  }

  function showWelcome() {
    els.welcome.classList.remove("hidden");
    els.headerTitle.textContent = "Nuova chat";
  }

  function hideWelcome() {
    els.welcome.classList.add("hidden");
  }

  function selectConversation(id) {
    var convo = state.conversations.find(function (c) { return c.id === id; });
    if (!convo) return;
    state.currentId = id;
    hideWelcome();
    els.messages.innerHTML = "";
    convo.messages.forEach(function (m) { appendMessageEl(m.role, m.content, false, m.modelUsed, m.images); });
    els.headerTitle.textContent = convo.title;
    renderHistory();
    closeSidebarMobile();
    scrollToBottom(false);
  }

  function deleteConversation(id, evt) {
    if (evt) evt.stopPropagation();
    state.conversations = state.conversations.filter(function (c) { return c.id !== id; });
    saveConversations();
    if (state.currentId === id) startNewConversation();
    else renderHistory();
  }

  function renderHistory() {
    els.history.innerHTML = "";
    if (!state.conversations.length) return;

    var sorted = state.conversations.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; });
    var buckets = [
      { label: "Oggi", items: [] },
      { label: "Ieri", items: [] },
      { label: "Ultimi 7 giorni", items: [] },
      { label: "Meno recenti", items: [] },
    ];
    var now = new Date();
    var startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var startYesterday = startToday - 86400000;
    var start7d = startToday - 7 * 86400000;

    sorted.forEach(function (c) {
      if (c.updatedAt >= startToday) buckets[0].items.push(c);
      else if (c.updatedAt >= startYesterday) buckets[1].items.push(c);
      else if (c.updatedAt >= start7d) buckets[2].items.push(c);
      else buckets[3].items.push(c);
    });

    buckets.forEach(function (bucket) {
      if (!bucket.items.length) return;
      var label = document.createElement("div");
      label.className = "history-group-label";
      label.textContent = bucket.label;
      els.history.appendChild(label);

      bucket.items.forEach(function (c) {
        var item = document.createElement("div");
        item.className = "history-item" + (c.id === state.currentId ? " active" : "");
        item.innerHTML =
          '<span class="title"></span>' +
          '<button type="button" class="delete-btn" aria-label="Elimina conversazione">' +
          '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
          "</button>";
        item.querySelector(".title").textContent = c.title;
        item.addEventListener("click", function () { selectConversation(c.id); });
        item.querySelector(".delete-btn").addEventListener("click", function (e) { deleteConversation(c.id, e); });
        els.history.appendChild(item);
      });
    });
  }

  function makeTitle(text) {
    var t = text.trim().replace(/\s+/g, " ");
    return t.length > 46 ? t.slice(0, 46) + "…" : t;
  }

  // ---------------------------------------------------------------
  // Sending messages
  // ---------------------------------------------------------------
  function onSubmit(e) {
    e.preventDefault();
    if (state.streaming) return;
    var text = els.input.value.trim();
    var images = state.pendingAttachments.slice();
    if (!text && !images.length) return;

    if (!state.currentId) {
      var title = text ? makeTitle(text) : "Immagine";
      var convo = { id: cryptoRandomId(), title: title, messages: [], updatedAt: Date.now() };
      state.conversations.unshift(convo);
      state.currentId = convo.id;
    }
    hideWelcome();

    var convo2 = getCurrentConversation();
    var userMsg = { role: "user", content: text };
    if (images.length) userMsg.images = images;
    convo2.messages.push(userMsg);
    convo2.updatedAt = Date.now();
    els.headerTitle.textContent = convo2.title;
    saveConversations();
    renderHistory();

    appendMessageEl("user", text, false, null, images);
    els.input.value = "";
    clearAttachments();
    autoResizeTextarea();
    scrollToBottom(true);

    generateAssistantReply();
  }

  function cryptoRandomId() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------
  // Image attachments
  // ---------------------------------------------------------------
  function fileToCompressedDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("read error")); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error("decode error")); };
        img.onload = function () {
          var scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(img.width, img.height));
          var w = Math.max(1, Math.round(img.width * scale));
          var h = Math.max(1, Math.round(img.height * scale));
          var canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function addAttachments(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) {
      return f.type && f.type.indexOf("image/") === 0;
    });
    if (!list.length) return;
    if (state.pendingAttachments.length >= MAX_ATTACHMENTS) return;
    list.slice(0, MAX_ATTACHMENTS - state.pendingAttachments.length).forEach(function (file) {
      fileToCompressedDataUrl(file)
        .then(function (dataUrl) {
          state.pendingAttachments.push(dataUrl);
          renderAttachmentsPreview();
        })
        .catch(function () { /* ignore unreadable file */ });
    });
  }

  function removeAttachment(index) {
    state.pendingAttachments.splice(index, 1);
    renderAttachmentsPreview();
  }

  function clearAttachments() {
    state.pendingAttachments = [];
    renderAttachmentsPreview();
  }

  function renderAttachmentsPreview() {
    var el = els.attachmentsPreview;
    el.innerHTML = "";
    if (!state.pendingAttachments.length) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    state.pendingAttachments.forEach(function (dataUrl, index) {
      var thumb = document.createElement("div");
      thumb.className = "attachment-thumb";
      thumb.innerHTML =
        '<img src="' + dataUrl + '" alt="Anteprima immagine allegata" />' +
        '<button type="button" class="remove-attachment" aria-label="Rimuovi immagine">' +
        '<svg viewBox="0 0 24 24" width="10" height="10"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>' +
        "</button>";
      thumb.querySelector(".remove-attachment").addEventListener("click", function () { removeAttachment(index); });
      el.appendChild(thumb);
    });
  }

  function setStreamingUI(isStreaming) {
    state.streaming = isStreaming;
    els.sendBtn.classList.toggle("hidden", isStreaming);
    els.stopBtn.classList.toggle("hidden", !isStreaming);
  }

  function generateAssistantReply() {
    var convo = getCurrentConversation();
    if (!convo) return;

    var selectedModel = getSelectedModel();
    var isAutoMode = selectedModel === AUTO_VALUE;
    var lastUserMsg = convo.messages[convo.messages.length - 1];
    // Groq only accepts image content in the newest message of a request —
    // resending an older message's image as array content (even to the
    // vision model) is rejected with "content must be a string". So only
    // the current turn may carry real image data (see payloadMessages
    // below); whether to route to the vision model depends only on
    // whether *this* message has an image.
    var hasImages = !!(lastUserMsg && lastUserMsg.images && lastUserMsg.images.length);
    var resolvedModel = hasImages ? VISION_MODEL : (isAutoMode ? pickAutoModel(lastUserMsg ? lastUserMsg.content : "") : selectedModel);
    var currentModel = resolvedModel;
    var didFallback = false;
    var showTag = isAutoMode || hasImages;

    setStreamingUI(true);
    var msgEl = appendMessageEl("assistant", "", true, showTag ? resolvedModel : null);
    var contentEl = msgEl.querySelector(".msg-content");
    contentEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

    var controller = new AbortController();
    state.abortController = controller;

    var payloadMessages = [{ role: "system", content: CONFIG.systemPrompt || "" }].concat(
      convo.messages.map(function (m) {
        // Only the current/last message may include real image data —
        // Groq rejects array content on any earlier message. Older image
        // messages are sent as plain text so the model still has context
        // on what was discussed, just not the raw pixels anymore.
        if (m.images && m.images.length && m === lastUserMsg) {
          var parts = [];
          if (m.content) parts.push({ type: "text", text: m.content });
          m.images.forEach(function (dataUrl) {
            parts.push({ type: "image_url", image_url: { url: dataUrl } });
          });
          return { role: m.role, content: parts };
        }
        if (m.images && m.images.length) {
          return { role: m.role, content: m.content || "[Immagine allegata in un messaggio precedente]" };
        }
        return { role: m.role, content: m.content };
      })
    );

    var assistantText = "";
    var firstChunk = true;
    var renderPending = false;
    var finished = false;

    function updateModelTag(modelId) {
      currentModel = modelId;
      var actions = msgEl.querySelector(".msg-actions");
      if (!actions) return;
      var tag = actions.querySelector(".model-tag");
      if (!tag) {
        tag = document.createElement("span");
        tag.className = "model-tag";
        actions.insertBefore(tag, actions.firstChild);
      }
      tag.textContent = getModelLabel(modelId);
    }

    function scheduleRender(withCursor) {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(function () {
        renderPending = false;
        if (finished) return;
        contentEl.innerHTML = renderMarkdown(assistantText);
        renderMathIn(contentEl);
        highlightCodeIn(contentEl);
        if (withCursor) {
          var last = contentEl.lastElementChild;
          if (last) last.classList.add("cursor");
          else contentEl.classList.add("cursor");
        }
        scrollToBottom(false);
      });
    }

    function sendChatRequest(modelToUse, isRetry) {
      // OpenRouter's free models are always named "vendor/model:variant"
      // (e.g. "deepseek/deepseek-r1:free") — the colon reliably tells them
      // apart from Groq's plain "vendor/model" ids, no extra bookkeeping
      // needed. This also means a retry that falls back to FALLBACK_MODEL
      // (a Groq id) correctly switches provider back to Groq.
      var provider = /:/.test(modelToUse) ? "openrouter" : "groq";
      fetch(CONFIG.workerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelToUse,
          stream: true,
          messages: payloadMessages,
          provider: provider,
          password: localStorage.getItem(AUTH_KEY) || "",
        }),
        signal: controller.signal,
      })
        .then(function (res) {
          if (res.status === 401) {
            throw new Error("__unauthorized__");
          }
          if (!res.ok) {
            return res.text().then(function (body) {
              var modelUnavailable = /model_not_found|does not exist/i.test(body);
              if (modelUnavailable && !isRetry && modelToUse !== FALLBACK_MODEL) {
                throw new Error("__retry_fallback__");
              }
              throw new Error("HTTP " + res.status + " — " + body.slice(0, 300));
            });
          }
          var reader = res.body.getReader();
          var decoder = new TextDecoder();
          var buffer = "";
          var streamError = null;

          function pump() {
            return reader.read().then(function (result) {
              if (result.done) return;
              buffer += decoder.decode(result.value, { stream: true });
              var events = buffer.split("\n\n");
              buffer = events.pop();

              events.forEach(function (evt) {
                // An SSE event can carry several fields on separate lines
                // (e.g. "event: error\ndata: {...}"). Groq sometimes sends
                // a mid-stream error this way instead of an HTTP error —
                // if we only ever look for lines starting with "data:" as
                // a whole block, that block is silently dropped and the
                // response ends up looking like an empty-but-successful
                // reply (no error, no text).
                var eventType = null;
                var dataLines = [];
                evt.split("\n").forEach(function (rawLine) {
                  var l = rawLine.trim();
                  if (l.startsWith("event:")) eventType = l.slice(6).trim();
                  else if (l.startsWith("data:")) dataLines.push(l.slice(5).trim());
                });
                if (!dataLines.length) return;
                var data = dataLines.join("\n");
                if (data === "[DONE]") return;
                try {
                  var json = JSON.parse(data);
                  if (eventType === "error" || json.error) {
                    streamError = (json.error && (json.error.message || json.error)) || "Errore durante la generazione della risposta.";
                    return;
                  }
                  var delta = json.choices && json.choices[0] && json.choices[0].delta ? json.choices[0].delta.content : "";
                  if (delta) {
                    if (firstChunk) { contentEl.innerHTML = ""; firstChunk = false; }
                    assistantText += delta;
                    scheduleRender(true);
                  }
                } catch (err) { /* ignore malformed chunk */ }
              });

              return pump();
            });
          }
          return pump().then(function () {
            // Some models (e.g. groq/compound running a web search) can
            // finish the stream with no error and no content at all. Retry
            // once with the safe fallback model instead of silently
            // showing nothing, same as the model_not_found handling below.
            if (!assistantText) {
              if (!isRetry && modelToUse !== FALLBACK_MODEL) {
                throw new Error("__retry_fallback__");
              }
              throw new Error(streamError || "Il modello non ha restituito alcuna risposta. Riprova o cambia modello.");
            }
          });
        })
        .then(function () {
          finished = true;
          finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, null, (showTag || didFallback) ? currentModel : null);
        })
        .catch(function (err) {
          if (err.message === "__retry_fallback__") {
            didFallback = true;
            firstChunk = true;
            assistantText = "";
            contentEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
            updateModelTag(FALLBACK_MODEL);
            sendChatRequest(FALLBACK_MODEL, true);
            return;
          }
          finished = true;
          if (err.message === "__unauthorized__") {
            msgEl.remove();
            setStreamingUI(false);
            state.abortController = null;
            handleUnauthorized();
          } else if (err.name === "AbortError") {
            finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, assistantText ? null : "interrupted", (showTag || didFallback) ? currentModel : null);
          } else {
            finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, err.message || String(err), (showTag || didFallback) ? currentModel : null);
          }
        });
    }

    sendChatRequest(resolvedModel, false);
  }

  function finalizeAssistantMessage(msgEl, contentEl, convo, text, errorMessage, modelUsed) {
    setStreamingUI(false);
    state.abortController = null;

    if (errorMessage && errorMessage !== "interrupted") {
      contentEl.innerHTML = "";
      msgEl.remove();
      showErrorBanner(errorMessage);
      return;
    }

    contentEl.classList.remove("cursor");
    var finalText = text || (errorMessage === "interrupted" ? "" : "");
    if (!finalText) {
      msgEl.remove();
      return;
    }
    contentEl.innerHTML = renderMarkdown(finalText);
    renderMathIn(contentEl);
    highlightCodeIn(contentEl);
    msgEl.dataset.raw = finalText;

    convo.messages.push({ role: "assistant", content: finalText, modelUsed: modelUsed || null });
    convo.updatedAt = Date.now();
    saveConversations();
    renderHistory();
    scrollToBottom(false);
  }

  function showErrorBanner(message) {
    var banner = document.createElement("div");
    banner.className = "error-banner";
    var isConfigIssue = /REPLACE-WITH-YOUR-WORKER-URL|Failed to fetch|NetworkError|CORS/i.test(message);
    banner.innerHTML = isConfigIssue
      ? "Non riesco a contattare il proxy AI. Controlla di aver impostato <code>workerUrl</code> in <code>assets/config.js</code> con l'URL del tuo Cloudflare Worker, e che il Worker sia stato deployato correttamente. Dettagli: <code>" + escapeHtml(message) + "</code>"
      : "Si è verificato un errore durante la generazione della risposta: <code>" + escapeHtml(message) + "</code>";
    els.messages.appendChild(banner);
    scrollToBottom(true);
  }

  // ---------------------------------------------------------------
  // Rendering messages
  // ---------------------------------------------------------------
  var assistantAvatarSvg =
    '<svg viewBox="0 0 32 32" width="16" height="16"><text x="16" y="22" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="16" fill="#fff">G</text></svg>';

  function appendMessageEl(role, text, isStreamingPlaceholder, modelUsed, images) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + role;

    var avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    if (role === "assistant") avatar.innerHTML = assistantAvatarSvg;

    var body = document.createElement("div");
    body.className = "msg-body";

    if (images && images.length) {
      var imagesRow = document.createElement("div");
      imagesRow.className = "msg-images";
      images.forEach(function (dataUrl) {
        var img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "Immagine allegata";
        imagesRow.appendChild(img);
      });
      body.appendChild(imagesRow);
    }

    var content = document.createElement("div");
    content.className = "msg-content";
    if (!isStreamingPlaceholder) {
      content.innerHTML = role === "assistant" ? renderMarkdown(text) : escapeHtml(text).replace(/\n/g, "<br>");
      if (role === "assistant") { renderMathIn(content); highlightCodeIn(content); }
    }
    body.appendChild(content);

    if (role === "assistant" && !isStreamingPlaceholder) {
      wrap.dataset.raw = text;
      body.appendChild(buildMsgActions(modelUsed));
    } else if (role === "assistant") {
      body.appendChild(buildMsgActions(modelUsed));
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    els.messages.appendChild(wrap);
    return wrap;
  }

  function buildMsgActions(modelUsed) {
    var actions = document.createElement("div");
    actions.className = "msg-actions";
    var tagHtml = modelUsed ? '<span class="model-tag">' + escapeHtml(getModelLabel(modelUsed)) + "</span>" : "";
    actions.innerHTML =
      tagHtml +
      '<button type="button" class="copy-msg-btn">' +
      '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="2"/></svg>' +
      "Copia</button>";
    return actions;
  }

  function scrollToBottom(force) {
    var el = els.chatScroll;
    var nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (force || nearBottom) el.scrollTop = el.scrollHeight;
  }

  function autoResizeTextarea() {
    var el = els.input;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  // ---------------------------------------------------------------
  // Minimal, safe markdown renderer
  // ---------------------------------------------------------------
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function inlineFormat(text) {
    var t = text;
    t = t.replace(/`([^`]+?)`/g, function (m, code) { return "<code>" + code + "</code>"; });
    t = t.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
    t = t.replace(/\[([^\]]+?)\]\((https?:\/\/[^\s)]+?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return t;
  }

  var PRISM_LANG_ALIASES = {
    js: "javascript", ts: "typescript", py: "python", rb: "ruby",
    sh: "bash", shell: "bash", yml: "yaml", md: "markdown",
    html: "markup", xml: "markup", "c++": "cpp", "c#": "csharp",
  };

  function normalizePrismLang(lang) {
    var l = (lang || "").toLowerCase();
    return PRISM_LANG_ALIASES[l] || l;
  }

  function codeBlockHtml(lang, code) {
    var id = "cb-" + Math.random().toString(36).slice(2, 9);
    var hasLang = !!(lang && lang !== "text");
    var label = hasLang ? lang : "codice";
    var langClass = hasLang ? ' class="language-' + escapeHtml(normalizePrismLang(lang)) + '"' : "";
    return (
      '<div class="code-block"><div class="code-block-head"><span>' +
      escapeHtml(label) +
      '</span><button type="button" class="copy-code-btn">' +
      '<svg viewBox="0 0 24 24" width="12" height="12"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="2"/></svg>' +
      "Copia</button></div><pre><code id=\"" +
      id +
      '"' + langClass + '>' +
      code +
      "</code></pre></div>"
    );
  }

  function highlightCodeIn(container) {
    if (typeof Prism === "undefined" || !container) return;
    var blocks = container.querySelectorAll(".code-block code[class*='language-']:not([data-highlighted])");
    blocks.forEach(function (el) {
      try {
        Prism.highlightElement(el);
        el.setAttribute("data-highlighted", "1");
      } catch (e) { /* leave plain, unhighlighted text */ }
    });
  }

  function splitTableRow(line) {
    var t = line.trim();
    if (t.charAt(0) === "|") t = t.slice(1);
    if (t.charAt(t.length - 1) === "|") t = t.slice(0, -1);
    return t.split("|").map(function (c) { return c.trim(); });
  }

  function extractTables(text) {
    var lines = text.split("\n");
    var out = [];
    var tableBlocks = [];
    var separatorPattern = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      var next = i + 1 < lines.length ? lines[i + 1].trim() : "";
      if (line.indexOf("|") !== -1 && line !== "" && separatorPattern.test(next)) {
        var header = splitTableRow(line);
        var rows = [];
        var j = i + 2;
        while (j < lines.length && lines[j].trim().indexOf("|") !== -1 && lines[j].trim() !== "") {
          rows.push(splitTableRow(lines[j]));
          j++;
        }
        var idx = tableBlocks.length;
        tableBlocks.push({ header: header, rows: rows });
        out.push("___TABLEBLOCK_" + idx + "___");
        i = j - 1;
      } else {
        out.push(lines[i]);
      }
    }
    return { text: out.join("\n"), tableBlocks: tableBlocks };
  }

  function tableBlockHtml(block) {
    var head = "<tr>" + block.header.map(function (c) { return "<th>" + inlineFormat(c) + "</th>"; }).join("") + "</tr>";
    var body = block.rows.map(function (row) {
      return "<tr>" + row.map(function (c) { return "<td>" + inlineFormat(c) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return '<div class="table-wrap"><table><thead>' + head + "</thead><tbody>" + body + "</tbody></table></div>";
  }

  function renderMarkdown(raw) {
    if (!raw) return "";
    var escaped = escapeHtml(raw);
    var codeBlocks = [];
    var mathBlocks = [];

    var text = escaped.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || "text", code: code.replace(/\n$/, "") });
      return "\n___CODEBLOCK_" + idx + "___\n";
    });

    text = text.replace(/\\\[([\s\S]*?)\\\]/g, function (m, tex) {
      var idx = mathBlocks.length;
      mathBlocks.push({ tex: tex.trim(), display: true });
      return "\n___MATHBLOCK_" + idx + "___\n";
    });
    text = text.replace(/\\\(([\s\S]*?)\\\)/g, function (m, tex) {
      var idx = mathBlocks.length;
      mathBlocks.push({ tex: tex.trim(), display: false });
      return "___MATHBLOCK_" + idx + "___";
    });

    var tablesResult = extractTables(text);
    text = tablesResult.text;
    var tableBlocks = tablesResult.tableBlocks;

    var lines = text.split("\n");
    var html = "";
    var listStack = null;
    var paraBuffer = [];

    function closeList() {
      if (listStack) {
        html += "<" + listStack.type + ">" + listStack.items.join("") + "</" + listStack.type + ">";
        listStack = null;
      }
    }
    function flushPara() {
      if (paraBuffer.length) {
        html += "<p>" + paraBuffer.join("<br>") + "</p>";
        paraBuffer = [];
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var trimmed = line.trim();

      if (trimmed === "") { flushPara(); closeList(); continue; }

      var cbMatch = trimmed.match(/^___CODEBLOCK_(\d+)___$/);
      if (cbMatch) { flushPara(); closeList(); html += "___CODEBLOCK_" + cbMatch[1] + "___"; continue; }

      var mbMatch = trimmed.match(/^___MATHBLOCK_(\d+)___$/);
      if (mbMatch) { flushPara(); closeList(); html += "___MATHBLOCK_" + mbMatch[1] + "___"; continue; }

      var tbMatch = trimmed.match(/^___TABLEBLOCK_(\d+)___$/);
      if (tbMatch) { flushPara(); closeList(); html += "___TABLEBLOCK_" + tbMatch[1] + "___"; continue; }

      var hMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
      if (hMatch) {
        flushPara(); closeList();
        var level = hMatch[1].length;
        html += "<h" + level + ">" + inlineFormat(hMatch[2]) + "</h" + level + ">";
        continue;
      }

      if (/^&gt;\s?/.test(trimmed)) {
        flushPara(); closeList();
        html += "<blockquote>" + inlineFormat(trimmed.replace(/^&gt;\s?/, "")) + "</blockquote>";
        continue;
      }

      var ulMatch = trimmed.match(/^[-*]\s+(.*)$/);
      if (ulMatch) {
        flushPara();
        if (!listStack || listStack.type !== "ul") { closeList(); listStack = { type: "ul", items: [] }; }
        listStack.items.push("<li>" + inlineFormat(ulMatch[1]) + "</li>");
        continue;
      }

      var olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
      if (olMatch) {
        flushPara();
        if (!listStack || listStack.type !== "ol") { closeList(); listStack = { type: "ol", items: [] }; }
        listStack.items.push("<li>" + inlineFormat(olMatch[1]) + "</li>");
        continue;
      }

      closeList();
      paraBuffer.push(inlineFormat(trimmed));
    }
    flushPara();
    closeList();

    html = html.replace(/___CODEBLOCK_(\d+)___/g, function (m, idx) {
      var block = codeBlocks[Number(idx)];
      return codeBlockHtml(block.lang, block.code);
    });

    html = html.replace(/___MATHBLOCK_(\d+)___/g, function (m, idx) {
      var block = mathBlocks[Number(idx)];
      var tag = block.display ? "div" : "span";
      return (
        "<" + tag + ' class="katex-target" data-display="' + (block.display ? "1" : "0") + '" data-tex="' + block.tex + '">' +
        block.tex +
        "</" + tag + ">"
      );
    });

    html = html.replace(/___TABLEBLOCK_(\d+)___/g, function (m, idx) {
      return tableBlockHtml(tableBlocks[Number(idx)]);
    });

    return html;
  }

  function renderMathIn(container) {
    if (typeof katex === "undefined" || !container) return;
    var targets = container.querySelectorAll(".katex-target:not([data-rendered])");
    targets.forEach(function (el) {
      var tex = el.getAttribute("data-tex") || "";
      var displayMode = el.getAttribute("data-display") === "1";
      try {
        katex.render(tex, el, { throwOnError: false, displayMode: displayMode });
        el.setAttribute("data-rendered", "1");
      } catch (e) {
        /* leave the raw-text fallback already in the element */
      }
    });
  }

})();
