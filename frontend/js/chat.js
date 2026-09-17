/* ============================================================
   chat.js
   ============================================================ */

let conversations = [];   // { id, title, messages: [] }
let activeConvId  = null;
let isStreaming   = false;

document.addEventListener("DOMContentLoaded", () => {
  if (!Auth.require()) return;

  initSidebar();
  initLogout();
  loadConversations();
  renderConvList();
  showWelcome();
  bindInputEvents();
  bindTopbarActions();
  checkHealth();
});

// ── Conversation storage ──────────────────────────────────
function loadConversations() {
  try { conversations = JSON.parse(localStorage.getItem("docai_convs") || "[]"); }
  catch { conversations = []; }
}

function saveConversations() {
  localStorage.setItem("docai_convs", JSON.stringify(conversations.slice(0, 50)));
}

function newConversation() {
  const conv = { id: Date.now().toString(), title: "New Chat", messages: [], createdAt: new Date().toISOString() };
  conversations.unshift(conv);
  activeConvId = conv.id;
  saveConversations();
  renderConvList();
  showWelcome();
}

function switchConversation(id) {
  activeConvId = id;
  renderConvList();
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  const area = document.getElementById("messages-area");
  area.innerHTML = "";
  if (!conv.messages.length) { showWelcome(); return; }
  conv.messages.forEach(m => appendMessage(m.role, m.content, m.sources, m.time, false));
  scrollToBottom();
}

function activeConv() {
  return conversations.find(c => c.id === activeConvId);
}

// ── Render conversation list ──────────────────────────────
function renderConvList() {
  const list = document.getElementById("conv-list");
  if (!list) return;
  if (!conversations.length) {
    list.innerHTML = `<div style="padding:12px;font-size:.8rem;color:var(--text-3);text-align:center;">No conversations yet</div>`;
    return;
  }
  list.innerHTML = conversations.map(c => `
    <div class="conv-item ${c.id === activeConvId ? "active" : ""}" onclick="switchConversation('${c.id}')">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span class="conv-title">${escHtml(c.title)}</span>
      <span class="conv-time">${timeAgo(c.createdAt)}</span>
    </div>
  `).join("");
}

// ── Welcome screen ────────────────────────────────────────
function showWelcome() {
  const area = document.getElementById("messages-area");
  area.innerHTML = `
    <div class="welcome-screen">
      <div class="welcome-icon">🤖</div>
      <h2>AI Document Assistant</h2>
      <p>Ask anything about your uploaded documents. I'll find the relevant information and give you a grounded answer.</p>
      <div class="starter-prompts">
        <button class="starter-prompt" onclick="sendStarter(this)">
          <strong>Summarize documents</strong>What are the main topics covered?
        </button>
        <button class="starter-prompt" onclick="sendStarter(this)">
          <strong>Key concepts</strong>What are the most important concepts?
        </button>
        <button class="starter-prompt" onclick="sendStarter(this)">
          <strong>How does RAG work?</strong>Explain the RAG pipeline
        </button>
        <button class="starter-prompt" onclick="sendStarter(this)">
          <strong>AI Agents</strong>What are AI agents and how do they work?
        </button>
      </div>
    </div>`;
}

function sendStarter(btn) {
  const strong = btn.querySelector("strong");
  const text   = btn.textContent.replace(strong.textContent, "").trim();
  document.getElementById("chat-input").value = text;
  sendMessage();
}

// ── Input bindings ────────────────────────────────────────
function bindInputEvents() {
  const input   = document.getElementById("chat-input");
  const sendBtn = document.getElementById("send-btn");

  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  input?.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
    if (sendBtn) sendBtn.disabled = !input.value.trim() || isStreaming;
  });

  sendBtn?.addEventListener("click", sendMessage);
}

function bindTopbarActions() {
  document.getElementById("clear-btn")?.addEventListener("click", () => {
    if (!activeConvId) return;
    const conv = activeConv();
    if (conv) { conv.messages = []; saveConversations(); }
    showWelcome();
  });

  document.getElementById("new-chat-btn")?.addEventListener("click", newConversation);
  document.getElementById("new-chat-sidebar-btn")?.addEventListener("click", newConversation);
}

// ── Send message ──────────────────────────────────────────
async function sendMessage() {
  const input    = document.getElementById("chat-input");
  const question = input?.value.trim();
  if (!question || isStreaming) return;

  // Ensure we have an active conversation
  if (!activeConvId) newConversation();

  input.value = "";
  input.style.height = "auto";
  document.getElementById("send-btn").disabled = true;

  // Remove welcome screen if present
  const welcome = document.querySelector(".welcome-screen");
  if (welcome) welcome.remove();

  const time = nowTime();
  appendMessage("user", question, [], time, true);
  saveToConv("user", question, [], time);

  // Update conversation title from first message
  const conv = activeConv();
  if (conv && conv.messages.length <= 2) {
    conv.title = question.slice(0, 40) + (question.length > 40 ? "…" : "");
    renderConvList();
  }

  isStreaming = true;
  const typingId = showTyping();

  try {
    const data = await API.chat(question);
    removeTyping(typingId);
    const answerTime = nowTime();
    appendMessage("assistant", data.answer, data.sources || [], answerTime, true);
    saveToConv("assistant", data.answer, data.sources || [], answerTime);
    saveConversations();
  } catch (err) {
    removeTyping(typingId);
    const errMsg = err.message.includes("knowledge base")
      ? "No documents found. Please upload documents first."
      : `Error: ${err.message}`;
    appendMessage("assistant", errMsg, [], nowTime(), true);
    toast(err.message, "error");
  } finally {
    isStreaming = false;
    document.getElementById("send-btn").disabled = false;
  }
}

