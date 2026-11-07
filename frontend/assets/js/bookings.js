(function () {
  renderShell({ active: "bookings", eyebrow: "Appointments across every doctor", title: "Bookings" });

  // New endpoint, built from API_BASE_URL so config.js needs no change
  const UPDATE_STATUS_URL = `${API_BASE_URL}/update_booking_status.php`;

  const state = { search: "", status: "", dateFrom: "", dateTo: "", needsUpdate: false, page: 1, limit: 20 };
  let currentRows = [];

  const searchInput = document.getElementById("searchInput");
  const statusSelect = document.getElementById("statusSelect");
  const dateFrom = document.getElementById("dateFrom");
  const dateTo = document.getElementById("dateTo");
  const clearBtn = document.getElementById("clearFiltersBtn");
  const body = document.getElementById("bookingsBody");
  const paginationInfo = document.getElementById("paginationInfo");
  const prevBtn = document.getElementById("prevPageBtn");
  const nextBtn = document.getElementById("nextPageBtn");
  const notice = document.getElementById("updateNotice");
  const noticeText = document.getElementById("updateNoticeText");
  const needsUpdateBtn = document.getElementById("needsUpdateBtn");

  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      load();
    }, 350);
  });
  statusSelect.addEventListener("change", () => {
    state.status = statusSelect.value;
    state.page = 1;
    load();
  });
  dateFrom.addEventListener("change", () => {
    state.dateFrom = dateFrom.value;
    state.page = 1;
    load();
  });
  dateTo.addEventListener("change", () => {
    state.dateTo = dateTo.value;
    state.page = 1;
    load();
  });
  clearBtn.addEventListener("click", () => {
    searchInput.value = "";
    statusSelect.value = "";
    dateFrom.value = "";
    dateTo.value = "";
    state.search = state.status = state.dateFrom = state.dateTo = "";
    state.needsUpdate = false;
    state.page = 1;
    load();
  });
  needsUpdateBtn.addEventListener("click", () => {
    state.needsUpdate = !state.needsUpdate;
    state.page = 1;
    load();
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

  // One listener for every outcome button in the table
  body.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-outcome]");
    if (!btn) return;
    const booking = currentRows.find((r) => String(r.booking_id) === btn.dataset.id);
    if (booking) recordOutcome(booking, btn.dataset.outcome, btn);
  });

  async function recordOutcome(b, outcome, btn) {
    const when = formatDateTime(b.appointment_date);
    const extra =
      outcome === "Attended"
        ? Number(b.treatment_count) > 0
          ? `\n\nIts ${b.treatment_count} treatment(s) will be marked Completed.`
          : "\n\nNo treatments are recorded on this booking, so this visit will count with zero spend."
        : "";
    const ok = window.confirm(`Mark ${b.patient_name}'s appointment on ${when} as ${outcome}?${extra}\n\nThis can't be undone from the console.`);
    if (!ok) return;

    const group = btn.closest(".status-actions");
    group.querySelectorAll("button").forEach((x) => (x.disabled = true));
    try {
      const res = await apiRequest(UPDATE_STATUS_URL, {
        method: "POST",
        body: { booking_id: Number(b.booking_id), status: outcome },
      });
      const t = res.treatments_updated;
      showToast(`${res.patient_name}: marked ${res.status}${t ? ` (${t} treatment${t === 1 ? "" : "s"} updated)` : ""}`);
      load();
    } catch (err) {
      showToast(err.message, "error");
      group.querySelectorAll("button").forEach((x) => (x.disabled = false));
    }
  }

  async function loadMeta() {
    try {
      const meta = await apiRequest(API_ENDPOINTS.META);
      statusSelect.innerHTML =
        `<option value="">All statuses</option>` +
        meta.booking_statuses.map((s) => `<option value="${escapeHtml(s.status_name)}">${escapeHtml(s.status_name)}</option>`).join("");
    } catch (e) {
      // Non-fatal — filter still works without preset options.
    }
  }

  function outcomeCell(b) {
    if (b.status_name !== "Booked") return `<span class="muted-dash">—</span>`;
    const id = escapeHtml(String(b.booking_id));
    const button = (outcome, label) =>
      `<button class="btn btn-ghost btn-sm" data-outcome="${outcome}" data-id="${id}">${label}</button>`;
    return Number(b.is_past)
      ? `<div class="status-actions">${button("Attended", "Attended")}${button("No Show", "No show")}${button("Cancelled", "Cancelled")}</div>`
      : `<div class="status-actions">${button("Cancelled", "Cancel")}</div>`;
  }

  function renderNotice(count) {
    if (!count && !state.needsUpdate) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    if (state.needsUpdate) {
      noticeText.innerHTML = count
        ? `Showing the <strong>${count}</strong> past appointment${count === 1 ? "" : "s"} still marked Booked.`
        : `All past appointments have been recorded.`;
      needsUpdateBtn.textContent = "Show all bookings";
    } else {
      noticeText.innerHTML = `<strong>${count}</strong> past appointment${count === 1 ? " is" : "s are"} still marked Booked. Record what happened so visits and risk scores stay accurate.`;
      needsUpdateBtn.textContent = "Show them";
    }
  }

  function renderRows(bookings) {
    currentRows = bookings;
    if (!bookings.length) {
      body.innerHTML = `
        <tr><td colspan="8">
          <div class="state-block">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 3V7M16 3V7M3 10H21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            <div class="state-title">No bookings match these filters</div>
            <p>Try widening your date range or clearing filters.</p>
          </div>
        </td></tr>`;
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
        <td>${formatDate(b.booking_created_date)}</td>
        <td class="cell-strong">${b.treatment_count}</td>
        <td class="cell-strong">${formatCurrency(b.booking_spend)}</td>
        <td>
          <span class="badge ${statusBadgeClass(b.status_name)}">${escapeHtml(b.status_name)}</span>
          ${Number(b.needs_update) ? `<div class="needs-update-tag">Needs update</div>` : ""}
        </td>
        <td>${outcomeCell(b)}</td>
      </tr>`
      )
      .join("");
  }

  async function load() {
    body.innerHTML = `<tr><td colspan="8"><div class="skeleton" style="height:18px;"></div></td></tr>`;
    try {
      const query = buildQuery({
        search: state.search,
        status: state.status,
        date_from: state.dateFrom,
        date_to: state.dateTo,
        needs_update: state.needsUpdate ? "1" : "",
        page: state.page,
        limit: state.limit,
      });
      const data = await apiRequest(`${API_ENDPOINTS.BOOKINGS}${query}`);
      renderRows(data.bookings);
      renderNotice(Number(data.needs_update_count) || 0);
      const { page, total, total_pages, limit } = data.pagination;
      const start = total === 0 ? 0 : (page - 1) * limit + 1;
      const end = Math.min(page * limit, total);
      paginationInfo.textContent = `Showing ${start}–${end} of ${total}`;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= total_pages;
    } catch (err) {
      showToast(err.message, "error");
      body.innerHTML = `<tr><td colspan="8"><div class="state-block"><div class="state-title">Couldn't load bookings</div><p>${escapeHtml(err.message)}</p></div></td></tr>`;
    }
  }

  loadMeta();
  load();
})();
