(function () {
  renderShell({ active: "atrisk", eyebrow: "Early-warning list", title: "At-Risk Patients" });

  const state = { rows: [], skipped: [], run: null, summary: null, filter: "all", busy: false, latest: {} };
  const $ = (id) => document.getElementById(id);
     const SESSION = getSession();
   const CAN_SEE_SPEND = !!SESSION && SESSION.admin.role !== "frontdesk";

  // ---- Plain-language reasons for patients who could not be scored ----
  function plainReason(msg) {
    const m = String(msg || "");
    let x;
    if ((x = m.match(/age \((\d+)\)/))) return `age ${x[1]} is outside the range the tool supports (18–75)`;
    if (/no attended bookings/i.test(m)) return "no completed visits yet, so there is not enough history to score";
    if (/gender/i.test(m)) return "gender is not recorded as Male or Female, which the tool needs";
    if (/ml category|preferred service category/i.test(m)) return "their main treatment has no category set up for the tool";
    if (/could not reach|unexpected response/i.test(m)) return "the scoring service could not be reached. Try Re-score";
    return m;
  }

  function elapsedDays(run) {
    if (!run || !run.scored_at) return 0;
    const t = new Date(String(run.scored_at).replace(" ", "T"));
    const d = Math.floor((Date.now() - t.getTime()) / 86400000);
    return isNaN(d) || d < 0 ? 0 : d;
  }

  function mapRows(data) {
    const age = elapsedDays(data.run);
    return data.scores.map((s) => {
      const f = s.features || {};
      // The score was calculated at scoring time; move the day counters forward to today.
      const fNow = { ...f, Days_Since_Last_Visit_At_Cutoff: (Number(f.Days_Since_Last_Visit_At_Cutoff) || 0) + age };
      const p = { churn_probability: s.churn_probability, risk_tier: s.risk_tier, recommended_action: s.recommended_action };
      return {
        user: { user_id: s.user_id, name: s.name, nic: s.nic, total_spend: s.total_spend, last_visit: s.last_visit },
        p, f,
        ins: deriveRiskInsights(fNow, p),
      };
    });
  }

  // Most recent outreach per patient (silently ignored if the retention table is not set up yet)
  async function loadLatest() {
    state.latest = {};
    try {
      const d = await apiRequest(`${RETENTION_API.LIST}?latest=1`);
      d.latest.forEach((x) => { state.latest[x.user_id] = x; });
    } catch (e) { /* keep empty */ }
  }

  function outreachCell(userId) {
    const l = state.latest[userId];
    const badge = l
      ? `<span class="badge ${RETENTION_OUTCOME_BADGE[l.outcome] || "badge-neutral"}" title="${escapeHtml(formatDateTime(l.created_at))}">${escapeHtml(RETENTION_OUTCOMES[l.outcome] || l.outcome)}</span>`
      : `<span class="cell-sub">Not contacted</span>`;
    return `<div style="display:flex;align-items:center;gap:8px;white-space:nowrap">${badge}
      <button class="btn btn-ghost btn-sm" type="button" data-log="${userId}">Log contact</button></div>`;
  }

  async function load() {
    try {
      const data = await apiRequest(CHURN_API.SCORES);
      state.run = data.run;
      state.summary = data.summary;
      state.skipped = data.skipped || [];
      state.rows = data.run ? mapRows(data) : [];
      await loadLatest();
      render(data);
    } catch (err) {
      $("riskStatus").textContent = "";
      $("riskBody").innerHTML = `<tr><td colspan="7"><div class="state-block"><div class="state-title">Couldn't load at-risk patients</div><p>${escapeHtml(err.message)}</p></div></td></tr>`;
    }
  }

  function renderSkipped() {
    const el = $("skippedNote");
    if (!state.skipped.length) { el.innerHTML = ""; return; }
    const MAX = 8;
    const items = state.skipped.slice(0, MAX).map((k) =>
      `<li><strong>${escapeHtml(k.name)}</strong>: ${escapeHtml(plainReason(k.reason))}.</li>`).join("");
    const more = state.skipped.length > MAX ? `<li>…and ${state.skipped.length - MAX} more.</li>` : "";
    el.innerHTML = `<div style="font-weight:700;margin-bottom:6px;color:var(--ink)">Needs manual review (${state.skipped.length} not scored)</div>
      <ul style="margin:0;padding-left:18px;line-height:1.6">${items}${more}</ul>`;
  }

  function emptyMessage(data) {
    if (data && data.setup_needed) {
      return { title: "Churn scoring isn't set up yet", text: "Run php-backend/sql/churn_scores.sql in your database once, then click Re-score." };
    }
    return { title: "No scores yet", text: "Click Re-score to score every active patient. The results are saved so every page can use them." };
  }

  function render(data) {
    const sum = state.summary || { high: 0, medium: 0, low: 0, at_risk_spend: 0 };
    $("riskSummary").innerHTML = `
      <div class="card"><div class="lbl">High risk</div><div class="num" style="color:var(--coral-text)">${sum.high}</div></div>
      <div class="card"><div class="lbl">Medium risk</div><div class="num" style="color:var(--gold-text)">${sum.medium}</div></div>
      <div class="card"><div class="lbl">Low risk</div><div class="num" style="color:var(--success-text)">${sum.low}</div></div>
            ${CAN_SEE_SPEND ? `<div class="card"><div class="lbl">Lifetime spend of High + Medium</div><div class="num" style="font-size:20px">${formatCurrency(sum.at_risk_spend)}</div></div>` : ""}`;

    if (!state.run) {
      const m = emptyMessage(data);
      $("riskBody").innerHTML = `<tr><td colspan="7"><div class="state-block"><div class="state-title">${m.title}</div><p>${m.text}</p></div></td></tr>`;
      $("riskStatus").textContent = "";
      renderSkipped();
      return;
    }

    const rows = state.rows.filter((r) => state.filter === "all" || r.ins.tier === state.filter);
    $("riskBody").innerHTML = rows.length
      ? rows.map((r) => `
        <tr class="clickable" data-user-id="${r.user.user_id}">
          <td><div class="name-cell"><div class="avatar-chip">${initials(r.user.name)}</div>
            <div><div class="cell-name">${escapeHtml(r.user.name)}</div>
            <div class="cell-sub">${escapeHtml(r.user.nic)} · ${escapeHtml(r.f.Preferred_Service_Category)}${r.ins.limited ? " · first visit only" : ""}</div></div></div></td>
          <td><span class="risk-pill risk-${r.ins.tier}"><span class="risk-dot"></span>${escapeHtml(r.p.risk_tier)}</span></td>
          <td class="cell-strong">${Math.round((r.p.churn_probability || 0) * 100)}%</td>
          <td>${r.ins.daysLeft} days</td>
          <td>${r.user.last_visit ? formatDate(r.user.last_visit) : "—"}</td>
          <td style="max-width:300px">${escapeHtml(r.ins.action)}</td>
          <td>${outreachCell(r.user.user_id)}</td>
        </tr>`).join("")
      : `<tr><td colspan="7"><div class="state-block"><div class="state-title">No patients in this tier</div></div></td></tr>`;

    const age = elapsedDays(state.run);
    const when = formatDateTime(state.run.scored_at);
    $("riskStatus").textContent = `${state.run.scored_count} scored · ${when}` + (age >= 1 ? ` · ${age} day${age === 1 ? "" : "s"} old, consider Re-score` : "");
    renderSkipped();
  }

  $("riskBody").addEventListener("click", (e) => {
    const logBtn = e.target.closest("button[data-log]");
    if (logBtn) {
      const r = state.rows.find((x) => String(x.user.user_id) === logBtn.dataset.log);
      if (r) {
        openRetentionModal({
          userId: Number(r.user.user_id),
          name: r.user.name,
          onSaved: async () => { await loadLatest(); render(); },
        });
      }
      return;
    }
    const tr = e.target.closest("tr[data-user-id]");
    if (tr) window.location.href = "patients.html#patient=" + tr.dataset.userId;
  });

  $("tierFilters").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tier]");
    if (!b) return;
    state.filter = b.dataset.tier;
    document.querySelectorAll("#tierFilters button[data-tier]").forEach((x) => x.classList.toggle("on", x === b));
    render();
  });

  async function rescore() {
    if (state.busy) return;
    state.busy = true;
    const btn = $("refreshBtn");
    btn.disabled = true;
    $("riskStatus").textContent = "Scoring all active patients… this can take up to a minute";
    try {
      const r = await apiRequest(CHURN_API.SCORE_ALL, { method: "POST", body: {} });
      await load();
      showToast(`Scored ${r.scored} patient${r.scored === 1 ? "" : "s"}` + (r.skipped ? `, ${r.skipped} need manual review` : ""));
    } catch (err) {
      showToast(err.message, "error");
      await load(); // fall back to the last good run
    } finally {
      state.busy = false;
      btn.disabled = false;
    }
  }
  $("refreshBtn").addEventListener("click", rescore);
  load();
})();