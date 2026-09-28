import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExportEntries, buildResult, diffLines, findDuplicateTitles, truncateAuthors } from "../src/lib/index.js";

const DEFAULT_SETTINGS = {
  removeDuplicates: false, dedupBy: "title", removeNotFound: false,
  cleanNotes: false, maxAuthors: 0, preferPublished: false,
};

describe("findDuplicateTitles", () => {
  it("points later same-title entries at the first one", () => {
    const dups = findDuplicateTitles([
      { ID: "a", title: "Attention Is All You Need" },
      { ID: "b", title: "Other" },
      { ID: "c", title: "{Attention} is all you need" },
      { ID: "d" },
      { title: "Other" },
    ]);
    assert.deepEqual(dups, [null, null, "a", null, "b"]);
  });
});

describe("buildResult", () => {
  const entry = { ID: "k", ENTRYTYPE: "article", title: "Test Paper", year: "2020" };

  it("is not_found without a found record", () => {
    const r = buildResult(entry, 3, null);
    assert.equal(r.status, "not_found");
    assert.equal(r.index, 3);
    assert.equal(r.entry_id, "k");
    assert.deepEqual(r.field_diffs, []);
    assert.equal(r.duplicate_of, null);
  });

  it("carries comparison output and the duplicate marker", () => {
    const r = buildResult(entry, 0, { title: "Test Paper", year: "2021" }, "other");
    assert.equal(r.status, "updated");
    assert.equal(r.found_title, "Test Paper");
    assert.equal(r.duplicate_of, "other");
    assert.ok(r.field_diffs.some(d => d.field === "year"));
  });

  it("builds full diffs for needs_review", () => {
    const r = buildResult(entry, 0, { title: "Something Else Entirely", year: "2021" });
    assert.equal(r.status, "needs_review");
    assert.equal(r.field_diffs[0].field, "title");
  });
});

describe("truncateAuthors", () => {
  it("keeps short lists and truncates long ones with 'and others'", () => {
    assert.equal(truncateAuthors("A and B", 2), "A and B");
    assert.equal(truncateAuthors("A and B and C", 2), "A and B and others");
    assert.equal(truncateAuthors("A and B and C", 0), "A and B and C");
    assert.equal(truncateAuthors("", 2), "");
  });
});

describe("buildExportEntries", () => {
  const entries = [
    { ID: "a", ENTRYTYPE: "article", title: "A", journal: "Old", year: "2020", note: "ZSCC: 0000001" },
    { ID: "b", ENTRYTYPE: "article", title: "B", author: "X and Y and Z" },
    { ID: "c", ENTRYTYPE: "article", title: "A", doi: "10.1/x" },
  ];
  const results = [
    { status: "updated", suggested: { journal: "New" } },
    { status: "not_found", suggested: {} },
    { status: "verified", suggested: {} },
  ];

  it("applies found, custom and remove edits", () => {
    const out = buildExportEntries(entries, results, {
      0: { journal: { action: "found", value: "New" }, year: { action: "remove", value: "" } },
      2: { doi: { action: "custom", value: "10.1/y" }, title: { action: "original", value: "ignored" } },
    }, DEFAULT_SETTINGS);
    assert.equal(out[0].journal, "New");
    assert.ok(!("year" in out[0]));
    assert.equal(out[2].doi, "10.1/y");
    assert.equal(out[2].title, "A");
    assert.equal(entries[0].journal, "Old", "input entries are not mutated");
  });

  it("only exports entries that have a result so far", () => {
    assert.equal(buildExportEntries(entries, results.slice(0, 2), {}, DEFAULT_SETTINGS).length, 2);
  });

  it("removes not-found entries and duplicates when asked", () => {
    const out = buildExportEntries(entries, results, {},
      { ...DEFAULT_SETTINGS, removeNotFound: true, removeDuplicates: true });
    assert.deepEqual(out.map(e => e.ID), ["a"]);
  });

  it("dedups by DOI and ID", () => {
    const dupEntries = [{ ID: "x", doi: "10.1/A" }, { ID: "X", doi: "10.1/a" }, { ID: "z" }];
    const r = dupEntries.map(() => ({ status: "verified", suggested: {} }));
    const byDoi = buildExportEntries(dupEntries, r, {}, { ...DEFAULT_SETTINGS, removeDuplicates: true, dedupBy: "doi" });
    assert.deepEqual(byDoi.map(e => e.ID), ["x", "z"]);
    const byId = buildExportEntries(dupEntries, r, {}, { ...DEFAULT_SETTINGS, removeDuplicates: true, dedupBy: "id" });
    assert.deepEqual(byId.map(e => e.ID), ["x", "z"]);
  });

  it("truncates authors except on not-found entries", () => {
    const out = buildExportEntries(
      [{ ID: "a", author: "A and B and C" }, { ID: "b", author: "A and B and C" }],
      [{ status: "verified", suggested: {} }, { status: "not_found", suggested: {} }],
      {}, { ...DEFAULT_SETTINGS, maxAuthors: 1 });
    assert.equal(out[0].author, "A and others");
    assert.equal(out[1].author, "A and B and C");
  });

  it("cleans notes when asked", () => {
    const out = buildExportEntries(entries, results, {}, { ...DEFAULT_SETTINGS, cleanNotes: true });
    assert.ok(!("note" in out[0]));
  });

  it("replaces a preprint venue with the published one when preferPublished is set", () => {
    const e = [{ ID: "p", booktitle: "arXiv preprint" }];
    const r = [{ status: "updated", suggested: { journal: "ICML" } }];
    assert.equal(buildExportEntries(e, r, {}, { ...DEFAULT_SETTINGS, preferPublished: true })[0].booktitle, "ICML");
    assert.equal(buildExportEntries(e, r, {}, DEFAULT_SETTINGS)[0].booktitle, "arXiv preprint");
    const stillPreprint = [{ status: "updated", suggested: { journal: "CoRR" } }];
    assert.equal(buildExportEntries(e, stillPreprint, {}, { ...DEFAULT_SETTINGS, preferPublished: true })[0].booktitle,
      "arXiv preprint");
  });
});

describe("diffLines", () => {
  it("marks unchanged, added and removed lines", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "x", "c"]);
    assert.deepEqual(ops.map(o => `${o.type}:${o.text}`), ["ctx:a", "del:b", "add:x", "ctx:c"]);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(diffLines([], ["a"]), [{ type: "add", text: "a" }]);
    assert.deepEqual(diffLines(["a"], []), [{ type: "del", text: "a" }]);
  });
});
