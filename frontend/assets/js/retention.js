/**
 * Retention (outreach) log: a shared modal used by the At-Risk page and the patient record.
 * Usage: openRetentionModal({ userId, name, onSaved })
 */
const RETENTION_API = Object.freeze({
  LOG: `${API_BASE_URL}/log_retention_action.php`,
  LIST: `${API_BASE_URL}/get_retention_actions.php`,
  REPORT: `${API_BASE_URL}/get_retention_report.php`,
});
const RETENTION_CHANNELS = { call: "Phone call", sms: "SMS", whatsapp: "WhatsApp", email: "Email", in_person: "In person" };
const RETENTION_OUTCOMES = { pending: "Pending", no_answer: "No answer", contacted: "Spoke to patient", rebooked: "Rebooked", declined: "Declined" };
const RETENTION_OUTCOME_BADGE = { pending: "badge-neutral", no_answer: "badge-pending", contacted: "badge-neutral", rebooked: "badge-completed", declined: "badge-cancelled" };

function closeRetentionModal() {
  const scrim = document.getElementById("retentionScrim");
  if (scrim) scrim.classList.remove("open");
}

function openRetentionModal({ userId, name, onSaved }) {
  let scrim = document.getElementById("retentionScrim");
  if (!scrim) {
    scrim = document.createElement("div");
    scrim.id = "retentionScrim";
    scrim.className = "churn-modal-scrim";
    scrim.innerHTML = '<div class="churn-modal" id="retentionModal"></div>';
    document.body.appendChild(scrim);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) closeRetentionModal(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeRetentionModal(); });
  }
  const modal = document.getElementById("retentionModal");
  const options = (map) => Object.entries(map).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");

  modal.innerHTML = `
    <div class="churn-modal-head">
      <div><span class="eyebrow">Outreach log</span><h2>${escapeHtml(name)}</h2></div>
      <button class="churn-modal-close" id="retCloseBtn" type="button" aria-label="Close">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="churn-modal-body">
      <div class="retention-form">
        <div class="field"><label for="retChannel">How was the patient contacted?</label><select id="retChannel">${options(RETENTION_CHANNELS)}</select></div>
        <div class="field"><label for="retOutcome">Outcome</label><select id="retOutcome">${options(RETENTION_OUTCOMES)}</select></div>
        <div class="field full"><label for="retNotes">Notes (optional)</label><textarea id="retNotes" maxlength="500" rows="3" placeholder="e.g. Offered 10% off the next session"></textarea></div>
        <div class="full"><button type="button" class="btn btn-primary" id="retSaveBtn" style="width:100%;">Save contact</button></div>
      </div>
      <div class="retention-history-title">History</div>
      <div id="retHistory"><div class="skeleton" style="height:16px;"></div></div>
    </div>`;
  scrim.classList.add("open");
  document.getElementById("retCloseBtn").addEventListener("click", closeRetentionModal);

  async function loadHistory() {
    const box = document.getElementById("retHistory");
    try {
      const d = await apiRequest(`${RETENTION_API.LIST}?user_id=${encodeURIComponent(userId)}`);
      box.innerHTML = d.actions.length
        ? d.actions.map((a) => `
          <div class="retention-item">
            <div class="retention-item-top">
              <span>${escapeHtml(RETENTION_CHANNELS[a.channel] || a.channel)}</span>
              <span class="badge ${RETENTION_OUTCOME_BADGE[a.outcome] || "badge-neutral"}">${escapeHtml(RETENTION_OUTCOMES[a.outcome] || a.outcome)}</span>
            </div>
            ${a.notes ? `<div class="retention-item-notes">${escapeHtml(a.notes)}</div>` : ""}
            <div class="cell-sub">${formatDateTime(a.created_at)} · ${escapeHtml(a.staff_name || "Staff")}${a.risk_tier_at_time ? ` · risk then: ${escapeHtml(a.risk_tier_at_time)} ${Math.round(a.churn_probability_at_time * 100)}%` : ""}</div>
          </div>`).join("")
        : `<div class="cell-sub">No contact logged yet.</div>`;
    } catch (err) {
      box.innerHTML = `<div class="cell-sub">${escapeHtml(err.message)}</div>`;
    }
  }

  document.getElementById("retSaveBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      await apiRequest(RETENTION_API.LOG, {
        method: "POST",
        body: {
          user_id: userId,
          channel: document.getElementById("retChannel").value,
          outcome: document.getElementById("retOutcome").value,
          notes: document.getElementById("retNotes").value,
        },
      });
      showToast("Contact logged");
      document.getElementById("retNotes").value = "";
      await loadHistory();
      if (onSaved) onSaved();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });

  loadHistory();
}
