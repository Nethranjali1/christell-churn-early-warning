/**
 * Client-side session + role helpers.
 * The real security check happens on the server (requireAuth in Api.php);
 * this file only decides what to SHOW and where to send each role.
 */

// Which pages each role may open (keys match NAV_ITEMS in shell.js)
const ROLE_ACCESS = Object.freeze({
  frontdesk: ["patients", "atrisk", "bookings"],
  manager: ["overview", "patients", "atrisk", "bookings", "doctors", "retention"],
  admin: ["overview", "patients", "atrisk", "bookings", "doctors", "retention"],
});

// Landing page right after sign-in
const ROLE_HOME = Object.freeze({
  frontdesk: "patients.html",
  manager: "dashboard.html",
  admin: "dashboard.html",
});

function canAccess(role, pageKey) {
  return (ROLE_ACCESS[role] || []).includes(pageKey);
}

// Only Manager and Admin may re-score every patient
function canRescore(role) {
  return role === "manager" || role === "admin";
}

function getSession() {
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  const adminRaw = localStorage.getItem(STORAGE_KEYS.ADMIN);
  if (!token || !adminRaw) return null;
  try {
    const admin = JSON.parse(adminRaw);
    // Ignore sessions from the old demo login (they have no valid role)
    if (!admin || !ROLE_HOME[admin.role]) return null;
    return { token, admin };
  } catch (e) {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.TOKEN);
  localStorage.removeItem(STORAGE_KEYS.ADMIN);
}

function requireAuth() {
  const session = getSession();
  if (!session) {
    clearSession();
    window.location.href = "index.html";
    return null;
  }
  return session;
}

async function logout() {
  const session = getSession();
  if (session) {
    try {
      // Tell the server to delete this token
      await fetch(`${API_BASE_URL}/logout.php`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.token}` },
      });
    } catch (e) {
      // Ignore: we clear the browser session anyway
    }
  }
  clearSession();
  window.location.href = "index.html";
}

function mountAdminName() {
  const session = getSession();
  const el = document.querySelector("[data-admin-name]");
  if (el && session) {
    el.textContent = session.admin.display_name || session.admin.username;
  }
}
