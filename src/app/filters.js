// Summary-badge status filter and the entry search box.
import { applyAllCardVisibility } from "./cards.js";
import { $, $$ } from "./dom.js";
import { state } from "./state.js";

const entrySearchWrap = $(".entry-search");
const entrySearchInput = $("#entry-search-input");
const entrySearchClear = $("#entry-search-clear");

const ATTENTION_FILTERS = new Set(["needs_review", "not_found", "duplicate"]);

// The view switch shows "To check" or "All"; a status badge narrows further.
// Badges light up for every status the current view includes.
function syncBadges() {
  const f = state.activeFilter;
  const view = f === "all" || f === "attention" ? f : null;
  $$(".view-btn").forEach(b => b.classList.toggle("active", b.dataset.filter === view));
  $$(".summary-badge").forEach(b => b.classList.toggle("active",
    b.dataset.filter === f || f === "all" || (f === "attention" && ATTENTION_FILTERS.has(b.dataset.filter))));
}

function setFilter(filter) {
  state.activeFilter = filter;
  syncBadges();
  applyAllCardVisibility();
}

function setSearch(value) {
  state.activeSearch = (value || "").trim().toLowerCase();
  entrySearchWrap.classList.toggle("has-query", !!state.activeSearch);
  applyAllCardVisibility();
}

export function resetFilters() {
  state.activeFilter = "attention";
  state.activeSearch = "";
  entrySearchInput.value = "";
  entrySearchWrap.classList.remove("has-query");
  syncBadges();
}

export function initFilters() {
  document.addEventListener("click", (e) => {
    const viewBtn = e.target.closest(".view-btn, .hidden-summary-btn");
    if (viewBtn) return setFilter(viewBtn.dataset.filter);
    const badge = e.target.closest(".summary-badge");
    if (!badge) return;
    // Clicking the badge that is already the filter goes back to "To check".
    setFilter(state.activeFilter === badge.dataset.filter ? "attention" : badge.dataset.filter);
  });

  entrySearchInput.addEventListener("input", (e) => setSearch(e.target.value));
  entrySearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      entrySearchInput.value = "";
      setSearch("");
      entrySearchInput.blur();
    }
  });
  entrySearchClear.addEventListener("click", () => {
    entrySearchInput.value = "";
    setSearch("");
    entrySearchInput.focus();
  });

  // "/" focuses search unless the user is already typing somewhere.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (entrySearchInput.offsetParent === null) return;
    e.preventDefault();
    entrySearchInput.focus();
    entrySearchInput.select();
  });
}
