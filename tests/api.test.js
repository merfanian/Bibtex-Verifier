import "./helpers/setup.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { apiSettings, lookupPaper, resetRateLimits, TransientLookupError } from "../src/app/api.js";

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
