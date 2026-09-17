/* ============================================================
   upload.js
   ============================================================ */

const ALLOWED = ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/markdown"];
const ALLOWED_EXT = [".pdf", ".txt", ".docx", ".md"];

document.addEventListener("DOMContentLoaded", () => {
  if (!Auth.require()) return;
  initSidebar();
  initLogout();
  initDropZone();
  loadStats();
});

function initDropZone() {
  const zone      = document.getElementById("drop-zone");
  const fileInput = document.getElementById("file-input");
  const browseBtn = document.getElementById("browse-btn");

  browseBtn?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => handleFiles(Array.from(fileInput.files)));

  zone?.addEventListener("dragover",  (e) => { e.preventDefault(); zone.classList.add("drag-over"); });
  zone?.addEventListener("dragleave", ()  => zone.classList.remove("drag-over"));
  zone?.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("drag-over");
    handleFiles(Array.from(e.dataTransfer.files));
  });
  zone?.addEventListener("click", (e) => {
    if (e.target === zone || e.target.closest(".drop-zone") === zone) fileInput?.click();
  });
}

function handleFiles(files) {
  const valid = files.filter(f => {
    const ext = "." + f.name.split(".").pop().toLowerCase();
    return ALLOWED_EXT.includes(ext);
  });
  const invalid = files.filter(f => !valid.includes(f));

  invalid.forEach(f => toast(`"${f.name}" is not a supported file type.`, "error"));
  valid.forEach(uploadFile);
}

async function uploadFile(file) {
  const itemId = `qi-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const ext    = file.name.split(".").pop().toLowerCase();

  addQueueItem(itemId, file.name, file.size, ext);

  try {
    await API.upload(file, (pct) => updateProgress(itemId, pct));
    setQueueStatus(itemId, "success", `Indexed successfully`);
    toast(`"${file.name}" uploaded and indexed!`, "success");
    loadStats();
  } catch (err) {
    setQueueStatus(itemId, "error", err.message);
    toast(`Upload failed: ${err.message}`, "error");
  }
}

function addQueueItem(id, name, size, ext) {
  const queue = document.getElementById("upload-queue");
  if (!queue) return;

  const item = document.createElement("div");
  item.className = "queue-item";
  item.id = id;
  item.innerHTML = `
    <div class="queue-item-header">
      <div class="queue-file-icon ${fileColorClass(ext)}">${fileIcon(ext)}</div>
      <div class="queue-file-info">
        <div class="queue-file-name">${escHtml(name)}</div>
        <div class="queue-file-size">${formatBytes(size)}</div>
      </div>
      <div class="queue-status">
        <div class="spinner"></div>
      </div>
    </div>
    <div class="progress-bar-wrap">
      <div class="progress-bar" id="pb-${id}"></div>
    </div>
    <div class="queue-message" id="qm-${id}">Uploading…</div>`;
  queue.prepend(item);
}

function updateProgress(id, pct) {
  const bar = document.getElementById(`pb-${id}`);
  const msg = document.getElementById(`qm-${id}`);
  if (bar) bar.style.width = `${pct}%`;
  if (msg) msg.textContent = pct < 100 ? `Uploading… ${pct}%` : "Processing…";
}

function setQueueStatus(id, status, message) {
  const item   = document.getElementById(id);
  const bar    = document.getElementById(`pb-${id}`);
  const msg    = document.getElementById(`qm-${id}`);
  const spinner = item?.querySelector(".queue-status");

  if (bar) { bar.style.width = "100%"; bar.classList.add(status); }
  if (msg) msg.textContent = message;
  if (spinner) {
    spinner.innerHTML = status === "success"
      ? `<span class="badge badge-success">✓ Done</span>`
      : `<span class="badge badge-danger">✕ Failed</span>`;
  }
}

async function loadStats() {
  try {
    const data = await API.stats();
    const el = document.getElementById("upload-stats");
    if (el) el.innerHTML = `
      <div class="info-row"><span class="label">Documents</span><span class="value">${data.total_documents}</span></div>
      <div class="info-row"><span class="label">Indexed Chunks</span><span class="value">${data.total_chunks}</span></div>
      <div class="info-row"><span class="label">DB Status</span><span class="value">${data.db_ready ? "✓ Ready" : "Empty"}</span></div>`;
  } catch { /* silent */ }
}
