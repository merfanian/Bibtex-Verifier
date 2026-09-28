import { MIN_TITLE_SIM, TITLE_MATCH_THRESHOLD } from "./constants.js";
import { extractLastNames, titleSimilarity } from "./similarity.js";

// Fields where the peer-reviewed record should win when merged with a
// preprint version of the same paper.
const PUBLISHED_PREFERRED_FIELDS = ["year", "journal", "volume", "number", "pages", "publisher", "doi"];
// Preprint and published versions of the same paper rarely differ by more
// than a couple of years; allow this gap when cross-referencing sources.
const PREPRINT_YEAR_TOLERANCE = 2;

/**
 * True when a standard record looks like an arXiv (or similar) preprint,
 * whose year is the (usually earlier) submission year.
 */
export function isPreprint(record) {
  if (!record) return false;
  const doi = (record.doi || "").toLowerCase();
  if (doi.startsWith("10.48550/arxiv")) return true;
  const venue = (record.journal || "").toLowerCase().trim();
  if (/\barxiv\b/.test(venue)) return true;
  if (venue === "corr" || venue.includes("computing research repository")) return true;
  const url = (record.url || "").toLowerCase();
  if (url.includes("arxiv.org")) return true;
  return false;
}

/**
 * True when `origYear` is the same as, or a little newer than, `foundYear` —
 * i.e. the user's year plausibly reflects the published version of a paper
 * whose `found` record is an earlier preprint.
 */
export function isNewerOrSamePublicationYear(origYear, foundYear) {
  const oy = parseInt(origYear, 10), fy = parseInt(foundYear, 10);
  if (!Number.isFinite(oy) || !Number.isFinite(fy)) return false;
  return oy >= fy && oy - fy <= PREPRINT_YEAR_TOLERANCE + 1;
}

export function isSamePaper(a, b) {
  if (titleSimilarity(a.title || "", b.title || "") < TITLE_MATCH_THRESHOLD) return false;
  if (a.year && b.year) {
    const ya = parseInt(a.year, 10), yb = parseInt(b.year, 10);
    if (Number.isFinite(ya) && Number.isFinite(yb) &&
        Math.abs(ya - yb) > PREPRINT_YEAR_TOLERANCE) return false;
  }
  const aa = extractLastNames(a.author), ba = extractLastNames(b.author);
  if (aa.size && ba.size) {
    let inter = 0; for (const n of aa) if (ba.has(n)) inter++;
    if (inter / Math.max(aa.size, ba.size) < 0.3) return false;
  }
  return true;
}

export function mergeMetadata(primary, secondary) {
  const merged = { ...primary };
  for (const [k, v] of Object.entries(secondary)) {
    if (k.startsWith("_")) continue;
    if (!merged[k] && v) merged[k] = v;
  }
  // A preprint's year is the earlier submission year, so the published
  // version wins bibliographic fields.
  if (isPreprint(primary) && !isPreprint(secondary)) {
    for (const f of PUBLISHED_PREFERRED_FIELDS) {
      if (secondary[f]) merged[f] = secondary[f];
    }
  }
  merged._source = `${primary._source || ""}+${secondary._source || ""}`;
  return merged;
}

export function bestMatch(candidates, queryTitle) {
  let best = null, bestScore = 0;
  for (const c of candidates) {
    const s = titleSimilarity(queryTitle, c.title || "");
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return best && bestScore >= MIN_TITLE_SIM ? best : null;
}
