(function () {
  renderShell({ active: "overview", eyebrow: "Clinic pulse", title: "Overview" });

  const ICONS = {
    patients:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3 21C3 17 5.5 15 9 15C12.5 15 15 17 15 21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    active:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 12H7L9.5 5L14.5 19L17 12H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    calendar:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8 3V7M16 3V7M3 10H21" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    revenue:
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2V22M17 7C17 5 15 4 12 4C9 4 7 5.5 7 7.5C7 9.5 9 10.5 12 11C15 11.5 17 12.5 17 15C17 17 15 18.5 12 18.5C9 18.5 7 17.5 7 15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };

  function statCard({ icon, tone, label, value, delta }) {
    return `
      <div class="card stat-card">
        <div class="stat-label">
          <span class="stat-icon icon-tone-${tone}">${icon}</span>
          ${label}
        </div>
        <div class="stat-value">${value}</div>
        ${delta ? `<div class="stat-delta">${delta}</div>` : ""}
      </div>`;
  }

  function renderStatGrid(stats) {
    const grid = document.getElementById("statGrid");
    grid.innerHTML =
      statCard({
        icon: ICONS.patients,
        tone: "teal",
        label: "Total patients",
        value: stats.total_patients.toLocaleString(),
        delta: `<strong>${stats.active_patients}</strong> active in last 90 days`,
      }) +
      statCard({
        icon: ICONS.active,
        tone: "sage",
        label: "Total bookings",
        value: stats.total_bookings.toLocaleString(),
        delta: `${stats.upcoming_bookings} upcoming`,
      }) +
      statCard({
        icon: ICONS.calendar,
        tone: "gold",
        label: "Today's bookings",
        value: stats.todays_bookings.toLocaleString(),
        delta: `${stats.total_doctors} doctors on staff`,
      }) +
      statCard({
        icon: ICONS.revenue,
        tone: "coral",
        label: "Revenue (completed)",
        value: formatCurrency(stats.total_revenue),
        delta: "All-time, completed treatments",
      });
  }

  function renderTrend(trend) {
    const el = document.getElementById("trendChart");
    const max = Math.max(1, ...trend.map((t) => t.total));
    const bars = trend
      .map((t) => {
        const heightPct = Math.round((t.total / max) * 100);
        const label = new Date(t.date + "T00:00:00").toLocaleDateString(undefined, {
          weekday: "short",
        });
        return `
        <div style="display:flex; flex-direction:column; align-items:center; gap:8px; flex:1;">
          <div style="font-size:11.5px; font-weight:700; color: var(--ink-soft);">${t.total}</div>
          <div style="width:100%; max-width:34px; height:140px; display:flex; align-items:flex-end; background:var(--paper); border-radius:8px; overflow:hidden;">
            <div style="width:100%; height:${Math.max(heightPct, 4)}%; background:linear-gradient(180deg, var(--gold-400), var(--gold-500)); border-radius:8px 8px 0 0; transition: height 0.4s ease;"></div>
          </div>
          <div style="font-size:11.5px; color: var(--ink-soft); font-weight:600;">${label}</div>
        </div>`;
      })
      .join("");
    el.innerHTML = `<div style="display:flex; gap:10px; align-items:flex-end;">${bars}</div>`;
    document.getElementById("trendSubtitle").textContent =
      `${trend.reduce((s, t) => s + t.total, 0)} bookings this week`;
  }

  function renderTopCategories(categories) {
    const el = document.getElementById("topCategories");
    if (!categories.length) {
      el.innerHTML = `<div class="state-block" style="padding:20px 0;">No completed treatments yet.</div>`;
      return;
    }
    const max = Math.max(1, ...categories.map((c) => Number(c.treatment_count)));
    el.innerHTML = categories
      .map((c) => {
        const pct = Math.round((Number(c.treatment_count) / max) * 100);
        return `
        <div style="margin-bottom:16px;">
          <div style="display:flex; justify-content:space-between; font-size:13.5px; margin-bottom:6px;">
            <span style="font-weight:700;">${escapeHtml(c.category_name)}</span>
            <span class="mono" style="color:var(--ink-soft);">${c.treatment_count} · ${formatCurrency(c.revenue)}</span>
          </div>
          <div style="height:8px; background:var(--paper); border-radius:6px; overflow:hidden;">
            <div style="height:100%; width:${pct}%; background: var(--teal-800); border-radius:6px;"></div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderRecentBookings(bookings) {
    const body = document.getElementById("recentBookingsBody");
    if (!bookings.length) {
      body.innerHTML = `<tr><td colspan="4" class="state-block">No bookings yet.</td></tr>`;
      return;
    }
    body.innerHTML = bookings
      .map(
        (b) => `
      <tr>
        <td>
          <div class="name-cell">
            <div class="avatar-chip">${initials(b.patient_name)}</div>
            <span class="cell-name">${escapeHtml(b.patient_name)}</span>
          </div>
        </td>
        <td class="mono">${escapeHtml(b.mobile_no)}</td>
        <td>${formatDateTime(b.appointment_date)}</td>
        <td><span class="badge ${statusBadgeClass(b.status_name)}">${escapeHtml(b.status_name)}</span></td>
      </tr>`
      )
      .join("");
  }

  async function load() {
    try {
      const stats = await apiRequest(API_ENDPOINTS.DASHBOARD_STATS);
      renderStatGrid(stats);
      renderTrend(stats.bookings_trend);
      renderTopCategories(stats.top_categories);
      renderRecentBookings(stats.recent_bookings);
    } catch (err) {
      showToast(err.message, "error");
      document.getElementById("statGrid").innerHTML = `
        <div class="card state-block" style="grid-column: 1 / -1;">
          <div class="state-title">Couldn't load clinic stats</div>
          <p>${escapeHtml(err.message)}</p>
        </div>`;
    }
  }

  async function loadRetention() {
    const el = document.getElementById("retentionBody");
    try {
      const d = await apiRequest(`${CHURN_API.SCORES}?summary=1`);
      if (d.setup_needed || !d.run) {
        el.innerHTML = `<div class="state-block" style="padding:12px 0;"><div class="state-title">${d.setup_needed ? "Churn scoring isn't set up yet" : "No churn scores yet"}</div>
          <p>${d.setup_needed ? "Run php-backend/sql/churn_scores.sql once, then open the At-Risk page." : "Open the At-Risk page and click Re-score."}</p></div>`;
        return;
      }
      const s = d.summary;
      const stat = (label, value, color) => `
        <div><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft);font-weight:700;">${label}</div>
        <div style="font-family:var(--font-display);font-size:28px;font-weight:600;color:${color};">${value}</div></div>`;
      const top = d.scores.length
        ? d.scores.map((p) => `
            <a href="patients.html#patient=${p.user_id}" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--line);color:inherit;text-decoration:none;">
              <span class="cell-name">${escapeHtml(p.name)}</span>
              <span><span class="risk-pill risk-${String(p.risk_tier).toLowerCase()}"><span class="risk-dot"></span>${escapeHtml(p.risk_tier)}</span>
              <span class="mono" style="font-size:12px;color:var(--ink-soft);margin-left:6px;">${Math.round(p.churn_probability * 100)}%</span></span>
            </a>`).join("")
        : `<div style="color:var(--ink-soft);padding-top:8px;">No High or Medium risk patients in the latest run.</div>`;
      el.innerHTML = `
        <div style="display:flex;gap:36px;flex-wrap:wrap;margin-bottom:14px;">
          ${stat("High", s.high, "var(--coral-text)")}${stat("Medium", s.medium, "var(--gold-text)")}${stat("Low", s.low, "var(--success-text)")}
          ${stat("Lifetime spend, High + Medium", `<span style="font-size:20px;">${formatCurrency(s.at_risk_spend)}</span>`, "var(--ink)")}
        </div>
        ${top}
        <div class="insight-note">Scored ${formatDateTime(d.run.scored_at)} · ${d.run.scored_count} patients${d.run.skipped_count ? ` · ${d.run.skipped_count} need manual review` : ""}</div>`;
    } catch (err) {
      el.innerHTML = `<div class="state-block" style="padding:12px 0;"><div class="state-title">Couldn't load churn scores</div><p>${escapeHtml(err.message)}</p></div>`;
    }
  }

  load();
  loadRetention();
})();