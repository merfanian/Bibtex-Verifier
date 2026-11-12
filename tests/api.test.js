import "./helpers/setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { apiSettings, fetchEditorialNotices, lookupPaper, resetRateLimits, TransientLookupError } from "../src/app/api.js";

const realFetch = globalThis.fetch;
let calls;

const json = (status, body) => new Response(JSON.stringify(body), { status });

/** Route mocked requests by host; each handler gets the parsed URL. */
function mockFetch({ ss = () => json(404, {}), cr = () => json(200, { message: { items: [] } }),
  oa = () => json(200, { results: [] }) } = {}) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (u.host.includes("semanticscholar")) return ss(u);
    if (u.host.includes("crossref")) return cr(u);
    if (u.host.includes("openalex")) return oa(u);
    throw new Error(`unexpected fetch ${url}`);
  };
}

const ssPaper = {
  title: "Attention Is All You Need", year: 2017, venue: "NeurIPS",
  authors: [{ name: "Ashish Vaswani" }], externalIds: { DOI: "10.5555/1" },
};
const crItem = {
  title: ["Attention Is All You Need"], author: [{ family: "Vaswani", given: "Ashish" }],
  "published-print": { "date-parts": [[2017]] }, "container-title": ["NeurIPS"],
  volume: "30", page: "5998-6008", DOI: "10.5555/1",
};

