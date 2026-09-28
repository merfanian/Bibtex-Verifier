import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bestMatch, isPreprint, isSamePaper, mergeMetadata } from "../src/lib/index.js";

describe("isSamePaper", () => {
  it("same paper returns true", () => {
    const a = { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" };
    assert.equal(isSamePaper(a, { ...a }), true);
  });

  it("different titles returns false", () => {
    assert.equal(isSamePaper({ title: "Paper A" }, { title: "Completely Different Paper" }), false);
  });

  it("different years returns false", () => {
    assert.equal(isSamePaper(
      { title: "Attention Is All You Need", year: "2017" },
      { title: "Attention Is All You Need", year: "2020" }), false);
  });

  it("treats preprint and published years within tolerance as the same paper", () => {
    assert.equal(isSamePaper(
      { title: "Attention Is All You Need", year: "2016", author: "Vaswani, Ashish" },
      { title: "Attention Is All You Need", year: "2017", author: "Vaswani, Ashish" }), true);
  });
});

describe("isPreprint", () => {
  it("detects arXiv by venue, DOI, and URL", () => {
    assert.equal(isPreprint({ journal: "arXiv" }), true);
    assert.equal(isPreprint({ journal: "arXiv.org" }), true);
    assert.equal(isPreprint({ doi: "10.48550/arXiv.1706.03762" }), true);
    assert.equal(isPreprint({ url: "https://arxiv.org/abs/1706.03762" }), true);
    assert.equal(isPreprint({ journal: "CoRR" }), true);
  });

  it("does not flag published venues as preprints", () => {
    assert.equal(isPreprint({ journal: "NeurIPS", doi: "10.5555/x" }), false);
    assert.equal(isPreprint({}), false);
    assert.equal(isPreprint(null), false);
  });
});

describe("mergeMetadata", () => {
  it("primary fields take precedence", () => {
    const merged = mergeMetadata(
      { title: "A", year: "2020", _source: "ss" },
      { title: "B", year: "2021", doi: "10.1234", _source: "cr" });
    assert.equal(merged.title, "A");
    assert.equal(merged.year, "2020");
    assert.equal(merged.doi, "10.1234");
    assert.equal(merged._source, "ss+cr");
  });

  it("fills empty fields from secondary", () => {
    const merged = mergeMetadata({ title: "A", _source: "ss" }, { doi: "10.1234", volume: "5", _source: "cr" });
    assert.equal(merged.doi, "10.1234");
    assert.equal(merged.volume, "5");
  });

  it("published record wins bibliographic fields over a preprint primary", () => {
    const merged = mergeMetadata(
      { title: "A", year: "2020", journal: "arXiv", _source: "semantic_scholar" },
      { title: "A", year: "2021", journal: "NeurIPS", doi: "10.1/x", _source: "crossref" });
    assert.equal(merged.year, "2021", "published year should win");
    assert.equal(merged.journal, "NeurIPS", "published venue should win");
    assert.equal(merged.doi, "10.1/x");
  });
});

describe("bestMatch", () => {
  it("returns best matching candidate above threshold", () => {
    const result = bestMatch([{ title: "Completely Wrong" }, { title: "Attention Is All You Need" }],
      "Attention Is All You Need");
    assert.equal(result.title, "Attention Is All You Need");
  });

  it("returns null when no candidate meets threshold", () => {
    assert.equal(bestMatch([{ title: "Quantum Chromodynamics at Finite Baryon Density" }],
      "Attention Is All You Need"), null);
  });

  it("returns null for empty candidates", () => {
    assert.equal(bestMatch([], "test"), null);
  });
});
