// Entry cards: rendering, status/summary badges, and filter/search visibility.
import { COMPARED_FIELDS, entryMatchesQuery, stripLatex, truncateAuthors } from "../lib/index.js";
import { $, $$, esc } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

const entryList = $(".entry-list");
const entryEmpty = $("#entry-empty");

const STATUS_LABELS = {
  verified: "Verified",
  updated: "Auto-Updated",
  needs_review: "Needs Review",
  not_found: "Not Found",
};

export function statusLabel(s) {
  return STATUS_LABELS[s] || s;
}

const REMOVE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export const DIFF_TABLE_HEADER = `<tr><th>Field</th><th>Your Value</th><th>Suggested</th><th></th></tr>`;

export function removeFieldButton(idx, field, currentAction, title = "Remove field") {
  return `<button class="fa-btn-x ${currentAction === "remove" ? "active" : ""}" title="${title}"
            data-entry="${idx}" data-field="${esc(field)}" data-action="remove" data-val="">
      ${REMOVE_ICON}
    </button>`;
}

// ─── Visibility (filter + search) ────────────────────────────────────
function cardMatchesFilter(card) {
  if (state.activeFilter === "all") return true;
  if (state.activeFilter === "duplicate") return card.dataset.duplicate === "true";
  return card.dataset.status === state.activeFilter;
}

function cardMatchesSearch(card) {
  const r = state.results[card.dataset.index];
  return !r || entryMatchesQuery(r, state.activeSearch);
}

function applyCardVisibility(card) {
  card.classList.toggle("hidden", !(cardMatchesFilter(card) && cardMatchesSearch(card)));
}

function updateEntryEmptyState() {
  const cards = $$(".entry-card");
  if (!cards.length) { entryEmpty.classList.remove("visible"); return; }
  const anyVisible = [...cards].some(c => !c.classList.contains("hidden"));
  entryEmpty.classList.toggle("visible", !anyVisible);
}

export function applyAllCardVisibility() {
  $$(".entry-card").forEach(applyCardVisibility);
  updateEntryEmptyState();
}

export function clearCards() {
  entryList.innerHTML = "";
  entryEmpty.classList.remove("visible");
}

// ─── Summary + effective status ──────────────────────────────────────
export function updateSummary() {
  const c = { verified: 0, updated: 0, needs_review: 0, not_found: 0 };
  let dupes = 0;
  $$(".entry-card").forEach(card => {
    c[card.dataset.status] = (c[card.dataset.status] || 0) + 1;
    if (card.dataset.duplicate === "true") dupes++;
  });
  $(".badge-verified .summary-count").textContent = c.verified;
  $(".badge-updated .summary-count").textContent = c.updated;
  $(".badge-review .summary-count").textContent = c.needs_review;
  $(".badge-notfound .summary-count").textContent = c.not_found;
  $(".badge-duplicates .summary-count").textContent = dupes;
}

/**
 * Re-derive each card's displayed status from its visible diff rows: author
 * truncation can add a suggestion to a verified entry, or hide the only
 * difference of an updated one.
 */
export function updateCardStatuses() {
  $$(".entry-card").forEach(card => {
    const r = state.results[card.dataset.index];
    if (!r) return;
    if (!card.dataset.origStatus) card.dataset.origStatus = r.status;
    const savedStatus = card.dataset.origStatus;

    const diffRows = card.querySelectorAll(".diff-row:not(.field-row-plain)");
    const hasVisibleDiffs = diffRows.length > 0 && ![...diffRows].every(row => row.classList.contains("author-match-hidden"));
    const hasInjectedRows = card.querySelector(".diff-row[data-injected]") !== null;

    let effectiveStatus = savedStatus;
    if (hasInjectedRows && hasVisibleDiffs && savedStatus === "verified") effectiveStatus = "updated";
    else if (!hasVisibleDiffs && (savedStatus === "updated" || savedStatus === "needs_review")) effectiveStatus = "verified";

    card.dataset.status = effectiveStatus;
    card.className = card.className.replace(/status-\S+/, `status-${effectiveStatus}`);
    const tag = card.querySelector(".status-tag:not(.tag-duplicate)");
    if (tag) {
      tag.className = `status-tag tag-${effectiveStatus}`;
      tag.textContent = statusLabel(effectiveStatus);
    }

    const diffTable = card.querySelector(".diff-table:not(.fields-table)");
    if (diffTable) diffTable.style.display = !hasVisibleDiffs && !hasInjectedRows ? "none" : "";
    const actions = card.querySelector(".entry-actions");
    if (actions) actions.style.display = !hasVisibleDiffs ? "none" : "";
  });

  updateSummary();
}

