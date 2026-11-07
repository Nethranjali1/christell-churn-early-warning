/**
 * Thin fetch wrapper — every API call in the app goes through here so
 * error handling, JSON parsing and the login token stay consistent.
 */
async function apiRequest(url, { method = "GET", body = null } = {}) {
  const headers = { "Content-Type": "application/json" };

  // Attach the login token (not needed for the login request itself)
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  const isLogin = url.includes("login.php");
  if (token && !isLogin) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body !== null) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (networkErr) {
    throw new Error(
      "Could not reach the server. Check that the API base URL in assets/js/config.js matches your local PHP server."
    );
  }

  // Session expired or token invalid: clear it and go back to the login page
  if (response.status === 401 && !isLogin) {
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    localStorage.removeItem(STORAGE_KEYS.ADMIN);
    if (!/index\.html$|\/$/.test(window.location.pathname)) {
      window.location.href = "index.html";
    }
    throw new Error("Your session has expired. Please sign in again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (parseErr) {
    throw new Error(`Server returned an unexpected response (HTTP ${response.status}).`);
  }

  if (!payload || typeof payload.successStatus === "undefined") {
    throw new Error("Unexpected response shape from API.");
  }

  if (!payload.successStatus) {
    throw new Error(payload.message || "Request failed.");
  }

  return payload.data;
}

function buildQuery(params = {}) {
  const query = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return query ? `?${query}` : "";
}
