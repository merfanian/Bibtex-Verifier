// Verification run: parse the .bib, look up each entry, render results as they arrive.
import {
  applyPublishedPreference, buildResult, entryIdentifiers, findDuplicateTitles, lintEntries,
  normalizeDoi, parseBib, setVenueIndex, stripLatex,
} from "../lib/index.js";
import { fetchEditorialNotices, lookupMany, resetRateLimits, semanticScholarKeyRejected, sleep } from "./api.js";
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

/** Show a note about the run under the summary; "" clears it, further notes are appended. */
function setRunNote(text) {
  runNote.textContent = text ? [runNote.textContent, text].filter(Boolean).join(" ") : "";
  runNote.hidden = !runNote.textContent;
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

// Entries looked up together: one Semantic Scholar batch request per chunk.
// The first chunk is small so the first results show up quickly.
const FIRST_CHUNK_SIZE = 10;
const CHUNK_SIZE = 40;

/** What lookupMany() needs to know about an entry. */
function lookupItem(entry) {
  const title = stripLatex(entry.title || "");
  return {
    // The tour's fabricated title is a guaranteed miss: don't look it up.
    title: TOUR_FAKE_MARKER.test(title) ? "" : title,
    author: entry.author || "",
    year: entry.year || "",
    ids: entryIdentifiers(entry),
  };
}

/**
 * Flag matched papers that were retracted or carry an expression of concern.
 * A failed check is reported, never silently treated as "nothing retracted".
 */
async function checkEditorialNotices(run) {
  const dois = state.results.map(r => r?.found_doi).filter(Boolean);
  if (dois.length) barProgressText.textContent = "Checking for retractions…";
  let notices;
  try {
    notices = dois.length ? await fetchEditorialNotices(dois) : new Map();
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
  // A run reopened before this point repeats the check.
  state.noticesChecked = true;
  updatePreview();
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
  state.noticesChecked = saved.complete;

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
  await loadVenueIndex();
  if (run !== currentRun) return;

  /**
   * Look up `indices` chunk by chunk and show each result as it arrives.
   * An inconclusive lookup shows as pending on the first pass, stays as it is
   * while a retry remains, and is settled on the last one. Returns the
   * indices that are still inconclusive.
   */
  const lookupAndShow = async (indices, { first = false, last = false } = {}) => {
    const inconclusive = [];
    for (let at = 0, size = FIRST_CHUNK_SIZE; at < indices.length && run === currentRun; at += size, size = CHUNK_SIZE) {
      const chunk = indices.slice(at, at + size);
      if (first) barProgressText.textContent =
        `Looking up entries ${chunk[0] + 1}–${chunk[chunk.length - 1] + 1} of ${total}…`;
      await lookupMany(chunk.map(i => lookupItem(entries[i])), (k, { found, inconclusive: unsure }) => {
        if (run !== currentRun) return;
        const i = chunk[k];
        if (unsure && !last) inconclusive.push(i);
        if (first || !unsure || last) showResult(build(i, found, unsure && !last));
        if (first) {
          barProgressFill.style.width = Math.round(((i + 1) / total) * 100) + "%";
          barProgressText.textContent = `Verified ${i + 1} / ${total}: ${(entries[i].title || "").slice(0, 50)}…`;
        }
      }, () => run !== currentRun);
    }
    return inconclusive;
  };

  // Results saved as pending by an interrupted run are retried too.
  let pendingRetry = state.results.filter(r => r?.pending).map(r => r.index);
  const remaining = Array.from({ length: total - startAt }, (_, k) => startAt + k);
  pendingRetry = pendingRetry.concat(await lookupAndShow(remaining, { first: true }));
  if (run !== currentRun) return;

  // Re-check inconclusive lookups once rate-limit pressure eases.
  for (let round = 0; round < 2 && pendingRetry.length; round++) {
    barProgressText.textContent =
      `Re-checking ${pendingRetry.length} ${pendingRetry.length === 1 ? "entry" : "entries"}…`;
    await sleep(round === 0 ? 1200 : 1500);
    pendingRetry = await lookupAndShow(pendingRetry, { last: round === 1 });
    if (run !== currentRun) return;
  }

  await checkEditorialNotices(run);
  if (run !== currentRun) return;
  if (semanticScholarKeyRejected())
    setRunNote("Semantic Scholar didn’t accept requests with your API key, so this run continued without it. Check the key in Settings.");

  finishProgress(total, () => {
    if (resumeTour) setTimeout(openPostVerifyTour, 450);
  });
}