describe("lookupPaper", () => {
  beforeEach(() => {
    calls = [];
    Object.assign(apiSettings, { maxRetries: 1, retryBaseMs: 0, throttle: false });
    resetRateLimits();
  });
  afterEach(() => { globalThis.fetch = realFetch; });

  it("merges a Semantic Scholar match with the same CrossRef paper", async () => {
    mockFetch({
      ss: (u) => (u.pathname.endsWith("/match") ? json(200, { data: [ssPaper] }) : json(200, { data: [] })),
      cr: () => json(200, { message: { items: [crItem] } }),
    });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found._source, "semantic_scholar+crossref");
    assert.equal(found.volume, "30");
    assert.equal(found.pages, "5998-6008");
  });

  it("never fills a record from a CrossRef repository re-upload", async () => {
    // Seen live: a "posted-content" copy of the Vaswani paper under another
    // publisher's DOI replaced the DOI of the S2 record (whose arXiv DOI made
    // it look like a preprint) and added the uploader as publisher.
    const ssArxiv = { ...ssPaper, venue: "Neural Information Processing Systems",
      externalIds: { DOI: "10.48550/arXiv.1706.03762", ArXiv: "1706.03762" } };
    const posted = { ...crItem, type: "posted-content", "published-print": undefined,
      "container-title": [], DOI: "10.65215/ysbyhc05", publisher: "Some Repository" };
    mockFetch({
      ss: (u) => (u.pathname.endsWith("/match") ? json(200, { data: [ssArxiv] }) : json(200, { data: [] })),
      cr: () => json(200, { message: { items: [posted] } }),
    });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found._source, "semantic_scholar");
    assert.equal(found.doi, "10.48550/arXiv.1706.03762");
    assert.equal(found.publisher, "");
  });

  it("uses a CrossRef re-upload only when nothing else matches", async () => {
    const posted = { ...crItem, type: "posted-content", DOI: "10.1/posted" };
    mockFetch({
      cr: () => json(200, { message: { items: [posted] } }),
      oa: () => json(200, { results: [{ title: "Attention Is All You Need", publication_year: 2017, id: "W1" }] }),
    });
    assert.equal((await lookupPaper("Attention Is All You Need"))._source, "openalex");
    mockFetch({ cr: () => json(200, { message: { items: [posted] } }) });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found.doi, "10.1/posted");
    assert.ok(found._preprint);
  });

  it("retries instead of settling on a re-upload after a transient failure", async () => {
    const posted = { ...crItem, type: "posted-content", DOI: "10.1/posted" };
    mockFetch({
      ss: () => json(503, {}),
      cr: () => json(200, { message: { items: [posted] } }),
    });
    await assert.rejects(lookupPaper("Attention Is All You Need"), TransientLookupError);
  });

  describe("by identifier", () => {
    const other = { ...ssPaper, title: "A Completely Different Paper", externalIds: { DOI: "10.5555/1" } };
    const isIdCall = (u) => /\/paper\/(DOI|ARXIV):/.test(u.pathname) || /\/works\/10\./.test(decodeURIComponent(u.pathname));

    it("uses the DOI's records without any title search", async () => {
      mockFetch({
        ss: (u) => (u.pathname.endsWith("/paper/DOI:10.5555/1") ? json(200, ssPaper) : json(500, {})),
        cr: (u) => (decodeURIComponent(u.pathname).endsWith("/works/10.5555/1") ? json(200, { message: crItem }) : json(500, {})),
      });
      const found = await lookupPaper("Attention Is All You Need", { doi: "10.5555/1" });
      assert.equal(found._source, "semantic_scholar+crossref");
      assert.equal(found.pages, "5998-6008");
      assert.ok(calls.every(isIdCall), calls.map(String).join("\n"));
      assert.ok(calls.every(u => ![...u.searchParams.values()].some(v => v.includes("Attention"))));
    });

    it("looks up an arXiv ID on Semantic Scholar", async () => {
      mockFetch({
        ss: (u) => (u.pathname.endsWith("/paper/ARXIV:1706.03762") ? json(200, ssPaper) : json(404, {})),
      });
      const found = await lookupPaper("Attention Is All You Need", { arxiv: "1706.03762" });
      assert.equal(found._source, "semantic_scholar");
      assert.equal(found.year, "2017");
    });

    it("ignores a DOI that belongs to another paper and searches by title", async () => {
      mockFetch({
        ss: (u) => (u.pathname.includes("/paper/DOI:") ? json(200, other)
          : u.pathname.endsWith("/match") ? json(200, { data: [{ ...ssPaper, externalIds: { DOI: "10.5555/right" } }] })
          : json(200, { data: [] })),
        cr: (u) => (u.pathname.includes("/works/10.")
          ? json(200, { message: { ...crItem, title: ["A Completely Different Paper"] } })
          : json(200, { message: { items: [] } })),
      });
      const found = await lookupPaper("Attention Is All You Need", { doi: "10.5555/1" });
      assert.equal(found.title, "Attention Is All You Need");
      assert.equal(found.doi, "10.5555/right");
    });

    it("falls back to the title when the identifier is unknown", async () => {
      mockFetch({
        ss: (u) => (u.pathname.includes("/paper/DOI:") ? json(404, {})
          : u.pathname.endsWith("/match") ? json(200, { data: [ssPaper] }) : json(200, { data: [] })),
        cr: (u) => (u.pathname.includes("/works/10.") ? json(404, {}) : json(200, { message: { items: [crItem] } })),
      });
      const found = await lookupPaper("Attention Is All You Need", { doi: "10.9999/unknown" });
      assert.equal(found._source, "semantic_scholar+crossref");
    });

    it("an entry that matches nothing is still not found", async () => {
      mockFetch({
        ss: (u) => (u.pathname.includes("/paper/DOI:") ? json(200, other)
          : u.pathname.endsWith("/match") ? json(404, {}) : json(200, { data: [] })),
        cr: (u) => (u.pathname.includes("/works/10.") ? json(404, {}) : json(200, { message: { items: [] } })),
      });
      assert.equal(await lookupPaper("Totally Made Up Title", { doi: "10.5555/1" }), null);
    });
  });

  describe("fetchEditorialNotices", () => {
    it("asks CrossRef in batches and maps retractions by DOI", async () => {
      const dois = Array.from({ length: 45 }, (_, i) => `10.1000/p${i}`);
      mockFetch({
        cr: (u) => {
          const asked = u.searchParams.get("filter").split(",").map(f => f.replace(/^doi:/, ""));
          return json(200, { message: { items: asked.map(d => ({
            DOI: d.toUpperCase(),
            "updated-by": d === "10.1000/p3" ? [{ type: "retraction", DOI: "10.1000/notice" }] : undefined,
          })) } });
        },
      });
      const notices = await fetchEditorialNotices([...dois, "10.48550/arXiv.1706.03762", "not a doi", "10.1000/p3"]);
      assert.equal(calls.length, 2);
      assert.deepEqual([...notices], [["10.1000/p3", { kind: "retracted", doi: "10.1000/notice" }]]);
    });

    it("makes no request without DOIs and throws when CrossRef is unreachable", async () => {
      mockFetch({ cr: () => json(503, {}) });
      assert.equal((await fetchEditorialNotices(["", "10.48550/arXiv.1"])).size, 0);
      assert.equal(calls.length, 0);
      await assert.rejects(fetchEditorialNotices(["10.1000/x"]), TransientLookupError);
    });

    it("treats a rejected request as a failed check, not as no retractions", async () => {
      mockFetch({ cr: () => json(400, {}) });
      await assert.rejects(fetchEditorialNotices(["10.1000/x"]), TransientLookupError);
    });
  });

  it("only sends the title to the APIs", async () => {
    mockFetch();
    await lookupPaper("Some Title");
    assert.ok(calls.length > 0);
    for (const u of calls) {
      const values = [...u.searchParams.entries()].filter(([k]) => ["query", "query.title", "search"].includes(k));
      assert.deepEqual(values.map(([, v]) => v), ["Some Title"], u.toString());
      assert.ok(!u.searchParams.has("mailto"));
    }
  });

  it("falls back to OpenAlex when SS and CrossRef have nothing", async () => {
    mockFetch({
      oa: () => json(200, { results: [{ title: "Some OpenAlex Paper", publication_year: 2019, id: "W1" }] }),
    });
    const found = await lookupPaper("Some OpenAlex Paper");
    assert.equal(found._source, "openalex");
    assert.equal(found.year, "2019");
  });

  it("returns null for a genuine miss", async () => {
    mockFetch({ ss: (u) => (u.pathname.endsWith("/match") ? json(404, {}) : json(200, { data: [] })) });
    assert.equal(await lookupPaper("Totally Made Up"), null);
  });

  it("retries a transient failure before succeeding", async () => {
    let crCalls = 0;
    mockFetch({
      cr: () => (++crCalls === 1 ? json(503, {}) : json(200, { message: { items: [crItem] } })),
    });
    const found = await lookupPaper("Attention Is All You Need");
    assert.equal(found._source, "crossref");
    assert.equal(crCalls, 2);
  });

  it("reports an inconclusive lookup instead of a miss when a source stays down", async () => {
    mockFetch({ cr: () => json(429, {}) });
    await assert.rejects(lookupPaper("Attention Is All You Need"), TransientLookupError);
  });

  it("treats network errors as transient", async () => {
    mockFetch({ oa: () => { throw new TypeError("fetch failed"); } });
    await assert.rejects(lookupPaper("Anything"), TransientLookupError);
  });
});
