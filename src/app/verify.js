// Verification run: parse the .bib, look up each entry, render results as they arrive.
import {
  applyPublishedPreference, buildResult, entryIdentifiers, findDuplicateTitles, lintEntries,
  normalizeDoi, parseBib, setVenueIndex, stripLatex,
} from "../lib/index.js";
import { fetchEditorialNotices, lookupPaper, resetRateLimits, sleep, TransientLookupError } from "./api.js";
import { updateAuthorPills } from "./authors.js";
import { clearCards, renderEntryCard } from "./cards.js";
import { $, $$ } from "./dom.js";
import { resetFilters } from "./filters.js";
import { beginVerificationRun, openPostVerifyTour } from "./onboarding.js";
import { resetPreview, updatePreview } from "./preview.js";
import { hideResumeBanner } from "./session.js";
import { resetRunState, state } from "./state.js";
import { applySettings, getSettings } from "./settings.js";

const resultsSection = $(".results-section");
const floatingBar = $("#floating-bar");
const barProgress = $("#bar-progress");
const barProgressFill = $(".bar-progress-fill");
const barProgressText = $(".bar-progress-text");
const btnDownload = $("#btn-download");
const runNote = $("#run-note");

// The tour's sample includes a fabricated title with this marker; skip its
// guaranteed-miss network lookup so the tour doesn't stall.
const TOUR_FAKE_MARKER = /QZX999/i;

// Starting or restoring a run supersedes the one in flight.
let currentRun = 0;

function startProgress(statusMsg) {
  barProgress.classList.add("active");
  barProgress.classList.remove("fade-out");
  barProgressFill.style.width = "0%";
  barProgressFill.classList.remove("done");
  barProgressText.textContent = statusMsg;
  btnDownload.classList.add("hidden");
  btnDownload.classList.remove("fade-in");
  floatingBar.classList.add("visible");
}

function finishProgress(total, onDone) {
  barProgressFill.classList.add("done");
  barProgressText.textContent = `Done — ${total} entries verified`;
  setTimeout(() => {
    barProgress.classList.add("fade-out");
    setTimeout(() => {
      barProgress.classList.remove("active", "fade-out");
      btnDownload.classList.remove("hidden");
      btnDownload.classList.add("fade-in");
      onDone();
    }, 350);
  }, 800);
}

function showResult(r) {
  state.results[r.index] = r;
  renderEntryCard(r);
  updateAuthorPills();
  updatePreview();
}

function setRunNote(text) {
  runNote.textContent = text;
  runNote.hidden = !text;
}

/**
 * "Prefer peer-reviewed" changed: entries whose only issue is citing a
 * preprint move between Auto-Updated and Needs Review. Their untouched rows
 * take the new defaults; choices the user made are kept.
 */
export function reclassifyPublishedOnly(preferPublished) {
  let changed = false;
  state.results.forEach((r, i) => {
    if (!r?.published_only) return;
    const next = applyPublishedPreference(r, preferPublished);
    if (next.status === r.status) return;
    const edits = state.fieldEdits[i] || {};
    for (const field of Object.keys(edits)) if (edits[field]?._auto) delete edits[field];
    state.results[i] = next;
    renderEntryCard(next);
    changed = true;
  });
  if (changed) updateAuthorPills();
  updatePreview();
}

// dblp venue index, fetched once on the first run. Without it venue checks
// still work, only stricter (more "different venue" reviews, never fewer).
let venueIndexLoad = null;
function loadVenueIndex() {
  venueIndexLoad ??= fetch("data/venues.json")
    .then(r => (r.ok ? r.json() : null))
    .then(index => { if (index) setVenueIndex(index); })
    .catch(err => console.warn("Venue index unavailable:", err));
  return venueIndexLoad;
}

/** Look up one entry. `inconclusive` means a source failed transiently. */
async function lookupEntry(entry) {
  const title = stripLatex(entry.title || "");
  if (TOUR_FAKE_MARKER.test(title)) {
    await sleep(500);
    return { found: null, inconclusive: false };
  }
  try {
    return { found: await lookupPaper(title, entryIdentifiers(entry)), inconclusive: false };
  } catch (err) {
    if (err instanceof TransientLookupError) return { found: null, inconclusive: true };
    console.warn("Lookup failed:", err);
    return { found: null, inconclusive: false };
  }
}

/**
 * Flag matched papers that were retracted or carry an expression of concern.
 * A failed check is reported, never silently treated as "nothing retracted".
 */
