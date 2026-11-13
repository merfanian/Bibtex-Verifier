// Network layer: rate-limited lookups against Semantic Scholar, CrossRef and
// OpenAlex. Only paper titles, DOIs and arXiv IDs are ever sent.
//
// Semantic Scholar accepts only a small share of anonymous requests, so the
// accepted ones must carry many papers: lookupMany() finds each entry on
// CrossRef first, then fetches all their Semantic Scholar records in one batch
// request by DOI / arXiv ID. Only entries that can't be identified that way
// take the slower one-by-one title search in lookupPaper().
import {
  bestMatch, checkableDois, crossrefToStandard, editorialNotice, isSamePaper, mergeMetadata,
  MIN_TITLE_SIM, openAlexToStandard, ssToStandard, titleSimilarity,
} from "../lib/index.js";

const CROSSREF_API = "https://api.crossref.org/works";
const SS_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match";
const SS_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search";
const SS_PAPER = "https://api.semanticscholar.org/graph/v1/paper/";
const SS_BATCH = "https://api.semanticscholar.org/graph/v1/paper/batch";
const SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds";
const OPENALEX_API = "https://api.openalex.org/works";
const OPENALEX_FIELDS = "title,display_name,publication_year,doi,authorships,primary_location,biblio,id";

// Mutable so tests can shorten waits.
export const apiSettings = {
  maxRetries: 4,
  retryBaseMs: 1500,
  // Semantic Scholar turns away about two in three anonymous requests however
  // long we wait (its limit is shared by all anonymous users), and accepts
  // about one in three at a steady request per second. So its retries are
  // evenly spaced, not an exponential back-off. Faster than this gets the
  // address blocked for minutes.
  ssRetries: 7,
  ssRetryMs: 1000,
  // The batch request stands for many entries, so it is retried for longer.
  batchRetries: 15,
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
  ss: { delay: 1000, min: 1000, max: 1000 },  // steady: see apiSettings.ssRetries
  // CrossRef allows anonymous clients 1 request per second; slightly faster
  // still passes most of the time, and a rejection backs off again.
  cr: { delay: 1000, min: 700, max: 2000 },
  oa: { delay: 100, min: 50,  max: 2000 },
};
const rateBuckets = {};

// Optional personal Semantic Scholar API key (Settings). It is sent only to
// Semantic Scholar. If requests with it keep failing, the run carries on
// without it: a bad key must never turn every lookup into "not found".
const KEY_FAILURES_TO_GIVE_UP = 3;
const ssKey = { value: "", failures: 0, rejected: false };

export function setSemanticScholarKey(key) {
  ssKey.value = String(key || "").trim();
  ssKey.failures = 0;
  ssKey.rejected = false;
}

/** True when the key was given up on during the current run. */
export const semanticScholarKeyRejected = () => ssKey.rejected;

function keyFailed() {
  if (++ssKey.failures >= KEY_FAILURES_TO_GIVE_UP) ssKey.rejected = true;
}