// ─── Rendering ───────────────────────────────────────────────────────
function renderDiffRow(r, idx, d, hasSuggestion, maxAuthors) {
  const edits = state.fieldEdits[idx];
  const isEnrichment = !(d.original || "").trim();
  // Enrichments and "updated" entries adopt the suggestion by default.
  const defaultAction = (isEnrichment || r.status === "updated") ? "found" : "original";

  if (!edits[d.field]) edits[d.field] = { action: defaultAction, value: d.found || "" };
  const fe = edits[d.field];
  const currentAction = fe.action;

  const suggestionText = currentAction === "custom" ? (fe.value || "") : (d.found || "");
  const displaySuggestion = (d.field === "author" && maxAuthors > 0 && currentAction !== "custom")
    ? truncateAuthors(suggestionText, maxAuthors) : suggestionText;
  const authorMatchHidden = d.field === "author" && maxAuthors > 0 && displaySuggestion.trim() === (d.original || "").trim();

  return `<tr class="diff-row${authorMatchHidden ? " author-match-hidden" : ""}" data-entry="${idx}" data-field="${esc(d.field)}" data-action="${currentAction}"
      data-enrichment="${isEnrichment ? "1" : ""}"
      data-found-val="${encodeURIComponent(d.found || "")}"
      data-original-val="${encodeURIComponent(d.original || "")}">
      <td class="field-name"><span class="field-name-pill">${esc(d.field)}</span></td>
      <td class="val-col val-col-original">
        ${!isEnrichment ? `<button class="choice-pill pill-original ${currentAction === "original" ? "active" : ""}"
                data-entry="${idx}" data-field="${esc(d.field)}" data-action="original" data-val="${esc(d.original || "")}"
                title="Keep your value">${esc(d.original)}</button>` : '<span class="empty-val">\u2014</span>'}
      </td>
      <td class="val-col val-col-suggested">
        ${hasSuggestion ? `<span class="choice-pill pill-suggested ${currentAction === "found" || currentAction === "custom" ? "active" : ""} ${currentAction === "remove" ? "removed" : ""}"
                contenteditable="${currentAction === "remove" ? "false" : "true"}"
                spellcheck="false"
                data-entry="${idx}" data-field="${esc(d.field)}" data-action="found" data-val="${esc(d.found || "")}"
                title="Use suggested value (click to select, edit to customize)">${esc(displaySuggestion)}</span>` : ""}
      </td>
      <td class="field-actions-mini">
        ${removeFieldButton(idx, d.field, currentAction, isEnrichment ? "Don\u2019t add" : "Remove field")}
      </td>
    </tr>`;
}

function renderPlainFieldRow(idx, f, entry) {
  const edits = state.fieldEdits[idx];
  if (!edits[f]) edits[f] = { action: "original", value: entry[f] || "" };
  const fe = edits[f];
  const removed = fe.action === "remove";

  return `<tr class="diff-row field-row-plain" data-entry="${idx}" data-field="${esc(f)}" data-action="${fe.action}">
      <td class="field-name"><span class="field-name-pill">${esc(f)}</span></td>
      <td class="val-col" colspan="2">
        <span class="choice-pill pill-value ${removed ? "removed" : "active"}"
              contenteditable="${removed ? "false" : "true"}" spellcheck="false"
              data-entry="${idx}" data-field="${esc(f)}">${esc(removed ? "" : fe.value)}</span>
      </td>
      <td class="field-actions-mini">
        ${removeFieldButton(idx, f, fe.action)}
      </td>
    </tr>`;
}

function renderHints(r) {
  let html = "";
  if (r.duplicate_of)
    html += `<div class="duplicate-row">Duplicate of <strong>${esc(r.duplicate_of)}</strong></div>`;

  if (r.status === "needs_review" && r.found_title) {
    html += `<div class="review-hint">The closest database record may not be the paper you meant
      (<strong>${esc(String(r.title_score))}%</strong> title similarity to
      <strong class="review-hint-match">${esc(r.found_title)}</strong>).
      Review the suggestions below and use the checkmark on each row to adopt a value, or keep your original text.</div>`;
  }

  if (r.status === "not_found") {
    html += `<div class="not-found-hint">${(r.title || "").trim()
      ? "No matching publication was found in Semantic Scholar, CrossRef, or OpenAlex for this title. Try fixing typos or adding missing words, then re-run verification, or check the reference manually."
      : "This entry has no title, so it cannot be looked up automatically. Add a title in your .bib file or verify the entry by hand."}</div>`;
  }
  return html;
}