async function checkEditorialNotices(run) {
  const dois = state.results.map(r => r?.found_doi).filter(Boolean);
  if (!dois.length) return;
  barProgressText.textContent = "Checking for retractions…";
  let notices;
  try {
    notices = await fetchEditorialNotices(dois);
  } catch (err) {
    console.warn("Retraction check failed:", err);
    if (run === currentRun)
      setRunNote("The retraction check couldn’t run (CrossRef was unreachable), so retracted papers are not flagged in this run.");
    return;
  }
  if (run !== currentRun) return;
  for (const r of [...state.results]) {
    const notice = r?.found_doi && notices.get(normalizeDoi(r.found_doi));
    if (notice) showResult({ ...r, notice });
  }
}

function prepareRun() {
  resetRunState();
  resetFilters();
  clearCards();
  resetRateLimits();
  setRunNote("");
  hideResumeBanner();
  $$(".info-section").forEach(s => s.style.display = "none");
  return ++currentRun;
}

export function startVerificationFromContent(content, statusMsg) {
  const resumeTour = beginVerificationRun();

  const run = prepareRun();
  resultsSection.style.display = "none";
  startProgress(statusMsg);
  resetPreview();

  // The tour's sample run is not worth keeping, and must not replace a saved one.
  state.persist = !resumeTour;
  state.parsedEntries = parseBib(content);
  if (!state.parsedEntries.length) {
    alert("No BibTeX entries found. Make sure the content contains valid @type{key, ...} entries.");
    floatingBar.classList.remove("visible");
    return;
  }

  resultsSection.style.display = "block";
  barProgressText.textContent = `Verifying 0 / ${state.parsedEntries.length} entries...`;
  runVerification(run, resumeTour);
}

/**
 * Show a session saved by an earlier visit (see session.js). A run that was
 * interrupted continues with the entries that were not looked up yet.
 */
export function restoreSession(saved) {
  beginVerificationRun();
  const run = prepareRun();
  applySettings(saved.settings);
  state.persist = true;
  state.parsedEntries = saved.parsedEntries;
  state.results = saved.results;
  state.fieldEdits = saved.fieldEdits;

  resultsSection.style.display = "block";
  resetPreview();
  for (const r of state.results) renderEntryCard(r);
  updateAuthorPills();
  updatePreview();

  if (saved.complete) {
    barProgress.classList.remove("active", "fade-out");
    btnDownload.classList.remove("hidden");
    floatingBar.classList.add("visible");
  } else {
    startProgress(`Resuming at entry ${state.results.length + 1} of ${state.parsedEntries.length}…`);
    runVerification(run, false, state.results.length);
  }
}

async function runVerification(run, resumeTour, startAt = 0) {
  const entries = state.parsedEntries;
  const total = entries.length;
  const duplicateOf = findDuplicateTitles(entries);
  const issues = lintEntries(entries);
  // `pending` marks a result whose lookup was inconclusive and will be retried.
  const build = (i, found, pending = false) => {
    const r = buildResult(entries[i], i, found, duplicateOf[i], { ...getSettings(), issues: issues[i] });
    return pending ? { ...r, pending: true } : r;
  };
  // Indices whose lookup was inconclusive; re-checked once rate-limit pressure eases.
  const pendingRetry = state.results.filter(r => r?.pending).map(r => r.index);
  await loadVenueIndex();
  if (run !== currentRun) return;

  for (let i = startAt; i < total; i++) {
    const entry = entries[i];
    const title = entry.title || "";
    barProgressFill.style.width = Math.round(((i + 1) / total) * 100) + "%";
    barProgressText.textContent = `Verifying ${i + 1} / ${total}: ${title.slice(0, 50)}…`;

    if (!title.trim()) {
      showResult(build(i, null));
      continue;
    }

    const { found, inconclusive } = await lookupEntry(entry);
    if (run !== currentRun) return;
    if (inconclusive) pendingRetry.push(i);
    showResult(build(i, found, inconclusive));
  }

  if (pendingRetry.length) {
    barProgressText.textContent =
      `Re-checking ${pendingRetry.length} ${pendingRetry.length === 1 ? "entry" : "entries"}…`;
    await sleep(1200);
    for (let round = 0; round < 2 && pendingRetry.length; round++) {
      const stillPending = [];
      for (const i of pendingRetry) {
        const { found, inconclusive } = await lookupEntry(entries[i]);
        if (run !== currentRun) return;
        // Keep deferring only while still inconclusive and a round remains.
        if (inconclusive && round === 0) { stillPending.push(i); continue; }
        showResult(build(i, found));
      }
      pendingRetry.splice(0, pendingRetry.length, ...stillPending);
      if (pendingRetry.length) await sleep(1500);
    }
  }

  await checkEditorialNotices(run);
  if (run !== currentRun) return;

  finishProgress(total, () => {
    if (resumeTour) setTimeout(openPostVerifyTour, 450);
  });
}
