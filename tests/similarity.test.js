import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractLastNames, fallbackTokenSortRatio, normalizeAuthorSet, normalizePages,
  normalizeText, titleSimilarity,
} from "../src/lib/index.js";

describe("titleSimilarity", () => {
  it("identical titles score 100", () => {
    assert.equal(titleSimilarity("Attention Is All You Need", "Attention Is All You Need"), 100);
  });

  it("case-insensitive comparison", () => {
    assert.equal(titleSimilarity("attention is all you need", "ATTENTION IS ALL YOU NEED"), 100);
  });

  it("completely different titles score low", () => {
    const score = titleSimilarity("Attention Is All You Need", "Quantum Chromodynamics at Finite Baryon Density");
    assert.ok(score < 75, `Expected < 75, got ${score}`);
  });
});

describe("fallbackTokenSortRatio", () => {
  const pairs = [
    ["Attention Is All You Need", "Attention Is All You Need"],
    ["Attention Is All You Need", "attention is all you need"],
    ["Attention Is All You Need", "Need You All Is Attention"],
    ["Attention Is All You Need", "Quantum Chromodynamics at Finite Baryon Density"],
    ["BERT Pretraining Deep Transformers for Language",
      "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding"],
    ["Deep Residual Learning for Image Recognition", "Deep residual learning for image recognition."],
    ["Café studies", "Cafe studies"],
    ["neural information processing systems", "advances in neural information processing systems"],
    ["", "anything"],
    ["", ""],
  ];

  it("matches fuzzball.token_sort_ratio", { skip: !globalThis.fuzzball && "fuzzball not installed" }, () => {
    for (const [a, b] of pairs) {
      assert.equal(fallbackTokenSortRatio(a, b), globalThis.fuzzball.token_sort_ratio(a, b), `${a} | ${b}`);
    }
  });

  it("is order-insensitive and case-insensitive", () => {
    assert.equal(fallbackTokenSortRatio("B a C", "c b A"), 100);
  });

  it("scores empty input as 0", () => {
    assert.equal(fallbackTokenSortRatio("", "x"), 0);
    assert.equal(fallbackTokenSortRatio(null, "x"), 0);
  });
});

describe("normalizeText", () => {
  it("removes diacritics and lowercases", () => {
    assert.equal(normalizeText("René Descartes"), "rene descartes");
  });

  it("collapses whitespace", () => {
    assert.equal(normalizeText("  hello   world  "), "hello world");
  });

  it("returns empty for falsy input", () => {
    assert.equal(normalizeText(""), "");
    assert.equal(normalizeText(null), "");
  });
});

describe("normalizeAuthorSet", () => {
  it("extracts last names from 'Last, First' format", () => {
    const names = normalizeAuthorSet("Vaswani, Ashish and Shazeer, Noam");
    assert.ok(names.has("vaswani"));
    assert.ok(names.has("shazeer"));
    assert.equal(names.size, 2);
  });

  it("extracts last names from 'First Last' format", () => {
    const names = normalizeAuthorSet("Ashish Vaswani and Noam Shazeer");
    assert.ok(names.has("vaswani"));
    assert.ok(names.has("shazeer"));
  });

  it("returns empty set for empty input", () => {
    assert.equal(normalizeAuthorSet("").size, 0);
    assert.equal(normalizeAuthorSet(null).size, 0);
  });
});

describe("normalizePages", () => {
  it("normalizes different dash styles", () => {
    assert.equal(normalizePages("1--10"), "1-10");
    assert.equal(normalizePages("1 - 10"), "1-10");
    assert.equal(normalizePages("1---10"), "1-10");
  });
});

describe("extractLastNames", () => {
  it("extracts from 'Last, First and Last, First' format", () => {
    const names = extractLastNames("Vaswani, Ashish and Shazeer, Noam");
    assert.ok(names.has("vaswani"));
    assert.ok(names.has("shazeer"));
  });

  it("extracts from 'First Last' format", () => {
    assert.ok(extractLastNames("Ashish Vaswani").has("vaswani"));
  });

  it("returns empty set for empty input", () => {
    assert.equal(extractLastNames("").size, 0);
    assert.equal(extractLastNames(null).size, 0);
  });
});
