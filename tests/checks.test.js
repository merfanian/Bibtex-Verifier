import "./helpers/setup.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildExportEntries, buildResult, checkableDois, editorialNotice, entriesToBib, entryIdentifiers,
  isUncheckable, lintEntries, parseBib,
} from "../src/lib/index.js";

describe("entryIdentifiers", () => {
  it("reads a DOI from the doi field or a doi.org URL", () => {
    assert.deepEqual(entryIdentifiers({ doi: "https://doi.org/10.1145/3318464.3389700" }),
      { doi: "10.1145/3318464.3389700", arxiv: "" });
    assert.equal(entryIdentifiers({ url: "https://doi.org/10.1145/1.2?x=1" }).doi, "10.1145/1.2");
    assert.equal(entryIdentifiers({ doi: "see publisher" }).doi, "");
  });

  it("reads an arXiv ID from eprint, the venue, a URL or an arXiv DOI", () => {
    const id = (e) => entryIdentifiers(e).arxiv;
    assert.equal(id({ eprint: "2302.09419", archiveprefix: "arXiv" }), "2302.09419");
    assert.equal(id({ eprint: "2302.09419v2" }), "2302.09419");
    assert.equal(id({ journal: "arXiv preprint arXiv:2302.09419" }), "2302.09419");
    assert.equal(id({ url: "https://arxiv.org/abs/1706.03762v5" }), "1706.03762");
    assert.equal(id({ journal: "arXiv preprint cs/0112017" }), "cs/0112017");
    assert.deepEqual(entryIdentifiers({ doi: "10.48550/arXiv.1706.03762" }), { doi: "", arxiv: "1706.03762" });
  });

  it("doesn't mistake other numbers for an arXiv ID", () => {
    const id = (e) => entryIdentifiers(e).arxiv;
    assert.equal(id({ journal: "Journal of Things 2019.12345" }), "");
    assert.equal(id({ eprint: "12345", archiveprefix: "PubMed" }), "");
    assert.equal(id({ note: "Accessed 2023.0412" }), "");
  });
});