function saveToConv(role, content, sources, time) {
  const conv = activeConv();
  if (conv) conv.messages.push({ role, content, sources, time });
}

// ── Render a message ──────────────────────────────────────
function appendMessage(role, content, sources = [], time = "", animate = true) {
  const area = document.getElementById("messages-area");
  const id   = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const row = document.createElement("div");
  row.className = `message-row ${role}`;
  row.id = id;
  if (!animate) row.style.animation = "none";

  const avatarIcon = role === "user" ? "👤" : "🤖";
  const bubbleContent = role === "assistant" ? renderMarkdown(content) : escHtml(content).replace(/\n/g, "<br>");

  row.innerHTML = `
    <div class="message-avatar">${avatarIcon}</div>
    <div class="message-content">
      <div class="message-bubble">${bubbleContent}</div>
      ${sources?.length ? renderSources(sources) : ""}
      <div class="message-meta">
        <span class="message-time">${time}</span>
        ${role === "assistant" ? `
          <button class="msg-action-btn" onclick="copyMessage('${id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            Copy
          </button>
          <button class="msg-action-btn" onclick="regenerate()">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
            Regenerate
          </button>` : ""}
      </div>
    </div>`;

  area.appendChild(row);
  scrollToBottom();
}

function renderSources(sources) {
  if (!sources?.length) return "";
  const uid = `src-${Date.now()}`;
  const items = sources.map(s => `
    <div class="source-item">
      <div class="source-name">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        ${escHtml(s.source)}
      </div>
      <div class="source-excerpt">${escHtml(s.excerpt)}</div>
    </div>`).join("");

  return `
    <div class="sources-block">
      <button class="sources-toggle" onclick="toggleSources(this, '${uid}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>
        ${sources.length} source${sources.length > 1 ? "s" : ""}
        <svg class="chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="sources-list" id="${uid}">${items}</div>
    </div>`;
}

function toggleSources(btn, uid) {
  const list = document.getElementById(uid);
  if (!list) return;
  const open = list.classList.toggle("open");
  btn.classList.toggle("open", open);
}

// ── Typing indicator ──────────────────────────────────────
function showTyping() {
  const area = document.getElementById("messages-area");
  const id   = `typing-${Date.now()}`;
  const row  = document.createElement("div");
  row.className = "typing-row";
  row.id = id;
  row.innerHTML = `
    <div class="message-avatar">🤖</div>
    <div class="typing-bubble">
      <div class="typing-dots"><span></span><span></span><span></span></div>
    </div>`;
  area.appendChild(row);
  scrollToBottom();
  return id;
}

function removeTyping(id) {
  document.getElementById(id)?.remove();
}

// ── Actions ───────────────────────────────────────────────
function copyMessage(rowId) {
  const bubble = document.querySelector(`#${rowId} .message-bubble`);
  if (!bubble) return;
  navigator.clipboard.writeText(bubble.innerText).then(() => toast("Copied to clipboard", "success"));
}

async function regenerate() {
  const conv = activeConv();
  if (!conv || conv.messages.length < 2) return;
  // Find last user message
  const lastUser = [...conv.messages].reverse().find(m => m.role === "user");
  if (!lastUser) return;
  // Remove last assistant message from DOM and conv
  const rows = document.querySelectorAll(".message-row.assistant");
  rows[rows.length - 1]?.remove();
  const idx = conv.messages.map(m => m.role).lastIndexOf("assistant");
  if (idx !== -1) conv.messages.splice(idx, 1);

  isStreaming = true;
  const typingId = showTyping();
  try {
    const data = await API.chat(lastUser.content);
    removeTyping(typingId);
    const t = nowTime();
    appendMessage("assistant", data.answer, data.sources || [], t, true);
    saveToConv("assistant", data.answer, data.sources || [], t);
    saveConversations();
  } catch (err) {
    removeTyping(typingId);
    toast(err.message, "error");
  } finally {
    isStreaming = false;
  }
}

// ── Scroll ────────────────────────────────────────────────
function scrollToBottom() {
  const area = document.getElementById("messages-area");
  if (area) area.scrollTop = area.scrollHeight;
}

// ── Health check ──────────────────────────────────────────
async function checkHealth() {
  try {
    const h = await API.health();
    const dot = document.getElementById("health-dot");
    if (dot) {
      dot.style.background = h.db_ready ? "var(--success)" : "var(--warning)";
      dot.title = h.db_ready ? "Knowledge base ready" : "No documents indexed";
    }
  } catch {
    const dot = document.getElementById("health-dot");
    if (dot) { dot.style.background = "var(--danger)"; dot.title = "Server offline"; }
  }
}
