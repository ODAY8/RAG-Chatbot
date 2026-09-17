/* ============================================================
   documents.js
   ============================================================ */

let allDocs = [];

document.addEventListener("DOMContentLoaded", async () => {
  if (!Auth.require()) return;
  initSidebar();
  initLogout();
  await loadDocuments();
  bindSearch();
  bindReindex();
});

async function loadDocuments() {
  const tbody = document.getElementById("docs-tbody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-3)"><div class="spinner" style="margin:0 auto"></div></td></tr>`;

  try {
    allDocs = await API.documents();
    renderTable(allDocs);
    document.getElementById("doc-count").textContent = allDocs.length;
  } catch (err) {
    toast(`Failed to load documents: ${err.message}`, "error");
    if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--danger)">Failed to load documents.</td></tr>`;
  }
}

function renderTable(docs) {
  const tbody = document.getElementById("docs-tbody");
  if (!tbody) return;

  if (!docs.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">📂</div>
        <p>No documents found. Upload some documents to get started.</p>
        <a href="/upload.html" class="btn btn-primary btn-sm" style="margin-top:8px">Upload Documents</a>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = docs.map(doc => `
    <tr>
      <td>
        <div class="doc-name-cell">
          <div class="doc-file-icon ${fileColorClass(doc.ext)}">${fileIcon(doc.ext)}</div>
          <div>
            <div class="doc-name">${escHtml(doc.name)}</div>
            <div class="doc-ext">${doc.ext || "—"}</div>
          </div>
        </div>
      </td>
      <td>${formatBytes(doc.size || 0)}</td>
      <td>${doc.chunks ?? "—"}</td>
      <td>${formatDate(doc.uploaded_at)}</td>
      <td><span class="badge badge-success">Indexed</span></td>
      <td>
        <div class="doc-actions">
          <button class="btn btn-ghost btn-sm btn-icon" title="Delete" onclick="confirmDelete('${doc.id}', '${escHtml(doc.name).replace(/'/g,"\\'")}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join("");
}

function bindSearch() {
  document.getElementById("search-input")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    renderTable(allDocs.filter(d => d.name.toLowerCase().includes(q)));
  });
}

function bindReindex() {
  document.getElementById("reindex-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("reindex-btn");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Re-indexing…`;
    try {
      const data = await API.reindex();
      toast(`Re-index complete. ${data.chunks} chunks indexed.`, "success");
      await loadDocuments();
    } catch (err) {
      toast(`Re-index failed: ${err.message}`, "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg> Re-index`;
    }
  });
}

// ── Delete confirmation modal ─────────────────────────────
function confirmDelete(id, name) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-title">Delete Document</div>
      <div class="modal-body">
        Are you sure you want to delete <strong>${escHtml(name)}</strong>?
        This will remove it from the knowledge base and re-index all remaining documents.
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancel-del">Cancel</button>
        <button class="btn btn-danger" id="confirm-del">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("cancel-del").addEventListener("click", () => overlay.remove());
  document.getElementById("confirm-del").addEventListener("click", async () => {
    const btn = document.getElementById("confirm-del");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> Deleting…`;
    try {
      await API.deleteDoc(id);
      toast(`"${name}" deleted successfully.`, "success");
      overlay.remove();
      await loadDocuments();
    } catch (err) {
      toast(`Delete failed: ${err.message}`, "error");
      overlay.remove();
    }
  });

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}
