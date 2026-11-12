// Keeps the current run in this browser's localStorage so a reload (or a
// closed tab) doesn't lose a long verification or the user's choices.
import { packSession, unpackSession } from "../lib/index.js";
import { $ } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

const STORAGE_KEY = "bv-session";
const SAVE_DELAY_MS = 400;

const banner = $("#resume-banner");
const bannerText = $("#resume-banner-text");

let saveTimer = null;

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!state.persist || !state.results.length) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(packSession(state, getSettings())));
  } catch {
    // Storage is full or disabled. A stale copy would restore the wrong run, so drop it.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
  }
}

/** Save shortly after the latest change; called on every result and choice. */
export function scheduleSave() {
  if (!state.persist) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function loadSavedSession() {
  try { return unpackSession(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
}

function discardSavedSession() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ }
}

export function hideResumeBanner() {
  banner.hidden = true;
}

function ago(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Offer to restore the last run, if one was saved.
 * @param {{ onResume: (saved: object) => void }} handlers
 */
export function initSession({ onResume }) {
  // Don't lose the last few changes when the tab closes.
  window.addEventListener("pagehide", () => { if (saveTimer) saveNow(); });

  const saved = loadSavedSession();
  if (!saved) return;
  const total = saved.parsedEntries.length;
  bannerText.textContent = saved.complete
    ? `Your last run (${total} ${total === 1 ? "entry" : "entries"}, ${ago(saved.savedAt)}) is saved in this browser, with your choices.`
    : `Your last run stopped at entry ${saved.results.length} of ${total} (${ago(saved.savedAt)}). It is saved in this browser.`;
  $("#btn-resume").textContent = saved.complete ? "Open it" : "Continue";
  banner.hidden = false;

  $("#btn-resume").addEventListener("click", () => {
    // Re-read: the tab may have been open for a while.
    const latest = loadSavedSession();
    hideResumeBanner();
    if (latest) onResume(latest);
  });
  $("#btn-resume-discard").addEventListener("click", () => {
    discardSavedSession();
    hideResumeBanner();
  });
}