function renderSearchLinks(title) {
  if (!(title || "").trim()) return "";
  const q = encodeURIComponent(stripLatex(title));
  return `<div class="search-links">
    <a class="search-link" href="https://scholar.google.com/scholar?q=${q}" target="_blank" rel="noopener" title="Google Scholar">
      <img src="https://scholar.google.com/favicon.ico" width="14" height="14" alt="Scholar">
    </a>
    <a class="search-link" href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener" title="Google">
      <img src="https://www.google.com/favicon.ico" width="14" height="14" alt="Google">
    </a>
    <a class="search-link" href="https://www.semanticscholar.org/search?q=${q}" target="_blank" rel="noopener" title="Semantic Scholar">
      <img src="https://www.semanticscholar.org/favicon.ico" width="14" height="14" alt="S2">
    </a>
    <a class="search-link search-link-crossref" href="https://search.crossref.org/?q=${q}&from_ui=yes" target="_blank" rel="noopener" title="CrossRef">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="search-link-svg">
        <rect width="24" height="24" rx="4" fill="#f89838"/>
        <path fill="#fff" fill-rule="evenodd" d="M7 8h10v2H7V8zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/>
      </svg>
    </a>
    <a class="search-link" href="https://dblp.org/search?q=${q}" target="_blank" rel="noopener" title="DBLP">
      <img src="https://dblp.org/img/dblp.icon.192x192.png" width="14" height="14" alt="DBLP">
    </a>
  </div>`;
}

export function renderEntryCard(r) {
  const idx = r.index;
  const entry = state.parsedEntries[idx];
  if (!state.fieldEdits[idx]) state.fieldEdits[idx] = {};

  const card = document.createElement("div");
  card.className = `entry-card status-${r.status}`;
  card.dataset.status = r.status;
  card.dataset.index = idx;
  if (r.duplicate_of) card.dataset.duplicate = "true";

  const hasDiffs = r.field_diffs?.length > 0;
  // Verified entries can still carry enrichment-only diffs worth adopting.
  const hasSuggestion = r.status === "updated" || r.status === "needs_review" || (r.status === "verified" && hasDiffs);

  let diffHTML = "";
  if (hasDiffs) {
    const maxAuthors = getSettings().maxAuthors;
    const rows = r.field_diffs.map(d => renderDiffRow(r, idx, d, hasSuggestion, maxAuthors)).join("");
    diffHTML = `<table class="diff-table">
      ${DIFF_TABLE_HEADER}
      ${rows}
    </table>`;
  }

  const diffFields = new Set((r.field_diffs || []).map(d => d.field));
  const extraFields = ["title", ...COMPARED_FIELDS].filter(f => !diffFields.has(f) && (entry[f] || "").trim());
  if (extraFields.length) {
    const extraRows = extraFields.map(f => renderPlainFieldRow(idx, f, entry)).join("");
    diffHTML += `<div class="fields-toggle-wrap collapsed">
      <button class="fields-toggle-btn" type="button">
        <svg class="fields-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        ${hasDiffs ? "Other fields" : "Fields"} (${extraFields.length})
      </button>
      <table class="diff-table fields-table">
        <tr><th>Field</th><th colspan="2">Value</th><th></th></tr>
        ${extraRows}
      </table>
    </div>`;
  }

  let actionsHTML = "";
  if (hasSuggestion && hasDiffs) {
    const edits = state.fieldEdits[idx];
    const allFound = r.field_diffs.every(d => edits[d.field]?.action === "found");
    const allOriginal = r.field_diffs.every(d => edits[d.field]?.action === "original");
    actionsHTML = `<div class="entry-actions">
      <button class="seg-btn btn-accept-all ${allFound ? "active-accept" : ""}" data-entry="${idx}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Accept all
      </button>
      <button class="seg-btn btn-revert-all ${allOriginal ? "active-revert" : ""}" data-entry="${idx}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 105.64-11.36L1 10"/></svg>
        Keep original
      </button>
    </div>`;
  }

  const jumpBtn = `<button class="btn-jump-preview" type="button" data-entry-id="${esc(r.entry_id)}" title="Scroll to this entry in the live preview">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
  </button>`;

  card.innerHTML = `<div class="entry-header">
    <div class="entry-header-text">
      <div class="entry-title">${esc(r.title || "(no title)")}</div>
      <div class="entry-meta">${esc(r.entry_id)} &middot; ${esc(r.entry_type)}</div>
    </div>
    <div class="entry-header-aside">
      ${jumpBtn}
      <div class="entry-tags">
        ${r.duplicate_of ? '<span class="status-tag tag-duplicate">Duplicate</span>' : ""}
        <span class="status-tag tag-${r.status}">${statusLabel(r.status)}</span>
      </div>
    </div>
  </div>${renderHints(r)}${diffHTML}${actionsHTML}${renderSearchLinks(r.title)}`;

  applyCardVisibility(card);
  // The retry pass re-renders a card in place so it keeps its position.
  const existing = entryList.querySelector(`.entry-card[data-index="${idx}"]`);
  if (existing) entryList.replaceChild(card, existing);
  else entryList.appendChild(card);
  updateEntryEmptyState();
}
