import { compareEntry, fieldDiffsForNeedsReview } from "./compare.js";
import { COMPARED_FIELDS } from "./constants.js";
import { normalizeTitle } from "./latex.js";
import { classifyDiffs, maxSeverity, NO_COMMON_AUTHORS, PUBLISHED_VERSION, SEVERITY } from "./severity.js";

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
export function buildResult(entry, index, found, duplicateOf = null, { preferPublished = false } = {}) {
  let status = "not_found", titleScore = 0, fieldDiffs = [], suggested = {};
  let reviewReason = null, publishedOnly = false;
  if (found) {
    const cmp = compareEntry(entry, found);
    status = cmp.status;
    titleScore = cmp.title_score;
    suggested = cmp.suggested;
    fieldDiffs = classifyDiffs(
      status === "needs_review" ? fieldDiffsForNeedsReview(entry, found) : cmp.field_diffs,
      entry, found);
    if (status === "needs_review") {
      reviewReason = "title";
    } else if (fieldDiffs.some(isDifferentWork)) {
      // Same title, but none of the authors: a different book/paper that shares the name.
      status = "needs_review";
      reviewReason = "different_work";
    } else if (maxSeverity(fieldDiffs) === SEVERITY.MAJOR) {
      // Citing the preprint of a since-published paper is the only issue:
      // the "Prefer peer-reviewed" setting decides it (see applyPublishedPreference).
      publishedOnly = fieldDiffs.every(d => d.severity !== SEVERITY.MAJOR || d.reason === PUBLISHED_VERSION);
      status = "needs_review";
      reviewReason = "fields";
    }
    // Most important first; keep the comparison's order within a severity.
    const rank = { major: 0, enrichment: 1, minor: 2 };
    fieldDiffs = fieldDiffs
      .map((d, i) => [d, i])
      .sort(([a, i], [b, j]) => (a.field === "title" ? -1 : b.field === "title" ? 1 : 0) ||
        rank[a.severity] - rank[b.severity] || i - j)
      .map(([d]) => d);
  }
  return applyPublishedPreference({
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
    // Why a matched entry needs review: "title" (weak title match),
    // "different_work" (same title, different authors) or "fields" (major diffs).
    review_reason: reviewReason,
    // True when the only major differences point to the published version.
    published_only: publishedOnly,
    // Fields you have that the database record lacks, so they couldn't be checked.
    unchecked: found
      ? COMPARED_FIELDS.filter(f => (entry[f] || "").trim() && !(found[f] || "").trim() &&
          !(f === "booktitle" && (found.journal || "").trim()))
      : [],
  }, preferPublished);
}

/**
 * A result whose only problem is citing a preprint of a published paper is
 * auto-updated to the published version when `preferPublished` is on, and
 * needs review otherwise. Other results are returned unchanged.
 */
export function applyPublishedPreference(result, preferPublished) {
  if (!result.published_only) return result;
  return preferPublished
    ? { ...result, status: "updated", review_reason: null }
    : { ...result, status: "needs_review", review_reason: "fields" };
}

const isDifferentWork = (d) =>
  d.field === "author" && d.severity === SEVERITY.MAJOR && d.reason === NO_COMMON_AUTHORS;

/**
 * Whether a diff row starts out adopting the database value. An entry that
 * needs review changes nothing until the user decides; an auto-updated one
 * adopts everything, except formatting-only fixes when `applyMinor` is off.
 */
export function adoptsByDefault(result, diff, { applyMinor = true } = {}) {
  if (!result || result.status !== "updated" && result.status !== "verified") return false;
  if (diff.prefer === "original") return false;
  if (diff.severity === SEVERITY.MINOR) return applyMinor;
  return true;
}
