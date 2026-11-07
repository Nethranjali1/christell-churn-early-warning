(function () {
  renderShell({ active: "patients", eyebrow: "Every patient on file", title: "Patients" });
 
  const state = {
    search: "",
    page: 1,
    limit: 20,
    sortBy: "created_at",
    sortDir: "DESC",
  };
 
  const searchInput = document.getElementById("searchInput");
  const limitSelect = document.getElementById("limitSelect");
  const body = document.getElementById("patientsBody");
  const resultCount = document.getElementById("resultCount");
  const paginationInfo = document.getElementById("paginationInfo");
  const prevBtn = document.getElementById("prevPageBtn");
  const nextBtn = document.getElementById("nextPageBtn");
 
  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      load();
    }, 350);
  });
 
  limitSelect.addEventListener("change", () => {
    state.limit = Number(limitSelect.value);
    state.page = 1;
    load();
  });
 
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.sort;
      if (state.sortBy === col) {
        state.sortDir = state.sortDir === "ASC" ? "DESC" : "ASC";
      } else {
        state.sortBy = col;
        state.sortDir = "ASC";
      }
      document.querySelectorAll("th.sortable .sort-arrow").forEach((s) => (s.textContent = ""));
      th.querySelector(".sort-arrow").textContent = state.sortDir === "ASC" ? "▲" : "▼";
      load();
    });
  });
 
  prevBtn.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      load();
    }
  });
  nextBtn.addEventListener("click", () => {
    state.page += 1;
    load();
  });
 
  function riskCell(u) {
    if (!u.risk_tier) return `<span style="color:var(--ink-soft)">—</span>`;
    const tier = String(u.risk_tier).toLowerCase();
    return `<span class="risk-pill risk-${tier}"><span class="risk-dot"></span>${escapeHtml(u.risk_tier)}</span>
      <span class="mono" style="font-size:12px;color:var(--ink-soft);margin-left:6px">${Math.round((u.churn_probability || 0) * 100)}%</span>`;
  }

  function renderRows(users) {
    if (!users.length) {
      body.innerHTML = `
        <tr><td colspan="9">
          <div class="state-block">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M21 21L16.65 16.65" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <div class="state-title">No patients found</div>
            <p>Try a different name, NIC or mobile number.</p>
          </div>
        </td></tr>`;
      return;
    }
 
    body.innerHTML = users
      .map(
        (u) => `
      <tr class="clickable" data-user-id="${u.user_id}">
        <td>
          <div class="name-cell">
            <div class="avatar-chip">${initials(u.name)}</div>
            <div>
              <div class="cell-name">${escapeHtml(u.name)}</div>
              <div class="cell-sub">${u.number_of_unique_services} service${u.number_of_unique_services === 1 ? "" : "s"} tried</div>
            </div>
          </div>
        </td>
        <td class="mono">${escapeHtml(u.nic)}</td>
        <td class="mono">${escapeHtml(u.mobile_no)}</td>
        <td>${u.age} · ${escapeHtml(u.gender)}</td>
        <td class="cell-strong">${u.total_visits}</td>
        <td class="cell-strong">${formatCurrency(u.total_spend)}</td>
        <td>${u.last_visit ? formatDate(u.last_visit) : "Never"}</td>
        <td>${riskCell(u)}</td>
        <td><span class="badge ${statusBadgeClass(u.status)}">${u.status}</span></td>
      </tr>`
      )
      .join("");
 
    body.querySelectorAll("tr[data-user-id]").forEach((row) => {
      row.addEventListener("click", () => openPatient(row.dataset.userId));
    });
  }
 
  async function load() {
    body.innerHTML = `<tr><td colspan="9"><div class="skeleton" style="height:18px;"></div></td></tr>`;
    try {
      const query = buildQuery({
        search: state.search,
        page: state.page,
        limit: state.limit,
        sort_by: state.sortBy,
        sort_dir: state.sortDir,
      });
      const data = await apiRequest(`${API_ENDPOINTS.USERS}${query}`);
      renderRows(data.users);
      const { page, total, total_pages, limit } = data.pagination;
      resultCount.textContent = `${total} patient${total === 1 ? "" : "s"}`;
      const start = total === 0 ? 0 : (page - 1) * limit + 1;
      const end = Math.min(page * limit, total);
      paginationInfo.textContent = `Showing ${start}–${end} of ${total}`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= total_pages;
    } catch (err) {
      showToast(err.message, "error");
      body.innerHTML = `<tr><td colspan="9"><div class="state-block"><div class="state-title">Couldn't load patients</div><p>${escapeHtml(err.message)}</p></div></td></tr>`;
    }
  }
 
  // ---------------- Slide-over patient detail ----------------
  const scrim = document.getElementById("overlayScrim");
  const slideOver = document.getElementById("patientSlideOver");
  const slideCloseBtn = document.getElementById("slideCloseBtn");
  const slideOverName = document.getElementById("slideOverName");
  const slideOverBody = document.getElementById("slideOverBody");
 
  function closeSlideOver() {
    scrim.classList.remove("open");
    slideOver.classList.remove("open");
  }
  scrim.addEventListener("click", closeSlideOver);
  slideCloseBtn.addEventListener("click", closeSlideOver);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSlideOver();
  });
 
  async function openPatient(userId) {
    scrim.classList.add("open");
    slideOver.classList.add("open");
    slideOverName.textContent = "Loading…";
    slideOverBody.innerHTML = `
      <div class="skeleton" style="height:80px; margin-bottom:16px;"></div>
      <div class="skeleton" style="height:200px;"></div>`;
 
    try {
      const data = await apiRequest(`${API_ENDPOINTS.USER_DETAILS}${buildQuery({ user_id: userId })}`);
      renderPatientDetail(data);
    } catch (err) {
      slideOverName.textContent = "Error";
      slideOverBody.innerHTML = `<div class="state-block"><div class="state-title">Couldn't load this patient</div><p>${escapeHtml(err.message)}</p></div>`;
    }
  }
 
  function renderPatientDetail(data) {
    const p = data.profile;
    slideOverName.textContent = p.name;
 
    slideOverBody.innerHTML = `
      <div class="tabs">
        <button class="tab-btn active" data-tab="profile">Profile</button>
        <button class="tab-btn" data-tab="bookings">Bookings (${data.bookings.length})</button>
        <button class="tab-btn" data-tab="treatments">Treatments (${data.treatments.length})</button>
      </div>
 
      <div class="tab-panel active" data-panel="profile">
        <div style="display:flex; gap:10px; margin-bottom:20px;">
          <span class="badge ${statusBadgeClass(p.status)}">${p.status}</span>
          <span class="badge badge-neutral">${p.total_bookings} total bookings</span>
          <button class="btn btn-ghost btn-sm" type="button" id="logContactBtn" style="margin-left:auto;">Log contact</button>
        </div>
 
        ${
          p.status === "Active"
            ? `
        <div class="pulse-check-card">
          <div class="pulse-check-copy">
            <div class="title">Pulse Check — Churn Forecast</div>
            <div class="sub">Run this patient's recent visit &amp; spend pattern through the early-warning model.</div>
          </div>
          <button class="pulse-check-btn" id="pulseCheckBtn" data-user-id="${p.user_id}" data-user-name="${escapeHtml(p.name)}">
            <svg class="mini-heartbeat" viewBox="0 0 60 24" xmlns="http://www.w3.org/2000/svg"><path d="M0 12H16L20 3L26 21L31 12H37L41 6L45 18L48 12H60"/></svg>
            Run Pulse Check
          </button>
        </div>`
            : ""
        }
 
        <div class="info-grid">
          <div class="info-item"><div class="label">NIC</div><div class="value mono">${escapeHtml(p.nic)}</div></div>
          <div class="info-item"><div class="label">Mobile</div><div class="value mono">${escapeHtml(p.mobile_no)}</div></div>
          <div class="info-item"><div class="label">Age / Gender</div><div class="value">${p.age} · ${escapeHtml(p.gender)}</div></div>
          <div class="info-item"><div class="label">Date of birth</div><div class="value">${formatDate(p.date_of_birth)}</div></div>
          <div class="info-item" style="grid-column: 1 / -1;"><div class="label">Address</div><div class="value">${escapeHtml(p.address)}</div></div>
          <div class="info-item" style="grid-column: 1 / -1;"><div class="label">Past medical history</div><div class="value">${p.past_medical_history ? escapeHtml(p.past_medical_history) : "None recorded"}</div></div>
          <div class="info-item"><div class="label">Total spend (completed)</div><div class="value mono">${formatCurrency(p.total_spend)}</div></div>
          <div class="info-item"><div class="label">Patient since</div><div class="value">${formatDate(p.created_at)}</div></div>
        </div>
      </div>
 
      <div class="tab-panel" data-panel="bookings">
        ${
          data.bookings.length
            ? data.bookings
                .map(
                  (b) => `
              <div class="timeline-item ${b.booking_status.toLowerCase().replace(/\s+/g, "-")}">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-top">
                    <span class="timeline-date">${formatDateTime(b.appointment_date)}</span>
                    <span class="badge ${statusBadgeClass(b.booking_status)}">${b.booking_status}</span>
                  </div>
                  <div class="timeline-meta">${b.treatment_count} treatment${b.treatment_count === 1 ? "" : "s"} · ${formatCurrency(b.booking_spend)}</div>
                </div>
              </div>`
                )
                .join("")
            : `<div class="state-block"><div class="state-title">No bookings yet</div></div>`
        }
      </div>
 
      <div class="tab-panel" data-panel="treatments">
        ${
          data.treatments.length
            ? data.treatments
                .map(
                  (t) => `
              <div class="timeline-item ${t.treatment_status.toLowerCase().replace(/\s+/g, "-")}">
                <div class="timeline-dot"></div>
                <div class="timeline-content">
                  <div class="timeline-top">
                    <span class="timeline-date">${escapeHtml(t.category_name)}</span>
                    <span class="badge ${statusBadgeClass(t.treatment_status)}">${t.treatment_status}</span>
                  </div>
                  <div class="timeline-meta">Dr. ${escapeHtml(t.doctor_name)} · ${t.treatment_date ? formatDate(t.treatment_date) : "Date TBD"} · ${formatCurrency(t.amount_spent)}</div>
                </div>
              </div>`
                )
                .join("")
            : `<div class="state-block"><div class="state-title">No treatments recorded</div></div>`
        }
      </div>
    `;
 
    slideOverBody.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        slideOverBody.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        slideOverBody.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        slideOverBody.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add("active");
      });
    });
 
    const logBtn = slideOverBody.querySelector("#logContactBtn");
    if (logBtn) {
      logBtn.addEventListener("click", () => openRetentionModal({ userId: Number(p.user_id), name: p.name }));
    }

    const pulseBtn = slideOverBody.querySelector("#pulseCheckBtn");
    if (pulseBtn) {
      pulseBtn.addEventListener("click", () => {
        runPulseCheck(pulseBtn.dataset.userId, pulseBtn.dataset.userName, pulseBtn);
      });
    }
  }
 
  // ---------------- Pulse Check (churn forecast) modal ----------------
  const churnScrim = document.getElementById("churnModalScrim");
  const churnModal = document.getElementById("churnModal");
 
  function openChurnModal() {
    churnScrim.classList.add("open");
  }
  function closeChurnModal() {
    churnScrim.classList.remove("open");
  }
  churnScrim.addEventListener("click", (e) => {
    if (e.target === churnScrim) closeChurnModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeChurnModal();
  });
 
  function renderChurnLoading(patientName) {
    churnModal.innerHTML = `
      <div class="churn-modal-head">
        <div>
          <span class="eyebrow">Pulse Check</span>
          <h2>${escapeHtml(patientName)}</h2>
        </div>
        <button class="churn-modal-close" id="churnCloseBtn" aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="churn-modal-body">
        <div class="churn-loading">
          <svg class="pulse-line" viewBox="0 0 400 46" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 23 H120 L138 23 L150 4 L165 42 L178 23 L192 23 L204 12 L216 34 L228 23 L400 23" />
          </svg>
          <p>Reading recent visits &amp; spend, consulting the early-warning model…</p>
        </div>
      </div>`;
    document.getElementById("churnCloseBtn").addEventListener("click", closeChurnModal);
  }
 
  function renderChurnError(patientName, message) {
    churnModal.innerHTML = `
      <div class="churn-modal-head">
        <div>
          <span class="eyebrow">Pulse Check</span>
          <h2>${escapeHtml(patientName)}</h2>
        </div>
        <button class="churn-modal-close" id="churnCloseBtn" aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="churn-modal-body">
        <div class="churn-error-block">
          <div class="icon-wrap">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 8V13M12 16.5V16.51M10.29 3.86L1.82 18A2 2 0 0 0 3.55 21H20.45A2 2 0 0 0 22.18 18L13.71 3.86A2 2 0 0 0 10.29 3.86Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="title">Couldn't run the forecast</div>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>`;
    document.getElementById("churnCloseBtn").addEventListener("click", closeChurnModal);
  }
 
  function riskTierClass(tier) {
    const key = (tier || "").toLowerCase();
    if (key === "low") return "risk-low";
    if (key === "high") return "risk-high";
    return "risk-medium";
  }
  function riskTierStroke(tier) {
    const key = (tier || "").toLowerCase();
    if (key === "low") return "var(--success-500)";
    if (key === "high") return "var(--coral-500)";
    return "var(--gold-500)";
  }
 
  function renderChurnResult(patientName, features, prediction) {
    const pct = Math.round((prediction.churn_probability || 0) * 100);
    const ins = deriveRiskInsights(features, prediction);
    const gaugeTick = (fr) => {
      const a = Math.PI * fr;
      return `<line class="gauge-tick" x1="${100 - 76 * Math.cos(a)}" y1="${110 - 76 * Math.sin(a)}" x2="${100 - 96 * Math.cos(a)}" y2="${110 - 96 * Math.sin(a)}" />`;
    };
    const insightsHtml = `
        <div class="insight-row">
          <span class="insight-chip ${ins.daysLeft <= 30 ? "warn" : ""}">Becomes inactive in ${ins.daysLeft} days</span>
          ${ins.limited ? `<span class="insight-chip warn">Limited history: first visit only</span>` : ""}
        </div>
        ${ins.history !== null ? `<p class="insight-note">About ${ins.history}% of ${escapeHtml(ins.tier)}-tier patients churned in validation. Read the percentage as a tier guide, not an exact chance.</p>` : ""}`;
    const tierClass = riskTierClass(prediction.risk_tier);
    const strokeColor = riskTierStroke(prediction.risk_tier);
 
    const r = 86;
    const arcLength = Math.PI * r;
 
    churnModal.innerHTML = `
      <div class="churn-modal-head">
        <div>
          <span class="eyebrow">Pulse Check · Churn Forecast</span>
          <h2>${escapeHtml(patientName)}</h2>
        </div>
        <button class="churn-modal-close" id="churnCloseBtn" aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="churn-modal-body">
 
        <div class="gauge-wrap">
          <div class="gauge-ring">
            <svg viewBox="0 0 200 120">
              <path class="gauge-track" d="M14,110 A86,86 0 1 1 186,110" />
              <path class="gauge-fill" id="gaugeFillPath" d="M14,110 A86,86 0 1 1 186,110"
                    stroke="${strokeColor}"
                    stroke-dasharray="${arcLength}"
                    stroke-dashoffset="${arcLength}" />
              ${gaugeTick(0.35)}${gaugeTick(0.55)}
            </svg>
            <div class="gauge-center">
              <div class="gauge-value" id="gaugeValue">0%</div>
              <div class="gauge-label">Churn probability</div>
            </div>
          </div>
          <div class="risk-pill ${tierClass}">
            <span class="risk-dot"></span>
            ${escapeHtml(prediction.risk_tier || "Unknown")} risk
          </div>
        </div>
 
        <div class="action-callout">
          <div class="icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18H15M10 21H14M12 3C8.5 3 6 5.7 6 9C6 11.2 7 12.6 8 13.7C8.7 14.5 9 15 9 16H15C15 15 15.3 14.5 16 13.7C17 12.6 18 11.2 18 9C18 5.7 15.5 3 12 3Z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div>
            <div class="label">Recommended action</div>
            <div class="text">${escapeHtml(ins.action || "No recommendation returned")}</div>
          </div>
        </div>
 
        ${insightsHtml}
 
        <div class="feature-chip-grid">
          <div class="feature-chip"><div class="label">Days since last visit</div><div class="value">${features.Days_Since_Last_Visit_At_Cutoff}</div></div>
          <div class="feature-chip"><div class="label">Visits, last 90 days</div><div class="value">${features.Visits_Last_90_Days_Before_Cutoff}</div></div>
          <div class="feature-chip"><div class="label">Spend, last 90 days</div><div class="value">${formatCurrency(features.Spend_Last_90_Days_Before_Cutoff_LKR)}</div></div>
          <div class="feature-chip"><div class="label">Avg. visit interval</div><div class="value">${ins.limited ? "n/a" : features.Avg_Visit_Interval_To_Date + "d"}</div></div>
        </div>
 
        <div class="churn-modal-foot">
          <span>Preferred service: ${escapeHtml(features.Preferred_Service_Category)}</span>
          <span class="model-tag">${escapeHtml(prediction.model_version || "model")}</span>
        </div>
      </div>`;
 
    document.getElementById("churnCloseBtn").addEventListener("click", closeChurnModal);
 
    // Animate gauge fill + counting number after paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fraction = Math.min(1, Math.max(0, prediction.churn_probability || 0));
        document.getElementById("gaugeFillPath").style.strokeDashoffset = String(arcLength * (1 - fraction));
      }, 50);
    });
 
    const valueEl = document.getElementById("gaugeValue");
    const duration = 900;
    const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      valueEl.textContent = Math.round(eased * pct) + "%";
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
 
  async function runPulseCheck(userId, patientName, triggerBtn) {
    if (triggerBtn) {
      triggerBtn.disabled = true;
    }
    openChurnModal();
    renderChurnLoading(patientName);
    try {
      const data = await apiRequest(API_ENDPOINTS.PREDICT_CHURN, {
        method: "POST",
        body: { user_id: userId },
      });
      renderChurnResult(data.patient_name || patientName, data.features, data.prediction);
    } catch (err) {
      renderChurnError(patientName, err.message);
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }
 
  // Open a patient directly from a link such as patients.html#patient=12
  const hashMatch = location.hash.match(/^#patient=(\d+)$/);
  if (hashMatch) openPatient(hashMatch[1]);

  load();
})();