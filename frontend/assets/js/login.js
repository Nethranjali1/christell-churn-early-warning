(function () {
  // If already logged in, skip straight to dashboard.
  if (getSession()) {
    window.location.href = ROLE_HOME[getSession().admin.role] || "dashboard.html";
    return;
  }

  const form = document.getElementById("loginForm");
  const errorBox = document.getElementById("loginError");
  const errorText = document.getElementById("loginErrorText");
  const loginBtn = document.getElementById("loginBtn");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  function showError(message) {
    errorText.textContent = message;
    errorBox.classList.add("show");
  }
  function hideError() {
    errorBox.classList.remove("show");
  }

  // ---- Show / hide password ----
  const toggleBtn = document.getElementById("togglePassword");
  if (toggleBtn) {
    const iconEye = toggleBtn.querySelector(".icon-eye");
    const iconEyeOff = toggleBtn.querySelector(".icon-eye-off");

    toggleBtn.addEventListener("click", () => {
      const isHidden = passwordInput.type === "password";
      passwordInput.type = isHidden ? "text" : "password";
      iconEye.style.display = isHidden ? "none" : "";
      iconEyeOff.style.display = isHidden ? "" : "none";

      const label = isHidden ? "Hide password" : "Show password";
      toggleBtn.setAttribute("aria-label", label);
      toggleBtn.setAttribute("title", label);
      passwordInput.focus();
    });
  }

  // Hide the error message as soon as the user starts typing again.
  usernameInput.addEventListener("input", hideError);
  passwordInput.addEventListener("input", hideError);

  // ---- Submit ----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    loginBtn.disabled = true;
    loginBtn.textContent = "Signing in…";

    try {
      const data = await apiRequest(API_ENDPOINTS.LOGIN, {
        method: "POST",
        body: { username, password },
      });
      localStorage.setItem(STORAGE_KEYS.TOKEN, data.token);
      localStorage.setItem(STORAGE_KEYS.ADMIN, JSON.stringify(data.admin));
      window.location.href = ROLE_HOME[data.admin.role] || "dashboard.html";
    } catch (err) {
      showError(err.message || "Something went wrong. Please try again.");
      loginBtn.disabled = false;
      loginBtn.textContent = "Sign In";
    }
  });
})();