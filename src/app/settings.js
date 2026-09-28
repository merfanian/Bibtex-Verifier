// Download-settings popover in the floating bar.
import { $, $$ } from "./dom.js";

const settingsToggle = $("#settings-toggle");
const settingsPopover = $("#settings-popover");
const optRemoveDuplicates = $("#opt-remove-duplicates");
const optRemoveNotFound = $("#opt-remove-notfound");
const optCleanNotes = $("#opt-clean-notes");
const optMaxAuthors = $("#opt-max-authors");
const optPreferPublished = $("#opt-prefer-published");
const dedupCriteriaWrap = $("#dedup-criteria-wrap");

export function getSettings() {
  return {
    removeDuplicates: optRemoveDuplicates.checked,
    dedupBy: ($('input[name="dedup-criteria"]:checked') || {}).value || "title",
    removeNotFound: optRemoveNotFound.checked,
    cleanNotes: optCleanNotes.checked,
    maxAuthors: parseInt(optMaxAuthors.value) || 0,
    preferPublished: optPreferPublished.checked,
  };
}

export function setSettingsOpen(open) {
  settingsPopover.classList.toggle("open", open);
  settingsToggle.classList.toggle("active", open);
}

/**
 * @param {{ onChange: () => void, onMaxAuthorsChange: () => void }} handlers
 */
export function initSettings({ onChange, onMaxAuthorsChange }) {
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
  [optRemoveNotFound, optCleanNotes, optPreferPublished].forEach(el =>
    el.addEventListener("change", onChange));
  optMaxAuthors.addEventListener("change", onMaxAuthorsChange);
  $$('input[name="dedup-criteria"]').forEach(el => el.addEventListener("change", onChange));
}
