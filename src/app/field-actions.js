// Per-field choices on entry cards: keep original, adopt suggestion, edit
// inline, remove a field, and the "Accept all" / "Keep original" bulk actions.
import { updatePreview } from "./preview.js";
import { state } from "./state.js";

function editsFor(idx) {
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};
  return state.fieldEdits[idx];
}

function flashRow(row) {
  row.classList.remove("flash");
  void row.offsetWidth;
  row.classList.add("flash");
}

function syncRowState(row, action) {
  row.dataset.action = action;
  flashRow(row);
}

function syncBulkBtns(card) {
  const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
  if (!diffRows.length) return;
  const allFound = [...diffRows].every(r => r.dataset.action === "found");
  const allOriginal = [...diffRows].every(r => r.dataset.action === "original");
  card.querySelector(".btn-accept-all")?.classList.toggle("active-accept", allFound);
  card.querySelector(".btn-revert-all")?.classList.toggle("active-revert", allOriginal);
}

function afterRowChange(row, action) {
  syncRowState(row, action);
  syncBulkBtns(row.closest(".entry-card"));
  updatePreview();
}

function setSuggestedPill(pill, { active, editable, text }) {
  if (!pill) return;
  pill.classList.toggle("active", active);
  pill.classList.remove("removed");
  pill.contentEditable = editable ? "true" : "false";
  if (text !== undefined) pill.textContent = text;
}

function selectOriginal(origPill) {
  const idx = parseInt(origPill.dataset.entry);
  const row = origPill.closest(".diff-row");
  editsFor(idx)[origPill.dataset.field] = { action: "original", value: origPill.dataset.val };

  row.querySelectorAll(".pill-original").forEach(p => p.classList.add("active"));
  row.querySelectorAll(".pill-suggested").forEach(p => p.classList.remove("active"));
  row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));
  const sugPill = row.querySelector(".pill-suggested");
  if (sugPill) {
    sugPill.contentEditable = "false";
    sugPill.classList.remove("removed");
  }
  afterRowChange(row, "original");
}

function selectSuggested(sugPill) {
  const idx = parseInt(sugPill.dataset.entry);
  const row = sugPill.closest(".diff-row");
  editsFor(idx)[sugPill.dataset.field] = { action: "found", value: sugPill.dataset.val };

  row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
  setSuggestedPill(sugPill, { active: true, editable: true });
  row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));
  afterRowChange(row, "found");
}

function removeField(xBtn, row, idx, field) {
  const edits = editsFor(idx);
  // Remember the value so undo can restore it.
  const savedValue = edits[field]?.value || "";
  edits[field] = { action: "remove", value: "", _savedValue: savedValue };

  row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
  for (const pill of row.querySelectorAll(".pill-suggested, .pill-value")) {
    pill.classList.remove("active");
    pill.classList.add("removed");
    pill.contentEditable = "false";
  }
  xBtn.classList.add("active");
  afterRowChange(row, "remove");
}

function undoRemoveField(xBtn, row, idx, field) {
  const edits = editsFor(idx);
  const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
  const origVal = decodeURIComponent(row.getAttribute("data-original-val") || "");
  const isEnrichment = row.dataset.enrichment === "1";
  const defaultAction = state.results[idx]?.status === "updated" ? "found" : "original";
  xBtn.classList.remove("active");

  const valPill = row.querySelector(".pill-value");
  if (valPill) {
    const restoreVal = origVal || edits[field]?._savedValue || "";
    edits[field] = { action: "original", value: restoreVal };
    valPill.textContent = restoreVal;
    valPill.classList.add("active");
    valPill.classList.remove("removed");
    valPill.contentEditable = "true";
    afterRowChange(row, "original");
  } else if (defaultAction === "found" || isEnrichment) {
    edits[field] = { action: "found", value: foundVal };
    setSuggestedPill(row.querySelector(".pill-suggested"), { active: true, editable: true, text: foundVal });
    row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
    afterRowChange(row, "found");
  } else {
    edits[field] = { action: "original", value: origVal };
    row.querySelectorAll(".pill-original").forEach(p => p.classList.add("active"));
    setSuggestedPill(row.querySelector(".pill-suggested"), { active: false, editable: false });
    afterRowChange(row, "original");
  }
}

function toggleRemove(xBtn) {
  const idx = parseInt(xBtn.dataset.entry);
  const field = xBtn.dataset.field;
  const row = xBtn.closest(".diff-row");
  if (row.dataset.action === "remove") undoRemoveField(xBtn, row, idx, field);
  else removeField(xBtn, row, idx, field);
}

function applyBulk(btn) {
  const idx = parseInt(btn.dataset.entry);
  const isAccept = btn.classList.contains("btn-accept-all");
  const card = btn.closest(".entry-card");
  const edits = editsFor(idx);

  card.querySelectorAll(".diff-row:not(.field-row-plain)").forEach(row => {
    const field = row.dataset.field;
    const foundVal = decodeURIComponent(row.getAttribute("data-found-val") || "");
    const origPill = row.querySelector(".pill-original");
    const sugPill = row.querySelector(".pill-suggested");
    if (!origPill && !sugPill) return;

    if (isAccept) {
      if (sugPill) {
        edits[field] = { action: "found", value: sugPill.dataset.val };
        origPill?.classList.remove("active");
        setSuggestedPill(sugPill, { active: true, editable: true, text: foundVal });
      }
    } else if (origPill) {
      edits[field] = { action: "original", value: origPill.dataset.val };
      origPill.classList.add("active");
      setSuggestedPill(sugPill, { active: false, editable: false });
    } else if (row.dataset.enrichment === "1") {
      // Enrichment rows have no original value; "keep original" means don't adopt it.
      edits[field] = { action: "original", value: foundVal };
      setSuggestedPill(sugPill, { active: false, editable: false, text: foundVal });
    }

    row.querySelectorAll(".fa-btn-x").forEach(b => b.classList.remove("active"));
    syncRowState(row, isAccept ? "found" : "original");
  });
  syncBulkBtns(card);
  updatePreview();
}

function onInlineEdit(pill) {
  const idx = parseInt(pill.dataset.entry);
  editsFor(idx)[pill.dataset.field] = { action: "custom", value: pill.textContent.trim() };

  const row = pill.closest(".diff-row");
  row.querySelectorAll(".pill-original").forEach(p => p.classList.remove("active"));
  if (pill.classList.contains("pill-suggested")) pill.classList.add("active");
  afterRowChange(row, "custom");
}

export function initFieldActions() {
  document.addEventListener("click", (e) => {
    const toggleBtn = e.target.closest(".fields-toggle-btn");
    if (toggleBtn) {
      toggleBtn.closest(".fields-toggle-wrap").classList.toggle("collapsed");
      return;
    }

    const origPill = e.target.closest(".pill-original");
    if (origPill) return selectOriginal(origPill);

    // Clicking an already-active suggestion is editing it, not re-selecting.
    const sugPill = e.target.closest(".pill-suggested");
    if (sugPill && !sugPill.classList.contains("active")) return selectSuggested(sugPill);

    const xBtn = e.target.closest(".fa-btn-x");
    if (xBtn) return toggleRemove(xBtn);

    const bulkBtn = e.target.closest(".btn-accept-all, .btn-revert-all");
    if (bulkBtn) applyBulk(bulkBtn);
  });

  document.addEventListener("input", (e) => {
    const pill = e.target.closest(".pill-suggested[contenteditable], .pill-value[contenteditable]");
    if (pill) onInlineEdit(pill);
  });
}
