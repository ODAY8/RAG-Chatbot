/* ============================================================
   register.js — Real account creation via POST /auth/register
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Already logged in → skip to dashboard
  if (Auth.current()) { window.location.href = "/dashboard.html"; return; }

  const form      = document.getElementById("register-form");
  const nameIn    = document.getElementById("reg-name");
  const emailIn   = document.getElementById("reg-email");
  const passIn    = document.getElementById("reg-password");
  const confirmIn = document.getElementById("reg-confirm");
  const toggleBtn = document.getElementById("toggle-pw");
  const submitBtn = document.getElementById("submit-btn");

  // Toggle password visibility
  toggleBtn?.addEventListener("click", () => {
    const show = passIn.type === "password";
    passIn.type           = show ? "text" : "password";
    confirmIn.type        = show ? "text" : "password";
    toggleBtn.textContent = show ? "🙈" : "👁";
  });

  // Live password-strength indicator
  passIn?.addEventListener("input", () => {
    const val      = passIn.value;
    const bar      = document.getElementById("strength-bar");
    const label    = document.getElementById("strength-label");
    if (!bar || !label) return;

    let score = 0;
    if (val.length >= 6)              score++;
    if (val.length >= 10)             score++;
    if (/[A-Z]/.test(val))            score++;
    if (/[0-9]/.test(val))            score++;
    if (/[^A-Za-z0-9]/.test(val))     score++;

    const levels = [
      { w: "0%",   color: "var(--border)",   text: "" },
      { w: "25%",  color: "var(--danger)",   text: "Weak" },
      { w: "50%",  color: "var(--warning)",  text: "Fair" },
      { w: "75%",  color: "var(--primary)",  text: "Good" },
      { w: "100%", color: "var(--success)",  text: "Strong" },
    ];
    const lvl       = levels[Math.min(score, 4)];
    bar.style.width      = lvl.w;
    bar.style.background = lvl.color;
    label.textContent    = lvl.text;
    label.style.color    = lvl.color;
  });

  // Form submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name     = nameIn.value.trim();
    const email    = emailIn.value.trim();
    const password = passIn.value;
    const confirm  = confirmIn.value;

    // Client-side validation
    if (!name || !email || !password || !confirm) {
      toast("Please fill in all fields.", "error");
      return;
    }
    if (name.length < 2) {
      toast("Name must be at least 2 characters.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a valid email address.", "error");
      return;
    }
    if (password.length < 6) {
      toast("Password must be at least 6 characters.", "error");
      return;
    }
    if (password !== confirm) {
      toast("Passwords do not match.", "error");
      confirmIn.focus();
      return;
    }

    submitBtn.disabled  = true;
    submitBtn.innerHTML = `<span class="spinner"></span> Creating account…`;

    try {
      await Auth.registerApi(name, email, password);
      toast("Account created! Redirecting to sign in…", "success");
      setTimeout(() => { window.location.href = "/login.html"; }, 1200);
    } catch (err) {
      toast(err.message || "Registration failed.", "error");
      submitBtn.disabled  = false;
      submitBtn.innerHTML = "Create Account";
    }
  });
});
