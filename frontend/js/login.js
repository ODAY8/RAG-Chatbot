/* ============================================================
   login.js — Real authentication against POST /auth/login
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Already logged in → skip straight to dashboard
  if (Auth.current()) { window.location.href = "/dashboard.html"; return; }

  const form      = document.getElementById("login-form");
  const emailIn   = document.getElementById("email");
  const passIn    = document.getElementById("password");
  const toggleBtn = document.getElementById("toggle-pw");
  const submitBtn = document.getElementById("submit-btn");

  // Toggle password visibility
  toggleBtn?.addEventListener("click", () => {
    const show = passIn.type === "password";
    passIn.type           = show ? "text" : "password";
    toggleBtn.textContent = show ? "🙈" : "👁";
  });

  // Sign-in form submit
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email    = emailIn.value.trim();
    const password = passIn.value;

    // Client-side validation
    if (!email || !password) {
      toast("Please fill in all fields.", "error");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast("Enter a valid email address.", "error");
      return;
    }

    submitBtn.disabled   = true;
    submitBtn.innerHTML  = `<span class="spinner"></span> Signing in…`;

    try {
      const data = await Auth.loginApi(email, password);
      Auth.login(data.user);                          // persist session
      toast("Welcome back! Redirecting…", "success");
      setTimeout(() => { window.location.href = "/dashboard.html"; }, 600);
    } catch (err) {
      toast(err.message || "Sign-in failed.", "error");
      submitBtn.disabled  = false;
      submitBtn.innerHTML = "Sign In";
    }
  });
});
