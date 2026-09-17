/* ============================================================
   settings.js
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  if (!Auth.require()) return;
  initSidebar();
  initLogout();
  loadSettings();
  bindSave();
  bindNavItems();
  bindSliders();
});

function loadSettings() {
  const s    = Settings.get();
  const user = Auth.current();

  setValue("model-select", s.model);
  setValue("temperature",  s.temperature);
  setValue("top-k",        s.top_k);
  setValue("user-name",    user?.name  || "");
  setValue("user-email",   user?.email || "");

  updateSliderDisplay("temperature", s.temperature);
  updateSliderDisplay("top-k",       s.top_k);
}

function bindSave() {
  document.querySelectorAll("[data-save]").forEach(btn =>
    btn.addEventListener("click", saveSettings)
  );
}

function saveSettings() {
  const s = {
    model:       getValue("model-select") || "openai/gpt-oss-120b",
    temperature: parseFloat(getValue("temperature") || 0.2),
    top_k:       parseInt(getValue("top-k") || 3, 10),
  };
  Settings.save(s);
  toast("Settings saved successfully!", "success");
}

function bindSliders() {
  ["temperature", "top-k"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", (e) => {
      updateSliderDisplay(id, e.target.value);
    });
  });
}

function updateSliderDisplay(id, value) {
  const display = document.getElementById(`${id}-display`);
  if (display) display.textContent = value;
}

function bindNavItems() {
  document.querySelectorAll(".settings-nav-item").forEach(item => {
    item.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav-item").forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      const target = item.dataset.target;
      if (target) document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function getValue(id) { return document.getElementById(id)?.value; }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ""; }
