import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildResult, packSession, unpackSession } from "../src/lib/index.js";

const entries = [
  { ID: "a", ENTRYTYPE: "article", title: "Paper A", year: "2020" },
  { ID: "b", ENTRYTYPE: "article", title: "Paper B" },
];
const results = entries.map((e, i) => buildResult(e, i, { title: e.title, year: "2020" }));
const edits = { 0: {}, 1: { year: { action: "found", value: "2020", _auto: true } } };
const store = (state, settings = { maxAuthors: 10 }) => JSON.stringify(packSession(state, settings, 1234));

describe("saved sessions", () => {
  it("round-trips a finished run", () => {
    const s = unpackSession(store({ parsedEntries: entries, results, fieldEdits: edits }));
    assert.deepEqual(s.parsedEntries, entries);
    assert.deepEqual(s.results, results);
    assert.deepEqual(s.fieldEdits, edits);
    assert.deepEqual(s.settings, { maxAuthors: 10 });
    assert.equal(s.savedAt, 1234);
    assert.equal(s.complete, true);
  });

  it("is incomplete while entries await a lookup or a retry", () => {
    const partial = unpackSession(store({ parsedEntries: entries, results: results.slice(0, 1), fieldEdits: edits }));
    assert.equal(partial.complete, false);
    assert.equal(partial.results.length, 1);
    assert.deepEqual(Object.keys(partial.fieldEdits), ["0"], "choices for entries not yet looked up are dropped");
    const pending = unpackSession(store({ parsedEntries: entries, results: [results[0], { ...results[1], pending: true }], fieldEdits: {} }));
    assert.equal(pending.complete, false);
  });

  it("rejects missing, foreign or malformed data", () => {
    assert.equal(unpackSession(null), null);
    assert.equal(unpackSession("not json"), null);
    assert.equal(unpackSession(JSON.stringify({ version: 99, parsedEntries: entries, results })), null);
    assert.equal(unpackSession(store({ parsedEntries: [], results: [], fieldEdits: {} })), null);
    assert.equal(unpackSession(store({ parsedEntries: entries, results: [...results, results[0]], fieldEdits: {} })), null);
    assert.equal(unpackSession(store({ parsedEntries: entries, results: [{ index: 0 }], fieldEdits: {} })), null);
  });

  it("keeps only the leading well-formed results", () => {
    const s = unpackSession(store({ parsedEntries: entries, results: [results[0], null], fieldEdits: {} }));
    assert.equal(s.results.length, 1);
    assert.equal(s.complete, false);
  });
});
