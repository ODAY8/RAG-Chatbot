/* ============================================================
   api.js — Central API layer + shared utilities
   ============================================================ */

const API_BASE = "";   // same origin; Flask serves both

// ── Auth helpers ──────────────────────────────────────────
const Auth = {
  KEY: "docai_user",

  // Store / read / clear session
  login(user)  { localStorage.setItem(this.KEY, JSON.stringify(user)); },
  logout()     { localStorage.removeItem(this.KEY); window.location.href = "/login.html"; },
  current()    { try { return JSON.parse(localStorage.getItem(this.KEY)); } catch { return null; } },
  require()    {
    if (!this.current()) { window.location.href = "/login.html"; return false; }
    return true;
  },

  // Real backend calls
  loginApi(email, password) {
    return apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
  },

  registerApi(name, email, password) {
    return apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    });
  },
};

// ── Settings helpers ──────────────────────────────────────
const Settings = {
  KEY: "docai_settings",
  defaults: { model: "openai/gpt-oss-120b", temperature: 0.2, top_k: 3 },
  get()  { try { return { ...this.defaults, ...JSON.parse(localStorage.getItem(this.KEY)) }; } catch { return { ...this.defaults }; } },
  save(s){ localStorage.setItem(this.KEY, JSON.stringify(s)); },
};

// ── Toast notifications ───────────────────────────────────
function toast(message, type = "info") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  const icons = { success: "✓", error: "✕", info: "ℹ" };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || icons.info}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

// ── Generic fetch wrapper ─────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── API methods ───────────────────────────────────────────
const API = {
  health:    ()           => apiFetch("/health"),
  stats:     ()           => apiFetch("/stats"),
  documents: ()           => apiFetch("/documents"),
  deleteDoc: (id)         => apiFetch(`/documents/${id}`, { method: "DELETE" }),
  reindex:   ()           => apiFetch("/reindex", { method: "POST" }),

  chat(question) {
    const s = Settings.get();
    return apiFetch("/chat", {
      method: "POST",
      body: JSON.stringify({ question, model: s.model, temperature: s.temperature, top_k: s.top_k }),
    });
  },

  upload(file, onProgress) {
    return new Promise((resolve, reject) => {
      const fd  = new FormData();
      fd.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API_BASE + "/upload");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 90));
      };
      xhr.onload = () => {
        try {
          const data = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) { if (onProgress) onProgress(100); resolve(data); }
          else reject(new Error(data.error || `HTTP ${xhr.status}`));
        } catch { reject(new Error("Invalid server response")); }
      };
      xhr.onerror = () => reject(new Error("Network error"));
      xhr.send(fd);
    });
  },
};

// ── Sidebar collapse ──────────────────────────────────────
function initSidebar() {
  const sidebar = document.querySelector(".sidebar");
  const toggle  = document.querySelector(".sidebar-toggle");
  if (!sidebar || !toggle) return;

  const collapsed = localStorage.getItem("sidebar_collapsed") === "1";
  if (collapsed) sidebar.classList.add("collapsed");

  toggle.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
    localStorage.setItem("sidebar_collapsed", sidebar.classList.contains("collapsed") ? "1" : "0");
  });

  // Mobile overlay
  const overlay = document.createElement("div");
  overlay.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;";
  document.body.appendChild(overlay);

  const mobileToggle = document.querySelector(".mobile-menu-btn");
  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => {
      sidebar.classList.toggle("mobile-open");
      overlay.style.display = sidebar.classList.contains("mobile-open") ? "block" : "none";
    });
  }
  overlay.addEventListener("click", () => {
    sidebar.classList.remove("mobile-open");
    overlay.style.display = "none";
  });
}

// ── Logout handler ────────────────────────────────────────
function initLogout() {
  document.querySelectorAll("[data-logout]").forEach(el => {
    el.addEventListener("click", (e) => { e.preventDefault(); Auth.logout(); });
  });
}

// ── Format helpers ────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fileIcon(ext) {
  const map = { pdf: "📄", txt: "📝", docx: "📘", doc: "📘", md: "📋" };
  return map[(ext || "").toLowerCase()] || "📁";
}

function fileColorClass(ext) {
  const map = { pdf: "ft-pdf", txt: "ft-txt", docx: "ft-docx", doc: "ft-docx", md: "ft-md" };
  return map[(ext || "").toLowerCase()] || "ft-default";
}

// ── Simple Markdown renderer ──────────────────────────────
function renderMarkdown(text) {
  if (!text) return "";
  let html = text
    // code blocks
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><button class="code-copy-btn" onclick="copyCode(this)">Copy</button><code class="language-${lang}">${escHtml(code.trim())}</code></pre>`)
    // inline code
    .replace(/`([^`]+)`/g, (_, c) => `<code>${escHtml(c)}</code>`)
    // bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm,  "<h2>$1</h2>")
    .replace(/^# (.+)$/gm,   "<h1>$1</h1>")
    // unordered list
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>)/s, "<ul>$1</ul>")
    // ordered list
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>")
    // horizontal rule
    .replace(/^---$/gm, "<hr>")
    // paragraphs (double newline)
    .replace(/\n\n+/g, "</p><p>")
    // single newline
    .replace(/\n/g, "<br>");

  return `<p>${html}</p>`;
}

function escHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function copyCode(btn) {
  const code = btn.nextElementSibling.textContent;
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = "Copy"; }, 2000);
  });
}

// ── Timestamp ─────────────────────────────────────────────
function nowTime() {
  return new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}
