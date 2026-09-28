import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { abbreviateVenue, cleanEntryNotes, cleanNote, entryMatchesQuery, expandVenue } from "../src/lib/index.js";

describe("abbreviateVenue", () => {
  it("abbreviates known venues", () => {
    assert.equal(abbreviateVenue("Advances in Neural Information Processing Systems"), "NeurIPS");
    assert.equal(abbreviateVenue("International Conference on Machine Learning"), "ICML");
    assert.equal(abbreviateVenue("IEEE Conference on Computer Vision and Pattern Recognition"), "CVPR");
  });

  it("returns original for unknown venues", () => {
    assert.equal(abbreviateVenue("Some Unknown Workshop"), "Some Unknown Workshop");
  });

  it("handles null/empty gracefully", () => {
    assert.equal(abbreviateVenue(""), "");
    assert.equal(abbreviateVenue(null), null);
  });
});

describe("expandVenue", () => {
  it("expands known abbreviations", () => {
    const result = expandVenue("NeurIPS");
    assert.ok(result.toLowerCase().includes("neural information processing"), `Got: ${result}`);
  });

  it("returns original for unknown abbreviations", () => {
    assert.equal(expandVenue("XYZCONF"), "XYZCONF");
  });
});

describe("cleanNote", () => {
  it("returns empty for falsy input", () => {
    assert.equal(cleanNote(""), "");
    assert.equal(cleanNote(null), "");
    assert.equal(cleanNote(undefined), "");
  });

  it("keeps a note the user actually wrote", () => {
    const note = "Cited in the related work section.";
    assert.equal(cleanNote(note), note);
  });

  it("strips Zotero read-status bookkeeping", () => {
    assert.equal(cleanNote("Read\\_Status: Read\nRead\\_Status\\_Date: 2023-06-27T01:46:48.348Z"), "");
  });

  it("strips bookkeeping after the parser collapsed newlines to spaces", () => {
    assert.equal(cleanNote("Read\\_Status: Read Read\\_Status\\_Date: 2023-06-27T01:46:48.348Z"), "");
  });

  it("keeps prose and drops the bookkeeping around it", () => {
    assert.equal(cleanNote("Read\\_Status: Read\nGreat SymCC paper.\nZSCC: 0000123"), "Great SymCC paper.");
  });

  it("is case-insensitive and tolerates unescaped underscores", () => {
    assert.equal(cleanNote("read_status: read"), "");
  });

  it("leaves unknown key-value notes alone", () => {
    assert.equal(cleanNote("PMID: 12345678"), "PMID: 12345678");
  });
});

describe("cleanEntryNotes", () => {
  it("drops a note that was pure bookkeeping", () => {
    const out = cleanEntryNotes({ ID: "poeplau2020", title: "SymCC", note: "Read\\_Status: Read" });
    assert.ok(!("note" in out));
    assert.equal(out.title, "SymCC");
  });

  it("cleans annote too and does not mutate the input", () => {
    const entry = { ID: "x", annote: "ZSCC: 0000123\nWorth re-reading." };
    assert.equal(cleanEntryNotes(entry).annote, "Worth re-reading.");
    assert.equal(entry.annote, "ZSCC: 0000123\nWorth re-reading.");
  });

  it("leaves entries without notes untouched", () => {
    const entry = { ID: "x", title: "Foo" };
    assert.deepEqual(cleanEntryNotes(entry), entry);
  });
});

describe("entryMatchesQuery", () => {
  it("empty / whitespace query matches everything", () => {
    const e = { title: "Foo", ID: "bar" };
    assert.equal(entryMatchesQuery(e, ""), true);
    assert.equal(entryMatchesQuery(e, "   "), true);
    assert.equal(entryMatchesQuery(e, null), true);
  });

  it("case-insensitive substring match on title and key", () => {
    const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
    assert.equal(entryMatchesQuery(e, "attention"), true);
    assert.equal(entryMatchesQuery(e, "VASWANI"), true);
    assert.equal(entryMatchesQuery(e, "transformer"), false);
  });

  it("AND-of-tokens: every token must match somewhere", () => {
    const e = { title: "Attention Is All You Need", ID: "vaswani2017attention" };
    assert.equal(entryMatchesQuery(e, "attention vaswani"), true);
    assert.equal(entryMatchesQuery(e, "attention nope"), false);
  });

  it("field-qualified tokens scope the match", () => {
    const e = { title: "Compositional Generation", ID: "liu2022work" };
    assert.equal(entryMatchesQuery(e, "title:compositional"), true);
    assert.equal(entryMatchesQuery(e, "title:liu"), false);
    assert.equal(entryMatchesQuery(e, "id:liu2022"), true);
    assert.equal(entryMatchesQuery(e, "key:liu2022"), true);
    assert.equal(entryMatchesQuery(e, "id:compositional"), false);
  });

  it("uses entry_id (result shape) when ID is absent", () => {
    assert.equal(entryMatchesQuery({ title: "Foo", entry_id: "smith2020foo" }, "smith"), true);
  });

  it("strips LaTeX from title before matching", () => {
    assert.equal(entryMatchesQuery({ title: "{Caf\\'e} Studies", ID: "x" }, "café"), true);
  });
});
