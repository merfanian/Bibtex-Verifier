# BibTeX Verifier

**Catch errors, hallucinated references, and missing metadata in your bibliography — automatically.**

Upload or paste your `.bib` file and BibTeX Verifier checks every entry against [CrossRef](https://www.crossref.org/) and [Semantic Scholar](https://www.semanticscholar.org/). It finds wrong authors, incorrect years, mismatched venues, missing DOIs, duplicate entries, and references that don't exist in any database — a common problem when using AI tools to generate citations.

Runs entirely in the browser. No backend, no sign-up, no data leaves your machine except title lookups to public academic APIs.

[![Live App](https://img.shields.io/badge/Try_it_now-merfanian.github.io-blue?style=for-the-badge)](https://merfanian.github.io/Bibtex-Verifier/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![CI](https://github.com/merfanian/Bibtex-Verifier/actions/workflows/ci.yml/badge.svg)](https://github.com/merfanian/Bibtex-Verifier/actions)

## Demo

![BibTeX Verifier demo](demo/demo.gif)

## Why?

- **AI-generated bibliographies are unreliable.** LLMs frequently hallucinate paper titles, invent authors, or assign wrong years. BibTeX Verifier flags entries that don't match any real publication so you can catch fabricated references before submission.
- **Manual checking is tedious.** Comparing 50+ BibTeX entries against Google Scholar one by one takes hours. This tool does it in minutes.
- **Copy-paste errors are common.** When assembling a `.bib` file from multiple sources (Overleaf, Zotero, Google Scholar, Mendeley), metadata inconsistencies creep in. BibTeX Verifier shows you a field-by-field diff of what needs fixing.

## Features

- **Drag-and-drop upload** or paste BibTeX directly from Overleaf
- **Dual-source verification** against Semantic Scholar and CrossRef for maximum coverage
- **Hallucination detection** — flags entries whose titles don't match any known publication
- **Field-by-field diff** showing exactly what differs (authors, year, venue, DOI, pages, etc.)
- **Inline editing** — accept suggestions, revert to original, edit values, or remove fields per entry
- **Live BibTeX preview** with GitHub-style diff highlighting, updated in real time as you make changes
- **Duplicate detection** by title, entry ID, or DOI
- **DOI enrichment** — fills in missing DOIs, publisher info, and volume/pages
- **Smart settings** — abbreviate venue names, prefer peer-reviewed over arXiv, remove duplicates or not-found entries
- **Dark / light theme** with system preference detection
- **Privacy-first** — your file never leaves the browser; only paper titles are sent to public APIs
- **Zero install** — works in any modern browser via [GitHub Pages](https://merfanian.github.io/Bibtex-Verifier/)

## How it works

```
Upload or paste .bib
        |
    Parse entries
        |
    For each entry:
        1. Search Semantic Scholar /match (precise title lookup)
        2. Enrich with CrossRef (volume, pages, DOI)
        3. Fall back to CrossRef search / SS general search
        |
    Compare fields → Categorize → Show results
        |
    Review & edit → Download corrected .bib
```

Results are color-coded:

| Status | Meaning |
|---|---|
| **Verified** | Title and all metadata fields match the published record |
| **Auto-Updated** | Title matches but other fields differ — shows a diff you can accept/reject |
| **Needs Review** | Title didn't match closely enough — might be a hallucinated or mistyped reference |
| **Not Found** | No match in CrossRef or Semantic Scholar — could be too new, a workshop paper, or fabricated |

## Quick start

### Use online (recommended)

Visit **[https://merfanian.github.io/Bibtex-Verifier/](https://merfanian.github.io/Bibtex-Verifier/)** — no installation needed.

### Run locally

Clone and serve the `docs/` folder with any static file server:

```bash
git clone https://github.com/merfanian/Bibtex-Verifier.git
cd Bibtex-Verifier
npx serve docs
# or: python -m http.server 8080 -d docs
```

Then open [http://localhost:3000](http://localhost:3000) (or `:8080` for Python) in your browser.

## Project structure

```
docs/                      Client-side app (deployed to GitHub Pages)
  index.html               Single-page UI with SEO meta tags
  style.css                Responsive CSS with dark/light theme support
  app.js                   UI logic: rendering, API calls, settings, preview
  lib.js                   Pure logic: parsing, comparison, fuzzy matching (UMD module)

tests/
  test_lib.js              Node.js unit tests for lib.js (62 test cases)

.github/workflows/
  ci.yml                   CI pipeline (syntax check + tests on push/PR)
  deploy.yml               GitHub Pages deployment (tests must pass first)
```

## Limitations

- **Rate limits** — CrossRef and Semantic Scholar are free APIs with rate limits. For large `.bib` files (100+ entries), verification takes a few minutes. The app uses adaptive throttling with automatic backoff and recovery.
- **Coverage gaps** — Not every paper is indexed. ArXiv preprints, workshop papers, theses, and very recent publications may show as "Not Found."
- **Metadata quality** — API metadata isn't always perfect. Venue names may differ in format (e.g., "NeurIPS" vs. "Neural Information Processing Systems"). The diff view lets you judge each change before accepting.

## Contributing

Contributions are welcome! Feel free to open issues or pull requests. Some ideas:

- Add support for additional APIs (OpenAlex, DBLP)
- Batch processing of multiple `.bib` files
- BibLaTeX-specific field handling
- Export to other citation formats

## License

This project is licensed under the [MIT License](LICENSE).