/** Start of a run: fresh pacing, and the key gets another chance. */
export function resetRateLimits() {
  for (const [source, d] of Object.entries(RATE_DEFAULTS))
    rateBuckets[source] = { ...d, last: 0, ok: 0 };
  ssKey.failures = 0;
  ssKey.rejected = false;
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

// `body` makes it a POST. It is sent as text/plain, a "simple" request, so
// the browser doesn't spend a second (rate-limited) preflight request on it.
async function fetchJSON(url, params, { is404Ok = false, body = null, retries = null } = {}) {
  const steady = sourceOf(url) === "ss";
  retries ??= steady ? apiSettings.ssRetries : apiSettings.maxRetries;
  const retryWait = (attempt) =>
    steady ? apiSettings.ssRetryMs : apiSettings.retryBaseMs * Math.pow(2, attempt);
  // The key is dropped for the rest of this request once a keyed attempt fails.
  let withKey = steady && !!ssKey.value && !ssKey.rejected;
  const makeInit = () => {
    if (body === null && !withKey) return undefined;
    const headers = {};
    if (body !== null) headers["Content-Type"] = "text/plain";
    if (withKey) headers["x-api-key"] = ssKey.value;
    return body === null ? { headers } : { method: "POST", headers, body };
  };
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const source = sourceOf(url);
  const bucket = rateBuckets[source];
  const elapsed = Date.now() - bucket.last;
  if (apiSettings.throttle && elapsed < bucket.delay) await sleep(bucket.delay - elapsed);
  bucket.last = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(u.toString(), makeInit());
      if (resp.ok) {
        rateSuccess(source);
        if (withKey) ssKey.failures = 0;
        return resp.json();
      }
      if (withKey && (resp.status === 401 || resp.status === 403)) {
        // Key not accepted: ask again right away without it (not a retry).
        withKey = false;
        keyFailed();
        attempt--;
        continue;
      }
      if (resp.status === 404 && is404Ok) return null;
      // 429 and 5xx are transient: retry, then surface as an error so
      // congestion is never mistaken for a genuine miss.
      if (resp.status === 429 || resp.status >= 500) {
        rateBackoff(source);
        if (attempt < retries) {
          const wait = retryWait(attempt);
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
      // A browser can't read a rejected key's response: it looks like this.
      if (withKey) { withKey = false; keyFailed(); }
      rateBackoff(source);
      if (attempt < retries) {
        const wait = retryWait(attempt);
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

// Path-safe identifier: keep the ":" and "/" the APIs expect.
const idPath = (id) => encodeURIComponent(id).replace(/%3A/gi, ":").replace(/%2F/gi, "/");

/** Semantic Scholar record for "DOI:10.x/y" or "ARXIV:2302.09419", or null. */
async function fetchSSById(id) {
  const data = await fetchJSON(SS_PAPER + idPath(id), { fields: SS_FIELDS }, { is404Ok: true });
  return data?.title ? ssToStandard(data) : null;
}

/**
 * Semantic Scholar records for many "DOI:…" / "ARXIV:…" ids in one request.
 * Returns Map(id -> record); unknown ids are absent. A rejected request
 * returns an empty map, so every entry falls back to the title search.
 */
async function fetchSSBatch(ids) {
  const found = new Map();
  if (!ids.length) return found;
  const data = await fetchJSON(SS_BATCH, { fields: SS_FIELDS },
    { body: JSON.stringify({ ids }), retries: apiSettings.batchRetries });
  if (!Array.isArray(data)) return found;
  data.forEach((paper, i) => { if (paper?.title) found.set(ids[i], ssToStandard(paper)); });
  return found;
}

/**
 * Check a Semantic Scholar API key with one small request:
 * "ok", "rejected", or "unreachable" (Semantic Scholar didn't answer either way).
 */
export async function testSemanticScholarKey(key) {
  const url = `${SS_MATCH}?query=attention+is+all+you+need&fields=title`;
  const status = async (headers) => {
    try { return (await fetch(url, headers ? { headers } : undefined)).status; } catch { return -1; }
  };
  for (let i = 0; i < 2; i++) {
    const s = await status({ "x-api-key": String(key).trim() });
    if (s === 200) return "ok";
    if (s === 401 || s === 403) return "rejected";
    await sleep(apiSettings.ssRetryMs);
  }
  // In a browser a rejected key is indistinguishable from a network failure.
  // If Semantic Scholar answers without the key, the key was the problem.
  for (let i = 0; i < 5; i++) {
    if (await status(null) === 200) return "rejected";
    await sleep(apiSettings.ssRetryMs);
  }
  return "unreachable";
}

async function fetchCrossrefByDoi(doi) {
  const data = await fetchJSON(`${CROSSREF_API}/${encodeURIComponent(doi)}`, {}, { is404Ok: true });
  return data?.message?.title ? crossrefToStandard(data.message) : null;
}

const NOTICE_BATCH = 40;

/**
 * Retractions and expressions of concern (Retraction Watch data in CrossRef)
 * for `dois`. Returns Map(lowercase DOI -> { kind, doi }). Throws
 * TransientLookupError when CrossRef is unreachable.
 */
export async function fetchEditorialNotices(dois) {
  const notices = new Map();
  const list = checkableDois(dois);
  for (let i = 0; i < list.length; i += NOTICE_BATCH) {
    const batch = list.slice(i, i + NOTICE_BATCH);
    const data = await fetchJSON(CROSSREF_API, {
      filter: batch.map(d => `doi:${d}`).join(","), rows: String(batch.length), select: "DOI,updated-by",
    });
    // A rejected request (HTTP 4xx) is a failed check, not "no retractions".
    if (!Array.isArray(data?.message?.items)) throw new TransientLookupError("retraction check rejected");
    for (const item of data.message.items) {
      const notice = editorialNotice(item["updated-by"]);
      if (notice && item.DOI) notices.set(item.DOI.toLowerCase(), notice);
    }
  }
  return notices;
}

async function searchOpenAlex(title) {
  // No `mailto`: nothing that identifies the user may leave the machine.
  const data = await fetchJSON(OPENALEX_API, {
    search: title, per_page: "5", select: OPENALEX_FIELDS,
  });
  return (data?.results || []).map(openAlexToStandard);
}

/**
 * CrossRef's records for an entry: `published` (version of record) and
 * `posted`, kept apart because repository uploads ("posted-content") can
 * re-register a famous paper under a new DOI and publisher: they never fill
 * in another record and are used only when nothing else matches.
 * `transient` is true when CrossRef could not be reached.
 */
async function crossrefLookup(title, ids = {}) {
  let transient = false;
  const attempt = async (fn) => {
    try { return await fn(); }
    catch (err) {
      if (err instanceof TransientLookupError) { transient = true; return null; }
      throw err;
    }
  };
  if (ids.doi) {
    const byDoi = await attempt(() => fetchCrossrefByDoi(ids.doi));
    if (byDoi && !byDoi._preprint && titleSimilarity(title, byDoi.title || "") >= MIN_TITLE_SIM)
      return { published: byDoi, posted: null, transient };
  }
  const items = (await attempt(() => searchCrossref(title))) || [];
  return {
    published: bestMatch(items.filter(c => !c._preprint), title),
    posted: bestMatch(items.filter(c => c._preprint), title),
    transient,
  };
}

/**
 * Find the best published record for a title, or null if no source has it.
 * `ids` ({ doi, arxiv } from entryIdentifiers) are tried first: an identifier
 * names the paper exactly, but its record is used only when the title agrees,
 * so a wrong DOI can never swap in another paper.
 * `known.crossref` is a crossrefLookup() result to reuse instead of asking again.
 * Throws TransientLookupError when nothing matched but a source failed
 * transiently, so the caller can retry instead of reporting "not found".
 */
export async function lookupPaper(title, ids = {}, known = {}) {
  let transient = false;
  const attempt = async (fn) => {
    try { return await fn(); }
    catch (err) {
      if (err instanceof TransientLookupError) { transient = true; return null; }
      throw err;
    }
  };

  const sameTitle = (rec) => !!rec && titleSimilarity(title, rec.title || "") >= MIN_TITLE_SIM;
  const crossref = async () => {
    const result = known.crossref ?? await crossrefLookup(title, ids);
    if (result.transient) transient = true;
    return result;
  };

  let ssMatch = null;
  if (ids.doi || ids.arxiv) {
    const byId = await attempt(() => fetchSSById(ids.doi ? `DOI:${ids.doi}` : `ARXIV:${ids.arxiv}`));
    if (sameTitle(byId)) ssMatch = byId;
  }
  ssMatch ??= await attempt(() => searchSSMatch(title));
  if (sameTitle(ssMatch)) {
    const { published } = await crossref();
    if (published && isSamePaper(ssMatch, published))
      return mergeMetadata(ssMatch, published);
    return ssMatch;
  }

  const cr = await crossref();
  if (cr.published) return cr.published;

  const oaMatch = bestMatch((await attempt(() => searchOpenAlex(title))) || [], title);
  if (oaMatch) return oaMatch;

  const ssSearchMatch = bestMatch((await attempt(() => searchSSSearch(title))) || [], title);
  if (ssSearchMatch) return ssSearchMatch;
  // After a transient failure a better record may still exist: retry later
  // instead of settling on a re-upload.
  if (cr.posted && !transient) return cr.posted;

  if (transient) throw new TransientLookupError("inconclusive lookup");
  return null;
}

/**
 * Look up many entries with as few Semantic Scholar requests as possible.
 * `items[k]` is `{ title, author, year, ids }` (title "" = nothing to look up).
 * `onResult(k, { found, inconclusive })` is called for every item, in order;
 * `inconclusive` means a source failed transiently and the item is worth
 * retrying. `isCancelled()` stops the slower per-entry lookups early.
 *
 * An entry is identified by its own DOI / arXiv ID, or by the DOI of a
 * CrossRef record that agrees with it on title, authors and year. Anything
 * else — and any id Semantic Scholar doesn't know — goes through
 * lookupPaper()'s title search, exactly as a single lookup would.
 */
export async function lookupMany(items, onResult, isCancelled = () => false) {
  // One at a time: CrossRef allows anonymous clients a single concurrent request.
  const crossref = [];
  for (const it of items) {
    if (isCancelled()) return;
    crossref.push(it.title ? await crossrefLookup(it.title, it.ids) : null);
  }

  const idOf = items.map((it, k) => {
    if (!it.title) return null;
    if (it.ids?.doi) return `DOI:${it.ids.doi}`;
    if (it.ids?.arxiv) return `ARXIV:${it.ids.arxiv}`;
    const published = crossref[k].published;
    return published?.doi && isSamePaper(it, published) ? `DOI:${published.doi.toLowerCase()}` : null;
  });

  let byId = new Map();
  try {
    byId = await fetchSSBatch([...new Set(idOf.filter(Boolean))]);
  } catch (err) {
    if (!(err instanceof TransientLookupError)) throw err;
  }

  for (let k = 0; k < items.length; k++) {
    if (isCancelled()) return;
    const it = items[k];
    if (!it.title) { await onResult(k, { found: null, inconclusive: false }); continue; }

    const ss = idOf[k] ? byId.get(idOf[k]) : null;
    let result;
    if (ss && titleSimilarity(it.title, ss.title || "") >= MIN_TITLE_SIM) {
      const published = crossref[k].published;
      result = {
        found: published && isSamePaper(ss, published) ? mergeMetadata(ss, published) : ss,
        inconclusive: false,
      };
    } else {
      try {
        result = { found: await lookupPaper(it.title, {}, { crossref: crossref[k] }), inconclusive: false };
      } catch (err) {
        if (!(err instanceof TransientLookupError)) console.warn("Lookup failed:", err);
        result = { found: null, inconclusive: err instanceof TransientLookupError };
      }
    }
    await onResult(k, result);
  }
}