describe("isUncheckable", () => {
  it("covers web pages, theses, reports and software", () => {
    assert.ok(isUncheckable({ ENTRYTYPE: "misc", title: "PyTorch docs", url: "https://pytorch.org/docs" }));
    assert.ok(isUncheckable({ ENTRYTYPE: "online", title: "X", howpublished: "\\url{https://x.org}" }));
    assert.ok(isUncheckable({ ENTRYTYPE: "phdthesis", title: "A Thesis", school: "MIT" }));
    assert.ok(isUncheckable({ ENTRYTYPE: "techreport", title: "A Report", institution: "UIC" }));
  });

  it("never covers something that claims to be a paper", () => {
    assert.ok(!isUncheckable({ ENTRYTYPE: "article", title: "X", journal: "Nature" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "article", title: "X" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "inproceedings", title: "X", url: "https://x.org" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "book", title: "X", publisher: "MIT Press" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X" }), "misc without a URL");
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X", eprint: "2302.09419", archiveprefix: "arXiv" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X", howpublished: "arXiv preprint" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X", url: "https://arxiv.org/abs/2302.09419" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X", url: "https://doi.org/10.1/x" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "misc", title: "X", url: "https://x.org", journal: "Nature" }));
    assert.ok(!isUncheckable({ ENTRYTYPE: "techreport", title: "X", doi: "10.1000/x" }));
  });

  it("buildResult: unmatched web page is unverifiable, unmatched paper is not found", () => {
    const web = { ID: "w", ENTRYTYPE: "misc", title: "PyTorch docs", url: "https://pytorch.org" };
    assert.equal(buildResult(web, 0, null).status, "unverifiable");
    assert.equal(buildResult({ ID: "p", ENTRYTYPE: "article", title: "Made up", journal: "J" }, 0, null).status, "not_found");
    assert.equal(buildResult({ ID: "n", ENTRYTYPE: "misc", url: "https://x.org" }, 0, null).status, "not_found", "no title");
    // A matched web-type entry is compared like any other.
    assert.equal(buildResult(web, 0, { title: "PyTorch docs" }).status, "verified");
  });

  it("'Remove not-found entries' keeps unverifiable ones", () => {
    const entries = [
      { ID: "w", ENTRYTYPE: "misc", title: "Docs", url: "https://x.org", author: "A, B and C, D and E, F" },
      { ID: "p", ENTRYTYPE: "article", title: "Made up", journal: "J" },
    ];
    const results = entries.map((e, i) => buildResult(e, i, null));
    const out = buildExportEntries(entries, results, {}, { removeNotFound: true, maxAuthors: 1 });
    assert.deepEqual(out.map(e => e.ID), ["w"]);
    assert.equal(out[0].author, "A, B and C, D and E, F", "unmatched authors are not truncated");
  });
});

describe("lintEntries", () => {
  const codes = (entries) => lintEntries(entries).map(list => list.map(i => i.code));

  it("flags different papers sharing a citation key, case-insensitively", () => {
    const out = codes([
      { ID: "smith2020", ENTRYTYPE: "misc", title: "A" },
      { ID: "Smith2020", ENTRYTYPE: "misc", title: "B" },
      { ID: "other", ENTRYTYPE: "misc", title: "C" },
    ]);
    assert.deepEqual(out, [["duplicate_key"], ["duplicate_key"], []]);
  });

  it("leaves copies of one paper under one key to duplicate detection", () => {
    const out = codes([
      { ID: "smith2020", ENTRYTYPE: "misc", title: "The Same {Paper}" },
      { ID: "smith2020", ENTRYTYPE: "misc", title: "the same paper" },
    ]);
    assert.deepEqual(out, [[], []]);
  });

  it("flags a missing key, author, year and a malformed DOI", () => {
    assert.deepEqual(codes([{ ID: "", ENTRYTYPE: "misc", title: "A" }]), [["missing_key"]]);
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "article", title: "A" }]), [["missing_field", "missing_field"]]);
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "book", title: "A", editor: "E", date: "2020-01" }]), [[]]);
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "misc", title: "A", doi: "doi pending" }]), [["bad_doi"]]);
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "misc", title: "A", doi: "https://doi.org/10.1145/1.2" }]), [[]]);
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "misc", title: "A", doi: "10.1145/a\\_b" }]), [[]]);
    // Web pages need neither author nor year.
    assert.deepEqual(codes([{ ID: "a", ENTRYTYPE: "misc", title: "A" }]), [[]]);
  });

  it("buildResult drops a missing field the database supplies, keeps the rest", () => {
    const entry = { ID: "a", ENTRYTYPE: "article", title: "Great Paper", author: "Doe, Jane" };
    const issues = lintEntries([entry, { ...entry, title: "Another Paper" }])[0];
    assert.deepEqual(issues.map(i => i.code), ["duplicate_key", "missing_field"]);
    const filled = buildResult(entry, 0, { title: "Great Paper", author: "Doe, Jane", year: "2020" }, null, { issues });
    assert.deepEqual(filled.issues.map(i => i.code), ["duplicate_key"]);
    const unfilled = buildResult(entry, 0, { title: "Great Paper", author: "Doe, Jane" }, null, { issues });
    assert.deepEqual(unfilled.issues.map(i => i.code), ["duplicate_key", "missing_field"]);
    // In an entry that needs review the year is offered in a row, so it isn't reported either.
    const review = buildResult(entry, 0, { title: "Great Paper", author: "Poe, Edgar", year: "2020" }, null, { issues });
    assert.equal(review.status, "needs_review");
    assert.deepEqual(review.issues.map(i => i.code), ["duplicate_key"]);
    assert.equal(buildResult(entry, 0, null, null, { issues }).issues.length, 2);
  });
});

