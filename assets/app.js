(function () {
  "use strict";

  var CONFIG = window.APP_CONFIG || {};
  var STORAGE_KEY = "lumen.conversations.v1";
  var THEME_KEY = "lumen.theme";

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
    headerTitle: document.getElementById("headerTitle"),
    modelBadgeText: document.getElementById("modelBadgeText"),
    chatScroll: document.getElementById("chatScroll"),
    welcome: document.getElementById("welcome"),
    messages: document.getElementById("messages"),
    composer: document.getElementById("composer"),
    input: document.getElementById("input"),
    sendBtn: document.getElementById("sendBtn"),
    stopBtn: document.getElementById("stopBtn"),
  };

  var state = {
    conversations: [],
    currentId: null,
    streaming: false,
    abortController: null,
  };

  init();

  function init() {
    loadTheme();
    loadConversations();
    bindEvents();
    renderHistory();
    autoResizeTextarea();
    applyBranding();
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
        state.currentId = null;
        saveConversations();
        renderHistory();
        showWelcome();
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
    convo.messages.forEach(function (m) { appendMessageEl(m.role, m.content, false); });
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
    if (!text) return;

    if (!state.currentId) {
      var convo = { id: cryptoRandomId(), title: makeTitle(text), messages: [], updatedAt: Date.now() };
      state.conversations.unshift(convo);
      state.currentId = convo.id;
    }
    hideWelcome();

    var convo2 = getCurrentConversation();
    convo2.messages.push({ role: "user", content: text });
    convo2.updatedAt = Date.now();
    els.headerTitle.textContent = convo2.title;
    saveConversations();
    renderHistory();

    appendMessageEl("user", text, false);
    els.input.value = "";
    autoResizeTextarea();
    scrollToBottom(true);

    generateAssistantReply();
  }

  function cryptoRandomId() {
    return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function setStreamingUI(isStreaming) {
    state.streaming = isStreaming;
    els.sendBtn.classList.toggle("hidden", isStreaming);
    els.stopBtn.classList.toggle("hidden", !isStreaming);
  }

  function generateAssistantReply() {
    var convo = getCurrentConversation();
    if (!convo) return;

    setStreamingUI(true);
    var msgEl = appendMessageEl("assistant", "", true);
    var contentEl = msgEl.querySelector(".msg-content");
    contentEl.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';

    var controller = new AbortController();
    state.abortController = controller;

    var payloadMessages = [{ role: "system", content: CONFIG.systemPrompt || "" }].concat(
      convo.messages.map(function (m) { return { role: m.role, content: m.content }; })
    );

    var assistantText = "";
    var firstChunk = true;
    var renderPending = false;
    var finished = false;

    function scheduleRender(withCursor) {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(function () {
        renderPending = false;
        if (finished) return;
        contentEl.innerHTML = renderMarkdown(assistantText);
        if (withCursor) {
          var last = contentEl.lastElementChild;
          if (last) last.classList.add("cursor");
          else contentEl.classList.add("cursor");
        }
        scrollToBottom(false);
      });
    }

    fetch(CONFIG.workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: CONFIG.model, stream: true, messages: payloadMessages }),
      signal: controller.signal,
    })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (body) {
            throw new Error("HTTP " + res.status + " — " + body.slice(0, 300));
          });
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buffer = "";

        function pump() {
          return reader.read().then(function (result) {
            if (result.done) return;
            buffer += decoder.decode(result.value, { stream: true });
            var events = buffer.split("\n\n");
            buffer = events.pop();

            events.forEach(function (evt) {
              var line = evt.trim();
              if (!line.startsWith("data:")) return;
              var data = line.slice(5).trim();
              if (data === "[DONE]") return;
              try {
                var json = JSON.parse(data);
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
        return pump();
      })
      .then(function () {
        finished = true;
        finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, null);
      })
      .catch(function (err) {
        finished = true;
        if (err.name === "AbortError") {
          finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, assistantText ? null : "interrupted");
        } else {
          finalizeAssistantMessage(msgEl, contentEl, convo, assistantText, err.message || String(err));
        }
      });
  }

  function finalizeAssistantMessage(msgEl, contentEl, convo, text, errorMessage) {
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
    msgEl.dataset.raw = finalText;

    convo.messages.push({ role: "assistant", content: finalText });
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

  function appendMessageEl(role, text, isStreamingPlaceholder) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + role;

    var avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    if (role === "assistant") avatar.innerHTML = assistantAvatarSvg;

    var body = document.createElement("div");
    body.className = "msg-body";

    var content = document.createElement("div");
    content.className = "msg-content";
    if (!isStreamingPlaceholder) {
      content.innerHTML = role === "assistant" ? renderMarkdown(text) : escapeHtml(text).replace(/\n/g, "<br>");
    }
    body.appendChild(content);

    if (role === "assistant" && !isStreamingPlaceholder) {
      wrap.dataset.raw = text;
      body.appendChild(buildMsgActions());
    } else if (role === "assistant") {
      body.appendChild(buildMsgActions());
    }

    wrap.appendChild(avatar);
    wrap.appendChild(body);
    els.messages.appendChild(wrap);
    return wrap;
  }

  function buildMsgActions() {
    var actions = document.createElement("div");
    actions.className = "msg-actions";
    actions.innerHTML =
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

  function codeBlockHtml(lang, code) {
    var id = "cb-" + Math.random().toString(36).slice(2, 9);
    var label = lang && lang !== "text" ? lang : "codice";
    return (
      '<div class="code-block"><div class="code-block-head"><span>' +
      escapeHtml(label) +
      '</span><button type="button" class="copy-code-btn">' +
      '<svg viewBox="0 0 24 24" width="12" height="12"><rect x="8" y="8" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" stroke="currentColor" stroke-width="2"/></svg>' +
      "Copia</button></div><pre><code id=\"" +
      id +
      '">' +
      code +
      "</code></pre></div>"
    );
  }

  function renderMarkdown(raw) {
    if (!raw) return "";
    var escaped = escapeHtml(raw);
    var codeBlocks = [];

    var text = escaped.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, function (m, lang, code) {
      var idx = codeBlocks.length;
      codeBlocks.push({ lang: lang || "text", code: code.replace(/\n$/, "") });
      return "\n___CODEBLOCK_" + idx + "___\n";
    });

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

    return html;
  }

})();
