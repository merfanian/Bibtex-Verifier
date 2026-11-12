import { COMPARED_FIELDS, TITLE_MATCH_THRESHOLD } from "./constants.js";
import { normalizeTitle } from "./latex.js";
import { isPreprint } from "./matching.js";
import { authorListsAgree } from "./severity.js";
import { normalizeAuthorSet, normalizePages, normalizeText, tokenSortRatio } from "./similarity.js";

const round1 = (n) => Math.round(n * 10) / 10;

// Same year, or `origYear` later than `foundYear` by at most `max` years.
function isNewerYearWithin(origYear, foundYear, max) {
  const oy = parseInt(origYear, 10), fy = parseInt(foundYear, 10);
  return Number.isFinite(oy) && Number.isFinite(fy) && oy >= fy && oy - fy <= max;
}

export function compareAuthors(a, b) {
  const sa = normalizeAuthorSet(a), sb = normalizeAuthorSet(b);
  if (!sa.size && !sb.size) return 100;
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const n of sa) if (sb.has(n)) inter++;
  return (inter / Math.max(sa.size, sb.size)) * 100;
}

export function compareField(field, a, b) {
  const na = normalizeText(a), nb = normalizeText(b);
  if (!na && !nb) return 100;
  if (!na || !nb) return 0;
  if (field === "year" || field === "doi") return na === nb ? 100 : 0;
  if (field === "author") return compareAuthors(a, b);
  if (field === "pages") return normalizePages(na) === normalizePages(nb) ? 100 : tokenSortRatio(na, nb);
  // Token-sort ignores word order ("Data Mining and Knowledge Discovery" vs
  // "Data Discovery and Knowledge Mining" score 100); only identical text is a
  // match, everything else goes to the severity classifier.
  return na === nb ? 100 : Math.min(tokenSortRatio(na, nb), 99);
}

function titleScore(original, found) {
  return tokenSortRatio(normalizeTitle(original.title || ""), normalizeTitle(found.title || ""));
}

// A conference paper's venue arrives as `journal`; compare it against the user's `booktitle`.
function alignVenue(original, found) {
  const aligned = { ...found };
  if (original.booktitle && !original.journal && aligned.journal) {
    aligned.booktitle = aligned.journal;
    // The venue moved; don't also suggest a journal field. A journal of
    // "arXiv" may be the record's only preprint signal, so keep that.
    aligned._preprint = isPreprint(found);
    delete aligned.journal;
  }
  return aligned;
}

/**
 * Compare COMPARED_FIELDS of `original` against `found`. Returns mismatches and
 * enrichments (fields only `found` has) separately, mismatches first.
 */
function diffComparedFields(original, found, { preprintAware = false } = {}) {
  const fieldDiffs = [], enrichments = [];
  const foundIsPreprint = preprintAware && isPreprint(found);

  for (const field of COMPARED_FIELDS) {
    const origVal = original[field] || "";
    const foundVal = found[field] || "";
    if (!origVal && !foundVal) continue;

    if (!origVal.trim() && foundVal.trim()) {
      enrichments.push({ field, original: origVal, found: foundVal, score: 0 });
      continue;
    }
    if (origVal.trim() && !foundVal.trim()) continue;

    // A preprint's year is its submission year; keep the user's same-or-newer publication year.
    // A preprint's year is its submission year; publication follows within two years.
    if (field === "year" && foundIsPreprint && isNewerYearWithin(origVal, foundVal, 2))
      continue;
    // Databases often keep the online-first year; a user year one later is the print year.
    if (field === "year" && preprintAware && isNewerYearWithin(origVal, foundVal, 1))
      continue;

    // compareField scores authors as an unordered set of surnames; a swapped
    // first author or a different given name must still surface as a diff.
    let score = compareField(field, origVal, foundVal);
    if (field === "author" && score === 100 && !authorListsAgree(origVal, foundVal)) score = 99;
    if (score < 100)
      fieldDiffs.push({ field, original: origVal, found: foundVal, score: round1(score) });
  }
  return { fieldDiffs, enrichments };
}

export function compareEntry(original, found) {
  const score = titleScore(original, found);
  if (score < TITLE_MATCH_THRESHOLD) {
    return { status: "needs_review", title_score: score, field_diffs: [], suggested: found };
  }

  const { fieldDiffs, enrichments } = diffComparedFields(
    original, alignVenue(original, found), { preprintAware: true });
  const allDiffs = fieldDiffs.concat(enrichments);
  // "verified" is reserved for entries with nothing for the user to review.
  const status = allDiffs.length ? "updated" : "verified";
  const suggested = {};
  for (const d of allDiffs) if (d.found) suggested[d.field] = d.found;

  return { status, title_score: round1(score), field_diffs: allDiffs, suggested };
}

/**
 * compareEntry leaves field_diffs empty for needs_review; this builds the full
 * diff (title included) so the UI can still offer per-field suggestions.
 */
export function fieldDiffsForNeedsReview(original, found) {
  if (!found) return [];
  const aligned = alignVenue(original, found);
  const origTitle = original.title || "";
  const foundTitle = aligned.title || "";
  const titleDiffs = [];
  if (origTitle.trim() || foundTitle.trim()) {
    titleDiffs.push({
      field: "title",
      original: origTitle,
      found: foundTitle,
      score: round1(titleScore(original, aligned)),
    });
  }
  const { fieldDiffs, enrichments } = diffComparedFields(original, aligned);
  return titleDiffs.concat(fieldDiffs, enrichments);
}
