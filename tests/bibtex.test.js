import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { entriesToBib, normalizeTitle, parseBib, stripLatex } from "../src/lib/index.js";

describe("stripLatex", () => {
  it("removes LaTeX accents", () => {
    assert.equal(stripLatex("\\'a"), "á");
    assert.equal(stripLatex('\\"o'), "ö");
    assert.equal(stripLatex("\\~n"), "ñ");
  });

  it("removes LaTeX commands", () => {
    assert.equal(stripLatex("\\textbf{bold}"), "bold");
    assert.equal(stripLatex("\\emph{text}"), "text");
  });

  it("removes braces", () => {
    assert.equal(stripLatex("{Hello} {World}"), "Hello World");
  });

  it("returns empty for falsy input", () => {
    assert.equal(stripLatex(""), "");
    assert.equal(stripLatex(null), "");
    assert.equal(stripLatex(undefined), "");
  });

  it("handles combined LaTeX", () => {
    const result = stripLatex("Ren\\'{e} {D}escartes");
    assert.ok(result.includes("Descartes"), `Expected Descartes in "${result}"`);
  });
});

describe("normalizeTitle", () => {
  it("lowercases and strips LaTeX", () => {
    assert.equal(normalizeTitle("{Attention} Is All You Need"), "attention is all you need");
  });

  it("handles empty string", () => {
    assert.equal(normalizeTitle(""), "");
  });
});

describe("parseBib", () => {
  it("parses a single article entry", () => {
    const entries = parseBib(`@article{vaswani2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  year = {2017},
}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ENTRYTYPE, "article");
    assert.equal(entries[0].ID, "vaswani2017");
    assert.equal(entries[0].title, "Attention Is All You Need");
    assert.equal(entries[0].author, "Vaswani, Ashish");
    assert.equal(entries[0].year, "2017");
  });

  it("parses multiple entries", () => {
    const entries = parseBib(`@article{a, title={Paper A}, year={2020}}
@inproceedings{b, title={Paper B}, year={2021}}`);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ID, "a");
    assert.equal(entries[1].ID, "b");
    assert.equal(entries[1].ENTRYTYPE, "inproceedings");
  });

  it("skips @string and @comment entries", () => {
    const entries = parseBib(`@string{foo = {bar}}

@comment{This is a comment, with commas}

@article{real, title={Real Entry}, year={2023}}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ID, "real");
  });

  it("handles double-quoted field values", () => {
    assert.equal(parseBib(`@article{test, title="Quoted Title", year={2023}}`)[0].title, "Quoted Title");
  });

  it("handles numeric field values", () => {
    assert.equal(parseBib(`@article{test, title={Test}, year=2023}`)[0].year, "2023");
  });

  it("returns empty array for invalid input", () => {
    assert.deepEqual(parseBib("not bibtex"), []);
    assert.deepEqual(parseBib(""), []);
  });

  it("parses misc with missing closing braces before next field (double-brace typos)", () => {
    const entries = parseBib(`@misc{github_copilot_2025,
  author = {{GitHub},
  title = {{GitHub Copilot},
  howpublished = {\\url{https://github.com/features/copilot},
  year = {2025},
  note = {Accessed: 2025-06-01},
}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].author, "{GitHub}");
    assert.equal(entries[0].title, "{GitHub Copilot}");
    assert.ok(entries[0].howpublished.includes("github.com/features/copilot"));
    assert.equal(entries[0].year, "2025");
  });

  it("keeps fields after an '@' inside a value (email in note)", () => {
    const entries = parseBib(`@article{k1,
  title = {A study of foo},
  note = {contact author at foo@bar.edu},
  year = {2020},
}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].note, "contact author at foo@bar.edu");
    assert.equal(entries[0].year, "2020");
  });

  it("does not split one entry into two on an '@' in a value", () => {
    const entries = parseBib(`@article{k1,
  title = {First},
  url = {https://example.com/@handle/post},
  year = {2020},
}
@article{k2,
  title = {Second},
  year = {2021},
}`);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].ID, "k1");
    assert.equal(entries[0].url, "https://example.com/@handle/post");
    assert.equal(entries[0].year, "2020");
    assert.equal(entries[1].ID, "k2");
    assert.equal(entries[1].year, "2021");
  });

  it("parses misc Cursor-style malformed braces", () => {
    const entries = parseBib(`@misc{cursor_2025,
  author = {{Anysphere},
  title = {{Cursor: The AI Code Editor},
  howpublished = {\\url{https://www.cursor.com},
  year = {2025},
}`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].author, "{Anysphere}");
    assert.equal(entries[0].title, "{Cursor: The AI Code Editor}");
  });
});

describe("entriesToBib", () => {
  it("serializes entries back to BibTeX", () => {
    const bib = entriesToBib([{ ENTRYTYPE: "article", ID: "test2023", title: "My Paper", year: "2023" }]);
    assert.ok(bib.includes("@article{test2023,"));
    assert.ok(bib.includes("title = {My Paper}"));
    assert.ok(bib.includes("year = {2023}"));
  });

  it("skips internal fields starting with _", () => {
    const bib = entriesToBib([{ ENTRYTYPE: "article", ID: "x", title: "T", _source: "crossref" }]);
    assert.ok(!bib.includes("_source"));
  });

  it("round-trips parse → serialize", () => {
    const entries = parseBib(`@inproceedings{bert2019,
  title = {BERT: Pre-training of Deep Bidirectional Transformers},
  author = {Devlin, Jacob},
  year = {2019},
}`);
    const reparsed = parseBib(entriesToBib(entries));
    assert.equal(reparsed.length, 1);
    assert.equal(reparsed[0].title, entries[0].title);
    assert.equal(reparsed[0].author, entries[0].author);
  });
});
