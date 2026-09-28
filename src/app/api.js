// Network layer: rate-limited lookups against Semantic Scholar, CrossRef and
// OpenAlex. Only paper titles are ever sent.
import {
  bestMatch, crossrefToStandard, isSamePaper, mergeMetadata, MIN_TITLE_SIM,
  openAlexToStandard, ssToStandard, titleSimilarity,
} from "../lib/index.js";

const CROSSREF_API = "https://api.crossref.org/works";
const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
const OPENALEX_API = "https://api.openalex.org/works";
const OPENALEX_FIELDS = "title,display_name,publication_year,doi,authorships,primary_location,biblio,id";

// Mutable so tests can shorten waits.
export const apiSettings = {
  maxRetries: 4,
  retryBaseMs: 1500,
  throttle: true,
};

/**
 * A source kept failing transiently (HTTP 429/5xx or network error) after all
 * retries — "the API was unreachable", as opposed to "the paper doesn't exist".
 */
export class TransientLookupError extends Error {
  constructor(message) { super(message); this.name = "TransientLookupError"; }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Adaptive rate controller ────────────────────────────────────────
// One bucket per source: current delay, its clamps, last request time, and a
// run of consecutive successes used to speed back up.
const RATE_DEFAULTS = {
  ss: { delay: 500, min: 300, max: 3000 },
  cr: { delay: 100, min: 50,  max: 2000 },
  oa: { delay: 100, min: 50,  max: 2000 },
};
const rateBuckets = {};

export function resetRateLimits() {
  for (const [source, d] of Object.entries(RATE_DEFAULTS))
    rateBuckets[source] = { ...d, last: 0, ok: 0 };
}
resetRateLimits();

function rateBackoff(source) {
  const b = rateBuckets[source];
  b.delay = Math.min(b.delay * 1.3, b.max);
  b.ok = 0;
}

function rateSuccess(source) {
  const b = rateBuckets[source];
  b.ok++;
  if (b.ok >= 2) {
    b.delay = Math.max(b.delay * 0.85, b.min);
    b.ok = 0;
  }
}

function sourceOf(url) {
  if (url.includes("semanticscholar.org")) return "ss";
  if (url.includes("openalex.org")) return "oa";
  return "cr";
}

async function fetchJSON(url, params, { is404Ok = false } = {}) {
  const { maxRetries: retries, retryBaseMs } = apiSettings;
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const source = sourceOf(url);
  const bucket = rateBuckets[source];
  const elapsed = Date.now() - bucket.last;
  if (apiSettings.throttle && elapsed < bucket.delay) await sleep(bucket.delay - elapsed);
  bucket.last = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(u.toString());
      if (resp.ok) {
        rateSuccess(source);
        return resp.json();
      }
      if (resp.status === 404 && is404Ok) return null;
      // 429 and 5xx are transient: retry, then surface as an error so
      // congestion is never mistaken for a genuine miss.
      if (resp.status === 429 || resp.status >= 500) {
        rateBackoff(source);
        if (attempt < retries) {
          const wait = retryBaseMs * Math.pow(2, attempt);
          console.warn(`Transient ${resp.status} on attempt ${attempt + 1}, retrying in ${wait}ms...`);
          await sleep(wait);
          continue;
        }
        throw new TransientLookupError(`HTTP ${resp.status} after ${retries + 1} attempts`);
      }
      // Other 4xx responses are a definitive negative (e.g. empty query).
      return null;
    } catch (err) {
      if (err instanceof TransientLookupError) throw err;
      rateBackoff(source);
      if (attempt < retries) {
        const wait = retryBaseMs * Math.pow(2, attempt);
        console.warn(`Request failed (${err.message}), retrying in ${wait}ms...`);
        await sleep(wait);
        continue;
      }
      throw new TransientLookupError(`Network error after ${retries + 1} attempts: ${err.message}`);
    }
  }
  return null;
}

// ─── Per-source searches ─────────────────────────────────────────────
async function searchSSMatch(title) {
  const data = await fetchJSON(SS_MATCH, { query: title, fields: SS_FIELDS }, { is404Ok: true });
  if (!data?.data?.[0]) return null;
  return ssToStandard(data.data[0]);
}

async function searchSSSearch(title) {
  const data = await fetchJSON(SS_SEARCH, { query: title, limit: "5", fields: SS_FIELDS });
  return (data?.data || []).map(ssToStandard);
}

async function searchCrossref(title) {
  const data = await fetchJSON(CROSSREF_API, {
    "query.title": title, rows: "5",
    select: "title,author,published-print,published-online,container-title,volume,issue,page,DOI,publisher,URL,type",
  });
  return (data?.message?.items || []).map(crossrefToStandard);
}

async function searchOpenAlex(title) {
  // No `mailto`: only the title may leave the user's machine.
  const data = await fetchJSON(OPENALEX_API, {
    search: title, per_page: "5", select: OPENALEX_FIELDS,
  });
  return (data?.results || []).map(openAlexToStandard);
}

/**
 * Find the best published record for a title, or null if no source has it.
 * Throws TransientLookupError when nothing matched but a source failed
 * transiently, so the caller can retry instead of reporting "not found".
 */
export async function lookupPaper(title) {
  let transient = false;
  const attempt = async (fn) => {
    try { return await fn(); }
    catch (err) {
      if (err instanceof TransientLookupError) { transient = true; return null; }
      throw err;
    }
  };

  const ssMatch = await attempt(() => searchSSMatch(title));
  if (ssMatch && titleSimilarity(title, ssMatch.title || "") >= MIN_TITLE_SIM) {
    const crMatch = bestMatch((await attempt(() => searchCrossref(title))) || [], title);
    if (crMatch && isSamePaper(ssMatch, crMatch))
      return mergeMetadata(ssMatch, crMatch);
    return ssMatch;
  }

  const crMatch = bestMatch((await attempt(() => searchCrossref(title))) || [], title);
  if (crMatch) return crMatch;

  const oaMatch = bestMatch((await attempt(() => searchOpenAlex(title))) || [], title);
  if (oaMatch) return oaMatch;

  const ssSearchMatch = bestMatch((await attempt(() => searchSSSearch(title))) || [], title);
  if (ssSearchMatch) return ssSearchMatch;

  if (transient) throw new TransientLookupError("inconclusive lookup");
  return null;
}
