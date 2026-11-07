(function () {
  renderShell({ active: "doctors", eyebrow: "Performance by clinician", title: "Doctors" });
 
  const TONES = ["teal", "gold", "sage", "coral"];
 
  // Removes any leading titles (Dr, Dr., Prof, Professor), even if repeated.
  // "Dr. Dr Haran Robinson" -> "Haran Robinson"
  function cleanName(name) {
    return String(name || "")
      .replace(/^(\s*(dr|prof|professor)\.?\s+)+/i, "")
      .trim();
  }
 
  // Builds the display name with exactly one title.
  // Keeps "Prof." if the stored name contained it, otherwise uses "Dr."
  function displayName(name) {
    const raw = String(name || "").trim();
    const isProf = /^(\s*dr\.?\s+)*prof(essor)?\.?\s+/i.test(raw);
    return (isProf ? "Prof. " : "Dr. ") + cleanName(raw);
  }
 
  // Avatar initials from the cleaned name (no "Dr"/"Prof" letters)
  function getInitials(name) {
    return cleanName(name)
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
 
  function doctorCard(doc, i) {
    const tone = TONES[i % TONES.length];
    return `
      <div class="card" style="padding: 22px;">
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
          <div class="stat-icon icon-tone-${tone}" style="width:44px; height:44px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-family:var(--font-display); font-weight:700; font-size:16px; line-height:1;">
            ${escapeHtml(getInitials(doc.doctor_name))}
          </div>
          <div>
            <div style="font-weight:700; font-size:15.5px;">${escapeHtml(displayName(doc.doctor_name))}</div>
            <div class="cell-sub">${doc.category_count} service area${doc.category_count === 1 ? "" : "s"}</div>
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; border-top:1px solid var(--line); padding-top:14px;">
          <div>
            <div class="cell-sub">Treatments</div>
            <div class="cell-strong" style="font-size:16px;">${doc.treatment_count}</div>
          </div>
          <div style="text-align:right;">
            <div class="cell-sub">Revenue</div>
            <div class="cell-strong" style="font-size:16px;">${formatCurrency(doc.total_revenue)}</div>
          </div>
        </div>
      </div>`;
  }
 
  async function load() {
    const grid = document.getElementById("doctorsGrid");
    try {
      const data = await apiRequest(API_ENDPOINTS.DOCTORS);
      if (!data.doctors.length) {
        grid.innerHTML = `<div class="card state-block" style="grid-column: 1 / -1;"><div class="state-title">No doctors on file yet</div></div>`;
        return;
      }
      grid.innerHTML = data.doctors.map(doctorCard).join("");
    } catch (err) {
      showToast(err.message, "error");
      grid.innerHTML = `<div class="card state-block" style="grid-column: 1 / -1;"><div class="state-title">Couldn't load doctors</div><p>${escapeHtml(err.message)}</p></div>`;
    }
  }
 
  load();
})();