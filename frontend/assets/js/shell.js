/**
 * Renders the sidebar + topbar shell that every protected page shares.
 * Call renderShell({ active, title, eyebrow }) after DOM is ready.
 */
const NAV_ITEMS = [
  {
    key: "overview",
    href: "dashboard.html",
    label: "Overview",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12L12 3L21 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10V21H19V10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },
  {
    key: "patients",
    href: "patients.html",
    label: "Patients",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 21C3 17 5.5 15 9 15C12.5 15 15 17 15 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 9C17.5 9 18.6 10.1 18.6 11.5C18.6 12.9 17.5 14 16 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M15 21C15 17.8 16.6 16 19 16C21.5 16 22.5 17.8 22.5 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  },
  {
    key: "atrisk",
    href: "at-risk.html",
    label: "At-Risk",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3L2.5 20H21.5L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10V14M12 17V17.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  },
  {
    key: "bookings",
    href: "bookings.html",
    label: "Bookings",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 3V7M16 3V7M3 10H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  },
  {
    key: "doctors",
    href: "doctors.html",
    label: "Doctors",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 3V8C9 10.2 10.8 12 13 12V12C15.2 12 17 10.2 17 8V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M13 12V15C13 18.3 15.7 20 19 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="20.5" cy="20.5" r="1.8" stroke="currentColor" stroke-width="1.6"/><path d="M6 3V8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  },
  {
    key: "retention",
    href: "retention-report.html",
    label: "Retention",
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 19V10M10 19V5M16 19V13M22 19V3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  },  
];
 
function renderShell({ active, title, eyebrow, searchPlaceholder = null }) {
  const session = requireAuth();
  if (!session) return;
  if (!canAccess(session.admin.role, active)) {
    window.location.href = ROLE_HOME[session.admin.role] || "index.html";
    return;
  }
 
  const sidebarMount = document.getElementById("sidebarMount");
  const topbarMount = document.getElementById("topbarMount");
 
  const initials = (session.admin.display_name || session.admin.username || "A")
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
 
  sidebarMount.innerHTML = `
    <div class="brand">
      <svg class="brand-mark" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="20" cy="20" r="19" stroke="#dba758" stroke-width="1.5"/>
        <path d="M6 20H13L16 12L21 28L25 16L27 20H34" stroke="#dba758" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <div>
        <div class="brand-name">Christell</div>
        <div class="brand-sub">Wellness Console</div>
      </div>
    </div>
    <div class="nav-group-label">Menu</div>
    ${NAV_ITEMS.filter((item) => canAccess(session.admin.role, item.key)).map(
      (item) => `
      <a class="nav-link ${item.key === active ? "active" : ""}" href="${item.href}">
        ${item.icon}<span>${item.label}</span>
      </a>`
    ).join("")}
    <div class="sidebar-footer">
      <div class="admin-chip">
        <div class="admin-avatar">${initials}</div>
        <div class="admin-meta">
          <div class="name" data-admin-name>${session.admin.display_name || session.admin.username}</div>
          <div class="role">${session.admin.role_label || session.admin.role}</div>
        </div>
      </div>
      <button class="logout-btn" id="logoutBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M9 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 17L21 12L16 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12H9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        Sign out
      </button>
    </div>
  `;
 
  topbarMount.innerHTML = `
    <div class="topbar-title">
      <span class="eyebrow">${eyebrow || ""}</span>
      <h1>${title}</h1>
    </div>
    ${
      searchPlaceholder
        ? `<div class="topbar-search">
            <div class="input-icon-wrap">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.8"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              <input type="text" id="globalSearch" placeholder="${searchPlaceholder}" />
            </div>
          </div>`
        : `<div></div>`
    }
    <div style="display:flex; align-items:center; gap:14px;">
      <span class="mono" style="font-size:12px; color: var(--ink-soft);" id="clockDisplay"></span>
    </div>
  `;
 
  document.getElementById("logoutBtn").addEventListener("click", logout);

  // Front Desk cannot re-score every patient (the server blocks it too)
  const rescoreBtn = document.getElementById("refreshBtn");
  if (rescoreBtn && !canRescore(session.admin.role)) rescoreBtn.style.display = "none";
 
  const clockEl = document.getElementById("clockDisplay");
  function tickClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  tickClock();
  setInterval(tickClock, 30000);
}
 
function showToast(message, type = "success") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  stack.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3600);
}
 
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
 
function initials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
 
function formatDate(dateStr, opts = {}) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T"));
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...opts,
  });
}
 
function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr.replace(" ", "T"));
  if (isNaN(d)) return dateStr;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
 
function formatCurrency(amount) {
  const n = Number(amount || 0);
  return "LKR " + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
 
function statusBadgeClass(status) {
  if (!status) return "badge-neutral";
  const key = status.toLowerCase().replace(/\s+/g, "-");
  return `badge-${key}`;
}
 
// Churn-score endpoints (built from API_BASE_URL in config.js, so no config change is needed)
const CHURN_API = Object.freeze({
  SCORES: `${API_BASE_URL}/get_churn_scores.php`,
  SCORE_ALL: `${API_BASE_URL}/score_all_churn.php`,
});

// Shared churn helpers (used by the Pulse Check modal and the At-Risk page)
const TIER_HISTORY = { low: 17, medium: 32, high: 65 }; // % churned per tier on the holdout set (report, Section 6.7)
function deriveRiskInsights(f, p) {
  const days = Number(f.Days_Since_Last_Visit_At_Cutoff) || 0;
  const visits = Number(f.Number_of_Visits_To_Date) || 0;
  const interval = Number(f.Avg_Visit_Interval_To_Date) || 0;
  const tier = String(p.risk_tier || "").toLowerCase();
  const limited = visits < 2; // interval is a fallback when only one visit exists
  const daysLeft = Math.max(0, 90 - days);
  let action = p.recommended_action || "";
  if (tier === "low" && (!action || /no action/i.test(action))) {
    if (limited) action = "Routine: first-visit patient. Send a thank-you and a rebooking reminder.";
    else if (days >= interval) action = "Routine: due for a visit (usual gap about " + Math.round(interval) + " days). Send a friendly reminder.";
    else if (interval - days > daysLeft) action = "Routine, but their usual gap (about " + Math.round(interval) + " days) is longer than the time left before they count as inactive (" + daysLeft + " days). Send a friendly reminder before they lapse.";
    else action = "Routine: no outreach needed. Next visit expected in about " + Math.round(interval - days) + " days.";
  }
  return { daysLeft, limited, action, tier, history: TIER_HISTORY[tier] ?? null };
}