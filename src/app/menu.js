// The header's gear button: a dialog with Settings (optional Semantic Scholar
// API key), About and What's new (rendered from CHANGELOG.md).
import { renderMarkdownLite } from "../lib/index.js";
import { setSemanticScholarKey, testSemanticScholarKey } from "./api.js";
import { $, $$ } from "./dom.js";

const KEY_STORAGE = "bv-s2-key";

const dialog = $("#app-dialog");
const keyInput = $("#s2-key-input");
const keyStatus = $("#key-status");
const btnShow = $("#btn-key-show");
const btnSave = $("#btn-key-save");
const changelogPanel = $("#menu-panel-changelog");

function storedKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ""; } catch { return ""; }
}

function storeKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
    return true;
  } catch { return false; }
}

function setStatus(text, kind = "") {
  keyStatus.textContent = text;
  keyStatus.dataset.kind = kind;
}

function showPanel(name) {
  $$(".app-dialog-tab").forEach(tab => {
    const on = tab.dataset.panel === name;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", on ? "true" : "false");
  });
  $$(".app-dialog-panel").forEach(panel => {
    const on = panel.id === `menu-panel-${name}`;
    panel.classList.toggle("active", on);
    panel.hidden = !on;
  });
  if (name === "changelog") loadChangelog();
}

let changelogLoaded = false;
async function loadChangelog() {
  if (changelogLoaded) return;
  try {
    const resp = await fetch("CHANGELOG.md");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    changelogPanel.innerHTML = renderMarkdownLite(await resp.text());
    changelogLoaded = true;
  } catch {
    changelogPanel.innerHTML = `<p class="dialog-note">The list of changes couldn’t be loaded. It is also on
      <a href="https://github.com/merfanian/Bibtex-Verifier/blob/main/src/CHANGELOG.md" target="_blank" rel="noopener">GitHub</a>.</p>`;
  }
}

/** Save the key, then check it. A key that can't be confirmed is still kept. */
async function saveKey() {
  const key = keyInput.value.trim();
  if (!key) { removeKey(); return; }
  const saved = storeKey(key);
  setSemanticScholarKey(key);
  btnSave.disabled = true;
  setStatus("Checking the key with Semantic Scholar…");
  const verdict = await testSemanticScholarKey(key);
  btnSave.disabled = false;
  const where = saved ? "Saved." : "This browser blocks storage, so the key lasts only until you close the page.";
  if (verdict === "ok") setStatus(`${where} The key works.`, "ok");
  else if (verdict === "rejected") setStatus(`${where} Semantic Scholar did not accept this key; check it for typos. Runs continue without it if it keeps failing.`, "error");
  else setStatus(`${where} Semantic Scholar didn’t answer, so the key isn’t confirmed yet.`, "warn");
}

function removeKey() {
  storeKey("");
  setSemanticScholarKey("");
  keyInput.value = "";
  setStatus("No key: lookups use Semantic Scholar’s shared anonymous access.");
}

export function initMenu() {
  const key = storedKey();
  setSemanticScholarKey(key);
  keyInput.value = key;
  if (key) setStatus("A key is saved in this browser.");

  $("#btn-open-menu").addEventListener("click", () => {
    showPanel("settings");
    dialog.showModal();
  });
  $("#app-dialog-close").addEventListener("click", () => dialog.close());
  // A click on the backdrop (the dialog element itself) closes it.
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  $$(".app-dialog-tab").forEach(tab => tab.addEventListener("click", () => showPanel(tab.dataset.panel)));

  $("#key-form").addEventListener("submit", (e) => { e.preventDefault(); saveKey(); });
  $("#btn-key-remove").addEventListener("click", removeKey);
  btnShow.addEventListener("click", () => {
    const show = keyInput.type === "password";
    keyInput.type = show ? "text" : "password";
    btnShow.textContent = show ? "Hide" : "Show";
    btnShow.setAttribute("aria-pressed", show ? "true" : "false");
  });
}
