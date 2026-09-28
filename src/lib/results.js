import { compareEntry, fieldDiffsForNeedsReview } from "./compare.js";
import { normalizeTitle } from "./latex.js";

/**
 * For each entry, the ID of an earlier entry with the same normalized title,
 * or null.
 */
export function findDuplicateTitles(entries) {
  const seen = new Map();
  return entries.map((entry, i) => {
    const key = normalizeTitle(entry.title || "");
    if (!key) return null;
    if (seen.has(key)) return seen.get(key);
    seen.set(key, entry.ID || `entry_${i}`);
    return null;
  });
}

/**
 * Turn a lookup outcome into the result object the UI renders: a missing
 * `found` record is "not_found", otherwise the entry is compared against it.
 */
export function buildResult(entry, index, found, duplicateOf = null) {
  let status = "not_found", titleScore = 0, fieldDiffs = [], suggested = {};
  if (found) {
    const cmp = compareEntry(entry, found);
    status = cmp.status;
    titleScore = cmp.title_score;
    suggested = cmp.suggested;
    fieldDiffs = status === "needs_review" ? fieldDiffsForNeedsReview(entry, found) : cmp.field_diffs;
  }
  return {
    index,
    entry_id: entry.ID || "",
    entry_type: entry.ENTRYTYPE || "",
    title: entry.title || "",
    status,
    title_score: titleScore,
    field_diffs: fieldDiffs,
    suggested,
    found_title: found ? (found.title || "") : "",
    duplicate_of: duplicateOf,
  };
}
