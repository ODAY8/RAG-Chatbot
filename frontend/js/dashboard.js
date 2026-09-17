/* ============================================================
   dashboard.js
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.require()) return;

  // Greet user
  const user = Auth.current();
  const greetEl = document.getElementById("greeting");
  if (greetEl && user) greetEl.textContent = `Welcome back, ${user.name} 👋`;

  initSidebar();
  initLogout();
  await loadStats();
});

async function loadStats() {
  try {
    const data = await API.stats();

    setText("stat-docs",   data.total_documents);
    setText("stat-chunks", data.total_chunks);
    setText("stat-model",  data.groq_model?.split("-").slice(0,2).join("-") || "—");
    setText("stat-status", data.db_ready ? "Ready" : "Empty");

    const statusEl = document.getElementById("stat-status");
    if (statusEl) {
      statusEl.className = data.db_ready ? "stat-value text-success" : "stat-value text-warning";
    }

    // System status panel
    setStatus("status-groq",   true);
    setStatus("status-db",     data.db_ready);
    setStatus("status-embed",  true);

    setText("info-model",  data.groq_model  || "—");
    setText("info-embed",  data.embed_model || "—");
    setText("info-chunks", data.total_chunks);

    renderRecent(data.recent_uploads || []);
  } catch (err) {
    toast(`Could not load stats: ${err.message}`, "error");
  }
}

function renderRecent(items) {
  const list = document.getElementById("recent-list");
  if (!list) return;

  if (!items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">📂</div><p>No documents uploaded yet.</p></div>`;
    return;
  }

  list.innerHTML = items.map(doc => `
    <div class="recent-item">
      <div class="doc-file-icon ${fileColorClass(doc.ext)}">${fileIcon(doc.ext)}</div>
      <div class="file-info">
        <div class="file-name">${escHtml(doc.name)}</div>
        <div class="file-meta">${doc.chunks} chunks · ${timeAgo(doc.uploaded_at)}</div>
      </div>
      <span class="badge badge-success">Indexed</span>
    </div>
  `).join("");
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? "—";
}

function setStatus(id, online) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `status-dot ${online ? "online" : "offline"}`;
  el.textContent = online ? "Online" : "Offline";
}
