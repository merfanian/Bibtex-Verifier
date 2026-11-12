// Download-settings popover in the floating bar.
import { $, $$ } from "./dom.js";

const settingsToggle = $("#settings-toggle");
const settingsPopover = $("#settings-popover");
const optRemoveDuplicates = $("#opt-remove-duplicates");
const optRemoveNotFound = $("#opt-remove-notfound");
const optCleanNotes = $("#opt-clean-notes");
const optMaxAuthors = $("#opt-max-authors");
const optPreferPublished = $("#opt-prefer-published");
const optApplyMinor = $("#opt-apply-minor");
const dedupCriteriaWrap = $("#dedup-criteria-wrap");

export function getSettings() {
  return {
    removeDuplicates: optRemoveDuplicates.checked,
    dedupBy: ($('input[name="dedup-criteria"]:checked') || {}).value || "title",
    removeNotFound: optRemoveNotFound.checked,
    cleanNotes: optCleanNotes.checked,
    maxAuthors: parseInt(optMaxAuthors.value) || 0,
    preferPublished: optPreferPublished.checked,
    applyMinor: optApplyMinor.checked,
  };
}

/** Set the controls from a saved getSettings() snapshot; missing keys keep their value. */
export function applySettings(s = {}) {
  const check = (el, v) => { if (typeof v === "boolean") el.checked = v; };
  check(optRemoveDuplicates, s.removeDuplicates);
  check(optRemoveNotFound, s.removeNotFound);
  check(optCleanNotes, s.cleanNotes);
  check(optPreferPublished, s.preferPublished);
  check(optApplyMinor, s.applyMinor);
  const radio = [...$$('input[name="dedup-criteria"]')].find(el => el.value === s.dedupBy);
  if (radio) radio.checked = true;
  if ([...optMaxAuthors.options].some(o => o.value === String(s.maxAuthors)))
    optMaxAuthors.value = String(s.maxAuthors);
  dedupCriteriaWrap.classList.toggle("visible", optRemoveDuplicates.checked);
}

export function setSettingsOpen(open) {
  settingsPopover.classList.toggle("open", open);
  settingsToggle.classList.toggle("active", open);
}

/**
 * @param {{ onChange: () => void, onMaxAuthorsChange: () => void,
 *   onApplyMinorChange: (on: boolean) => void, onPreferPublishedChange: (on: boolean) => void }} handlers
 */
export function initSettings({ onChange, onMaxAuthorsChange, onApplyMinorChange, onPreferPublishedChange }) {
  optApplyMinor.addEventListener("change", () => onApplyMinorChange(optApplyMinor.checked));
  settingsToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setSettingsOpen(!settingsPopover.classList.contains("open"));
  });

  document.addEventListener("click", (e) => {
    if (!settingsPopover.contains(e.target) && e.target !== settingsToggle) setSettingsOpen(false);
  });

  optRemoveDuplicates.addEventListener("change", () => {
    dedupCriteriaWrap.classList.toggle("visible", optRemoveDuplicates.checked);
    onChange();
  });
  [optRemoveNotFound, optCleanNotes].forEach(el =>
    el.addEventListener("change", onChange));
  optPreferPublished.addEventListener("change", () => onPreferPublishedChange(optPreferPublished.checked));
  optMaxAuthors.addEventListener("change", onMaxAuthorsChange);
  $$('input[name="dedup-criteria"]').forEach(el => el.addEventListener("change", onChange));
}
