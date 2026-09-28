import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMPARED_FIELDS, compareAuthors, compareEntry, compareField, fieldDiffsForNeedsReview,
  MIN_TITLE_SIM, TITLE_MATCH_THRESHOLD,
} from "../src/lib/index.js";

describe("constants", () => {
  it("TITLE_MATCH_THRESHOLD is reasonable", () => {
    assert.ok(TITLE_MATCH_THRESHOLD >= 70 && TITLE_MATCH_THRESHOLD <= 100);
  });

  it("MIN_TITLE_SIM is reasonable", () => {
    assert.ok(MIN_TITLE_SIM >= 50 && MIN_TITLE_SIM <= 90);
  });

  it("COMPARED_FIELDS contains expected fields", () => {
    assert.ok(COMPARED_FIELDS.includes("author"));
    assert.ok(COMPARED_FIELDS.includes("year"));
    assert.ok(COMPARED_FIELDS.includes("doi"));
  });
});

describe("compareAuthors", () => {
  it("identical authors score 100", () => {
    assert.equal(compareAuthors("Vaswani, Ashish", "Vaswani, Ashish"), 100);
  });

  it("same last names, different format still match", () => {
    assert.equal(compareAuthors("Vaswani, Ashish and Shazeer, Noam", "Ashish Vaswani and Noam Shazeer"), 100);
  });

  it("no overlap scores 0", () => {
    assert.equal(compareAuthors("Smith, John", "Doe, Jane"), 0);
  });

  it("both empty scores 100", () => {
    assert.equal(compareAuthors("", ""), 100);
  });

  it("one empty scores 0", () => {
    assert.equal(compareAuthors("Smith, John", ""), 0);
  });
});

describe("compareField", () => {
  it("year comparison is exact", () => {
    assert.equal(compareField("year", "2023", "2023"), 100);
    assert.equal(compareField("year", "2023", "2024"), 0);
  });

  it("doi comparison is exact and case-insensitive", () => {
    assert.equal(compareField("doi", "10.1234/abc", "10.1234/ABC"), 100);
  });

  it("pages with different dashes match", () => {
    assert.equal(compareField("pages", "1--10", "1-10"), 100);
  });

  it("both empty returns 100", () => {
    assert.equal(compareField("journal", "", ""), 100);
  });
});

describe("compareEntry", () => {
  it("verified when all fields match", () => {
    const orig = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
    const found = { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017" };
    assert.equal(compareEntry(orig, found).status, "verified");
  });

  it("updated when fields differ", () => {
    const result = compareEntry(
      { title: "Attention Is All You Need", year: "2017" },
      { title: "Attention Is All You Need", year: "2018" });
    assert.equal(result.status, "updated");
    assert.ok(result.field_diffs.some(d => d.field === "year"));
    assert.equal(result.suggested.year, "2018");
  });

  it("needs_review when titles differ significantly", () => {
    const result = compareEntry({ title: "Attention Is All You Need" }, { title: "On the Origin of Species" });
    assert.equal(result.status, "needs_review");
  });

  it("enrichments mark entry as updated", () => {
    const result = compareEntry(
      { title: "Test Paper", year: "2023" },
      { title: "Test Paper", year: "2023", doi: "10.1234/test" });
    assert.equal(result.status, "updated");
    assert.ok(result.field_diffs.some(d => d.field === "doi"), "should report doi enrichment");
  });

  it("lists mismatches before enrichments", () => {
    const result = compareEntry(
      { title: "Test Paper", year: "2023" },
      { title: "Test Paper", year: "2020", doi: "10.1234/test" });
    assert.deepEqual(result.field_diffs.map(d => d.field), ["year", "doi"]);
  });

  it("compares a found journal against the user's booktitle without mutating found", () => {
    const found = { title: "Test Paper", journal: "NeurIPS" };
    const result = compareEntry({ title: "Test Paper", booktitle: "NeurIPS" }, found);
    assert.ok(!result.field_diffs.some(d => d.field === "booktitle"));
    assert.ok(!("booktitle" in found));
  });

  it("does not suggest the older year when found is a preprint", () => {
    const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
    const found = { title: "Great Paper", year: "2020", journal: "arXiv" };
    assert.ok(!compareEntry(orig, found).field_diffs.some(d => d.field === "year"),
      "should not flag the preprint's earlier year");
  });

  it("still flags a genuine year mismatch for non-preprint records", () => {
    const orig = { title: "Great Paper", year: "2021", journal: "NeurIPS" };
    const found = { title: "Great Paper", year: "2019", journal: "NeurIPS" };
    assert.ok(compareEntry(orig, found).field_diffs.some(d => d.field === "year"),
      "non-preprint year mismatch should still be reported");
  });
});

describe("fieldDiffsForNeedsReview", () => {
  it("returns empty array when found is null", () => {
    assert.deepEqual(fieldDiffsForNeedsReview({ title: "X" }, null), []);
  });

  it("includes title and differing fields for a weak title match", () => {
    const diffs = fieldDiffsForNeedsReview(
      { title: "My Completely Different Title", author: "Smith, Alice", year: "2020" },
      { title: "Attention Is All You Need", author: "Vaswani, Ashish", year: "2017", journal: "NeurIPS" });
    assert.equal(diffs[0].field, "title");
    for (const f of ["author", "year", "journal"]) assert.ok(diffs.some(d => d.field === f), f);
  });

  it("includes enrichment fields from found", () => {
    const diffs = fieldDiffsForNeedsReview(
      { title: "Different Title Here", year: "2023" },
      { title: "Another Title", year: "2023", doi: "10.1000/182" });
    assert.ok(diffs.some(d => d.field === "doi" && d.score === 0), "doi should be enrichment");
  });
});
