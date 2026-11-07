(function () {
  renderShell({ active: "retention", eyebrow: "Outreach results", title: "Retention Report" });

  const $ = (id) => document.getElementById(id);
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) + "%" : "—");
  const cap = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);

  // The chosen baseline run is remembered in this browser, so Re-score doesn't reset the comparison
  const BASELINE_KEY = "christell_retention_baseline";
  const getBaseline = () => { try { return localStorage.getItem(BASELINE_KEY) || ""; } catch (e) { return ""; } };
  const setBaseline = (v) => {
    try { if (v) localStorage.setItem(BASELINE_KEY, v); else localStorage.removeItem(BASELINE_KEY); } catch (e) { /* ignore */ }
  };

  // rows = array of arrays of ALREADY-ESCAPED cell strings
  function table(headers, rows, emptyText) {
    if (!rows.length) return `<div class="cell-sub">${emptyText}</div>`;
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
  }

  function summaryCard(label, value) {
    return `<div class="card"><div class="lbl">${label}</div><div class="num">${value}</div></div>`;
  }

  function render(d) {
    if (d.setup_needed) {
      $("repSummary").innerHTML = "";
      const msg = `<div class="state-block"><div class="state-title">Retention log isn't set up yet</div><p>Run the retention SQL once, then log some contacts on the At-Risk page.</p></div>`;
      ["repCohort", "repFirst", "repChannel", "repOutcome"].forEach((id) => { $(id).innerHTML = msg; });
      $("exportBtn").style.display = "none";
      return;
    }

    $("repSummary").innerHTML =
      summaryCard("Contacts logged", d.totals.actions) +
      summaryCard("Patients contacted", d.totals.patients_contacted) +
      summaryCard("Patients scored (baseline)", d.run ? d.run.scored_count : "—") +
      summaryCard("Baseline run", d.run ? `<span style="font-size:16px">${escapeHtml(formatDateTime(d.run.scored_at))}</span>` : "—");

    renderBaseline(d);

    $("repCohort").innerHTML = table(
      ["Tier", "Patients", "Contacted", "Returned (contacted)", "Not contacted", "Returned (not contacted)"],
      d.cohort.map((r) => [
        `<strong>${escapeHtml(cap(r.tier))}</strong>`,
        r.patients,
        r.contacted,
        `${r.contacted_returned} <span class="cell-sub">(${pct(r.contacted_returned, r.contacted)})</span>`,
        r.not_contacted,
        `${r.not_contacted_returned} <span class="cell-sub">(${pct(r.not_contacted_returned, r.not_contacted)})</span>`,
      ]),
      "No scoring run yet. Click Re-score on the At-Risk page first."
    );

    $("repFirst").innerHTML = table(
      ["Tier at first contact", "Patients", "Rebooked (logged)", "Visited after contact"],
      d.by_first_contact_tier.map((r) => [
        `<strong>${escapeHtml(cap(r.tier))}</strong>`,
        r.patients,
        `${r.rebooked} <span class="cell-sub">(${pct(r.rebooked, r.patients)})</span>`,
        `${r.returned} <span class="cell-sub">(${pct(r.returned, r.patients)})</span>`,
      ]),
      "No contacts logged yet."
    );

    $("repChannel").innerHTML = table(
      ["Channel", "Contacts", "Reached", "Rebooked"],
      d.by_channel.map((r) => [
        escapeHtml(RETENTION_CHANNELS[r.channel] || r.channel),
        r.contacts,
        `${r.reached} <span class="cell-sub">(${pct(r.reached, r.contacts)})</span>`,
        `${r.rebooked} <span class="cell-sub">(${pct(r.rebooked, r.contacts)})</span>`,
      ]),
      "No contacts logged yet."
    );

    $("repOutcome").innerHTML = table(
      ["Outcome", "Count"],
      d.by_outcome.map((r) => [escapeHtml(RETENTION_OUTCOMES[r.outcome] || r.outcome), r.count]),
      "No contacts logged yet."
    );
  }

  function renderBaseline(d) {
    const select = $("baselineSelect");
    const fixed = getBaseline();
    const runs = d.runs || [];
    select.innerHTML =
      `<option value="">Latest run (moves when you Re-score)</option>` +
      runs
        .map((r) => {
          const label = `${formatDateTime(r.scored_at)} · ${r.scored_count} scored${r.is_latest ? " · latest" : ""}`;
          return `<option value="${escapeHtml(r.run_id)}">${escapeHtml(label)}</option>`;
        })
        .join("");
    select.value = fixed && d.run && d.run.run_id === fixed ? fixed : "";
    select.disabled = !runs.length;

    if (!d.run) {
      $("repRunNote").textContent = "No scoring run yet";
      $("windowNote").textContent = "";
      return;
    }
    $("repRunNote").textContent = fixed ? "Fixed baseline run" : "Since the latest scoring run";
    const r = d.run;
    $("windowNote").innerHTML = r.window_complete
      ? `<strong>${r.window_days}-day outcome window complete</strong> (${r.days_elapsed} days since this run).`
      : `<strong>Day ${r.days_elapsed} of ${r.window_days}</strong> of the outcome window. Results are provisional until day ${r.window_days}.` +
        (fixed ? "" : " Pick a fixed run to keep this comparison when you Re-score.");
  }

  async function load() {
    const fixed = getBaseline();
    try {
      const d = await apiRequest(fixed ? `${RETENTION_API.REPORT}?run_id=${encodeURIComponent(fixed)}` : RETENTION_API.REPORT);
      if (fixed && d.run && !d.run.requested_found) {
        setBaseline("");
        showToast("The saved baseline run no longer exists, so the latest run is shown.", "error");
      }
      render(d);
    } catch (err) {
      $("repSummary").innerHTML = "";
      const msg = `<div class="state-block"><div class="state-title">Couldn't load the report</div><p>${escapeHtml(err.message)}</p></div>`;
      ["repCohort", "repFirst", "repChannel", "repOutcome"].forEach((id) => { $(id).innerHTML = msg; });
    }
  }

  // CSV is built in the browser from the de-identified rows (the download link can't send the login token)
  async function exportCsv() {
    const btn = $("exportBtn");
    btn.disabled = true;
    try {
      const d = await apiRequest(`${RETENTION_API.REPORT}?export=1`);
      const cols = ["action_id", "user_id", "channel", "outcome", "risk_tier_at_time", "churn_probability_at_time", "created_at", "returned_after_contact"];
      const cell = (v) => {
        const t = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const csv = [cols.join(",")].concat(d.rows.map((r) => cols.map((c) => cell(r[c])).join(","))).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `retention-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  }

  $("baselineSelect").addEventListener("change", (e) => {
    setBaseline(e.target.value);
    load();
  });

  $("exportBtn").addEventListener("click", exportCsv);
  load();
})();