describe("parser: bare words and unreadable fields", () => {
  it("keeps a bare month and the fields after it, and writes it back unbraced", () => {
    const [e] = parseBib("@article{a,\n  title={T},\n  month = may,\n  year = 2020,\n  pages = {1--2}\n}");
    assert.equal(e.month, "may");
    assert.equal(e.year, "2020");
    assert.equal(e.pages, "1--2");
    assert.equal(e._unparsed, undefined);
    const bib = entriesToBib([e]);
    assert.match(bib, /^ {2}month = may,$/m);
    assert.match(bib, /^ {2}year = \{2020\},$/m);
    assert.doesNotMatch(bib, /_bare|_unparsed/);
    // An edited value is literal text, even a single word.
    assert.match(entriesToBib([{ ...e, month: "May 5" }]), /month = \{May 5\},/);
    assert.match(entriesToBib([{ ...e, month: "June" }]), /month = \{June\},/);
  });

  it("replaces a @string macro defined in the file by its text", () => {
    const [e] = parseBib('@string{jmlr = "Journal of Machine Learning Research"}\n@STRING{ nips = {NeurIPS} }\n' +
      "@article{a,\n  title={T},\n  journal = JMLR,\n  booktitle = nips,\n  month = may,\n  year={2020}\n}");
    assert.equal(e.journal, "Journal of Machine Learning Research");
    assert.equal(e.booktitle, "NeurIPS");
    assert.deepEqual(e._bare, { month: "may" });
    assert.match(entriesToBib([e]), /journal = \{Journal of Machine Learning Research\},/);
  });

  it("reads field names with hyphens, dots and colons", () => {
    const [e] = parseBib("@article{a,\n  title={T},\n  added-at = {2010-06-28},\n  bdsk-url-1 = {https://x.org},\n  date.added={x}, year={2020}\n}");
    assert.equal(e["added-at"], "2010-06-28");
    assert.equal(e["bdsk-url-1"], "https://x.org");
    assert.equal(e.year, "2020");
    assert.equal(e._unparsed, undefined);
    assert.match(entriesToBib([e]), /^ {2}added-at = \{2010-06-28\},$/m);
  });

  it("marks an entry whose fields can't all be read", () => {
    const [e, next] = parseBib('@article{a,\n  title={T},\n  journal = "A" # jmlr,\n  year={2020}\n}\n@misc{b, title={U}}');
    assert.equal(e.title, "T");
    assert.ok(e._unparsed.startsWith("#"), e._unparsed);
    assert.equal(lintEntries([e])[0].some(i => i.code === "unparsed"), true);
    assert.equal(next._unparsed, undefined);
  });

  it("doesn't mark well-formed entries, with or without trailing text", () => {
    const entries = parseBib("@article{a,\n  title={T},\n  year={2020},\n}\n% a comment\n\n@book{b,\n title = {U}, year = 1999 }\n");
    assert.deepEqual(entries.map(e => e._unparsed), [undefined, undefined]);
  });
});

describe("editorial notices", () => {
  it("reports retractions and expressions of concern, not corrections", () => {
    assert.deepEqual(editorialNotice([{ type: "correction", DOI: "10.1/c" }, { type: "retraction", DOI: "10.1/r" }]),
      { kind: "retracted", doi: "10.1/r" });
    assert.deepEqual(editorialNotice([{ type: "Expression of Concern", DOI: "10.1/e" }]), { kind: "concern", doi: "10.1/e" });
    assert.equal(editorialNotice([{ type: "correction", DOI: "10.1/c" }, { type: "erratum" }]), null);
    assert.equal(editorialNotice(undefined), null);
  });

  it("checks the matched record's DOI, never the entry's own", () => {
    const entry = { ID: "a", ENTRYTYPE: "article", title: "Great Paper", doi: "10.1000/someone-elses" };
    assert.equal(buildResult(entry, 0, { title: "Great Paper" }).found_doi, "");
    assert.equal(buildResult(entry, 0, { title: "Great Paper", doi: "10.1000/right" }).found_doi, "10.1000/right");
    assert.equal(buildResult(entry, 0, null).found_doi, "");
  });

  it("only asks about valid CrossRef-style DOIs, once each", () => {
    assert.deepEqual(checkableDois(["10.1000/A", "https://doi.org/10.1000/a", "", "nope", "10.48550/arXiv.1706.03762", "10.1000/a,b"]),
      ["10.1000/a"]);
  });
});
