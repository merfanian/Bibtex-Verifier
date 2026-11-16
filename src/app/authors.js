// "Max authors" setting: the download shortens every author list to the
// limit, so the cards show author values the same way.
import { truncateAuthors } from "../lib/index.js";
import { updateCardStatuses } from "./cards.js";
import { $$ } from "./dom.js";
import { getSettings } from "./settings.js";
import { state } from "./state.js";

const decoded = (row, attr) => decodeURIComponent(row.getAttribute(attr) || "");

/** Show one author row's values shortened to the limit. */
export function refreshAuthorRow(row) {
  const max = getSettings().maxAuthors;
  const cut = (authors) => truncateAuthors(authors, max);
  const action = row.dataset.action;
  if (action === "remove") return;

  // The author under "Other fields", unless the user edited it.
  if (row.classList.contains("field-row-plain")) {
    const edit = state.fieldEdits[row.dataset.entry]?.author;
    const pill = row.querySelector(".pill-value");
    if (pill && edit?.action === "original") pill.textContent = cut(edit.value || "");
    return;
  }

  const orig = decoded(row, "data-original-val");
  const found = decoded(row, "data-found-val");
  // A value the user typed is theirs: it is neither shortened nor compared.
  const custom = action === "custom";
  // Shortened, the two lists can come out identical. The download is then the
  // same whichever side is chosen, so a row that isn't a disagreement (name
  // formatting, or authors added beyond the limit) has nothing to show and is
  // hidden. A disagreement stays, with both lists in full so it can be seen.
  const same = !custom && cut(orig).trim() === cut(found).trim();
  const major = row.classList.contains("severity-major");
  const shown = same && major ? (authors) => authors : cut;

  const origPill = row.querySelector(".pill-original");
  const sugPill = row.querySelector(".pill-suggested");
  if (origPill) origPill.textContent = shown(orig);
  if (sugPill && !custom) sugPill.textContent = shown(found);
  row.classList.toggle("author-match-hidden", same && !major);
}

export function updateAuthorPills() {
  $$('.diff-row[data-field="author"]').forEach(refreshAuthorRow);
  updateCardStatuses();
}
