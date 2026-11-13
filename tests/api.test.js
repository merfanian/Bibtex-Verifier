import "./helpers/setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  apiSettings, fetchEditorialNotices, lookupMany, lookupPaper, resetRateLimits, semanticScholarKeyRejected,
  setSemanticScholarKey, testSemanticScholarKey, TransientLookupError,
} from "../src/app/api.js";

const realFetch = globalThis.fetch;
let calls;

const json = (status, body) => new Response(JSON.stringify(body), { status });

/** Route mocked requests by host; each handler gets the parsed URL. */
function mockFetch({ ss = () => json(404, {}), cr = () => json(200, { message: { items: [] } }),
  oa = () => json(200, { results: [] }) } = {}) {
  globalThis.fetch = async (url, init) => {
    const u = new URL(url);
    u.body = init?.body ?? null;
    calls.push(u);
    u.key = init?.headers?.["x-api-key"] ?? null;
    if (u.host.includes("semanticscholar")) return ss(u, init);
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
    Object.assign(apiSettings, { maxRetries: 1, ssRetries: 1, batchRetries: 1, retryBaseMs: 0, ssRetryMs: 0, throttle: false });
    resetRateLimits();
  });
  afterEach(() => { globalThis.fetch = realFetch; setSemanticScholarKey(""); });

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

  describe("lookupMany", () => {
    const paper = (n, extra = {}) => ({
      title: `Paper Number ${n} About Things`, year: 2020, venue: `Venue ${n}`,
      authors: [{ name: `Ann Author${n}` }], externalIds: { DOI: `10.1000/p${n}` }, ...extra,
    });
    const crOf = (n, extra = {}) => ({
      title: [`Paper Number ${n} About Things`], author: [{ family: `Author${n}`, given: "Ann" }],
      "published-print": { "date-parts": [[2020]] }, "container-title": [`Venue ${n}`],
      page: `${n}-${n + 9}`, DOI: `10.1000/p${n}`, ...extra,
    });
    const item = (n, extra = {}) => ({
      title: `Paper Number ${n} About Things`, author: `Author${n}, Ann`, year: "2020", ids: { doi: "", arxiv: "" }, ...extra,
    });
    // CrossRef answers a title search with the paper whose number is in the query.
    const crSearch = (u, known = [1, 2, 3]) => {
      const n = Number((u.searchParams.get("query.title") || "").match(/Number (\d+)/)?.[1]);
      return json(200, { message: { items: known.includes(n) ? [crOf(n)] : [] } });
    };
    const batch = (u, init, known = [1, 2, 3]) => {
      const ids = JSON.parse(init.body).ids;
      return json(200, ids.map(id => {
        const n = Number(id.match(/p(\d+)$/)?.[1]);
        return known.includes(n) ? paper(n) : null;
      }));
    };
    const collect = async (items) => {
      const out = [];
      await lookupMany(items, (k, r) => { out[k] = r; });
      return out;
    };
    const ssCalls = () => calls.filter(u => u.host.includes("semanticscholar"));

    it("identifies entries on CrossRef and fetches Semantic Scholar once for all of them", async () => {
      mockFetch({
        ss: (u, init) => (u.pathname.endsWith("/paper/batch") ? batch(u, init) : json(500, {})),
        cr: (u) => crSearch(u),
      });
      const out = await collect([item(1), item(2), item(3)]);
      assert.deepEqual(out.map(r => r.found._source), Array(3).fill("semantic_scholar+crossref"));
      assert.deepEqual(out.map(r => r.found.pages), ["1-10", "2-11", "3-12"]);
      assert.ok(out.every(r => r.inconclusive === false));
      assert.equal(ssCalls().length, 1, "one Semantic Scholar request for three entries");
      assert.deepEqual(JSON.parse(ssCalls()[0].body), { ids: ["DOI:10.1000/p1", "DOI:10.1000/p2", "DOI:10.1000/p3"] });
    });

    it("uses the entry's own DOI or arXiv ID before CrossRef's", async () => {
      mockFetch({
        ss: (u, init) => {
          const ids = JSON.parse(init.body).ids;
          return json(200, ids.map(id => (id === "ARXIV:2001.00001" ? paper(1) : id === "DOI:10.1000/p2" ? paper(2) : null)));
        },
        cr: (u) => (u.pathname.includes("/works/10.") ? json(200, { message: crOf(2) }) : crSearch(u, [])),
      });
      const out = await collect([item(1, { ids: { doi: "", arxiv: "2001.00001" } }), item(2, { ids: { doi: "10.1000/p2", arxiv: "" } })]);
      assert.deepEqual(JSON.parse(ssCalls()[0].body).ids, ["ARXIV:2001.00001", "DOI:10.1000/p2"]);
      assert.equal(out[0].found._source, "semantic_scholar");
      assert.equal(out[1].found._source, "semantic_scholar+crossref");
    });

    it("doesn't trust a CrossRef record with other authors: the title search decides", async () => {
      mockFetch({
        ss: (u, init) => (u.pathname.endsWith("/paper/batch") ? batch(u, init)
          : u.pathname.endsWith("/match") ? json(200, { data: [paper(1, { externalIds: { DOI: "10.1000/by-title" } })] })
          : json(200, { data: [] })),
        cr: (u) => crSearch(u),
      });
      const [r] = await collect([item(1, { author: "Somebody, Else" })]);
      assert.ok(!ssCalls().some(u => u.pathname.endsWith("/paper/batch")), "no id to ask about");
      assert.equal(r.found.doi, "10.1000/by-title");
    });

    it("falls back to the title search for an id Semantic Scholar doesn't know, reusing CrossRef", async () => {
      mockFetch({
        ss: (u, init) => (u.pathname.endsWith("/paper/batch") ? batch(u, init, [])
          : u.pathname.endsWith("/match") ? json(200, { data: [paper(1)] }) : json(200, { data: [] })),
        cr: (u) => crSearch(u),
      });
      const [r] = await collect([item(1)]);
      assert.equal(r.found._source, "semantic_scholar+crossref");
      assert.equal(calls.filter(u => u.host.includes("crossref")).length, 1, "CrossRef asked once");
    });

    it("still answers when the batch request keeps failing", async () => {
      mockFetch({
        ss: (u) => (u.pathname.endsWith("/paper/batch") ? json(429, {})
          : u.pathname.endsWith("/match") ? json(200, { data: [paper(1)] }) : json(200, { data: [] })),
        cr: (u) => crSearch(u),
      });
      const [r] = await collect([item(1)]);
      assert.equal(r.found._source, "semantic_scholar+crossref");
    });

    it("reports misses, inconclusive lookups and untitled entries, in order", async () => {
      mockFetch({
        ss: (u, init) => (u.pathname.endsWith("/paper/batch") ? batch(u, init)
          : u.searchParams.get("query")?.includes("Number 8") ? json(503, {})
          : u.pathname.endsWith("/match") ? json(404, {}) : json(200, { data: [] })),
        cr: (u) => crSearch(u),
      });
      const order = [];
      await lookupMany([item(9), item(1), item(0, { title: "" }), item(8)], (k, r) => { order.push([k, !!r.found, r.inconclusive]); });
      assert.deepEqual(order, [[0, false, false], [1, true, false], [2, false, false], [3, false, true]]);
    });

    it("sends only titles and identifiers", async () => {
      mockFetch({ ss: (u, init) => (init?.body ? batch(u, init) : json(404, {})), cr: (u) => crSearch(u) });
      await collect([item(1, { author: "Author1, Ann and Secret, Coauthor" })]);
      for (const u of calls) {
        assert.ok(!u.toString().includes("Secret") && !(u.body || "").includes("Secret"));
        assert.ok(!u.searchParams.has("mailto"));
      }
    });

    it("stops the per-entry lookups when cancelled", async () => {
      mockFetch({ ss: () => json(404, {}), cr: (u) => crSearch(u, []) });
      const seen = [];
      await lookupMany([item(7), item(8)], (k) => { seen.push(k); }, () => seen.length >= 1);
      assert.deepEqual(seen, [0]);
    });
  });

  describe("Semantic Scholar API key", () => {
    const ssOk = (u) => (u.pathname.endsWith("/match") ? json(200, { data: [ssPaper] }) : json(200, { data: [] }));
    const crOk = () => json(200, { message: { items: [crItem] } });

    it("is sent to Semantic Scholar only, on GET and batch requests", async () => {
      setSemanticScholarKey("  my-key ");
      mockFetch({ ss: (u, init) => (init?.body ? json(200, [ssPaper]) : ssOk(u)), cr: crOk, oa: () => json(200, { results: [] }) });
      await lookupPaper("Attention Is All You Need");
      await lookupMany([{ title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017", ids: {} }], () => {});
      const ss = calls.filter(u => u.host.includes("semanticscholar"));
      assert.ok(ss.length >= 2 && ss.some(u => u.body));
      assert.ok(ss.every(u => u.key === "my-key"));
      assert.ok(calls.filter(u => !u.host.includes("semanticscholar")).every(u => u.key === null));
    });

    it("is not sent when unset", async () => {
      mockFetch({ ss: ssOk, cr: crOk });
      await lookupPaper("Attention Is All You Need");
      assert.ok(calls.every(u => u.key === null));
    });

    it("a rejected key never hides a paper: the request is repeated without it", async () => {
      setSemanticScholarKey("bad-key");
      mockFetch({ ss: (u) => (u.key ? json(403, { message: "Forbidden" }) : ssOk(u)), cr: crOk });
      for (let i = 0; i < 2; i++) {
        const found = await lookupPaper("Attention Is All You Need");
        assert.equal(found._source, "semantic_scholar+crossref");
      }
      assert.equal(semanticScholarKeyRejected(), false, "not given up yet");
      await lookupPaper("Attention Is All You Need");
      assert.equal(semanticScholarKeyRejected(), true);
      calls = [];
      await lookupPaper("Attention Is All You Need");
      assert.ok(calls.every(u => u.key === null), "the key is no longer sent in this run");
      resetRateLimits();
      assert.equal(semanticScholarKeyRejected(), false, "a new run tries the key again");
    });

    it("treats an unreadable failure with the key like a rejection (browser)", async () => {
      setSemanticScholarKey("bad-key");
      mockFetch({ ss: (u) => { if (u.key) throw new TypeError("NetworkError"); return ssOk(u); }, cr: crOk });
      const found = await lookupPaper("Attention Is All You Need");
      assert.equal(found._source, "semantic_scholar+crossref");
    });

    it("testSemanticScholarKey tells a working key, a rejected one and no answer apart", async () => {
      mockFetch({ ss: (u) => (u.key === "good" ? json(200, { data: [] }) : u.key ? json(403, {}) : json(200, { data: [] })) });
      assert.equal(await testSemanticScholarKey("good"), "ok");
      assert.equal(await testSemanticScholarKey("bad"), "rejected");
      mockFetch({ ss: (u) => { if (u.key) throw new TypeError("NetworkError"); return json(200, { data: [] }); } });
      assert.equal(await testSemanticScholarKey("bad"), "rejected");
      mockFetch({ ss: () => { throw new TypeError("NetworkError"); } });
      assert.equal(await testSemanticScholarKey("any"), "unreachable");
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
