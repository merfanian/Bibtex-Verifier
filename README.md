# BibTeX Verifier

A web app that verifies your `.bib` file entries against academic databases. Upload a bibliography, and it checks every entry's metadata (authors, year, venue, DOI, etc.) against [CrossRef](https://www.crossref.org/) and [Semantic Scholar](https://www.semanticscholar.org/) to catch errors and fill in missing fields.

Runs entirely in the browser -- no backend, no installation, no data leaves your machine except the title lookups.

![License: MIT](https://img.shields.io/badge/license-MIT-green)
![Docker](https://img.shields.io/docker/v/merfanian/bibtex-verifier?label=docker)

## Demo

![BibTeX Verifier demo](demo/demo.gif)

## Why?

If you've ever manually compared dozens of BibTeX entries against Google Scholar to make sure the authors, year, and venue are correct, you know how tedious it is. This tool automates that process: it looks up each entry by title, compares the fields, and tells you exactly what's wrong -- or fixes it for you.

## Features

- **Drag-and-drop upload** of `.bib` files (standard BibTeX and BibLaTeX)
- **Real-time progress** as entries are checked one by one
- **Three-tier categorization** of results:
  - **Verified** -- title and all metadata fields match the online record
  - **Auto-Updated** -- title matches but other details (authors, year, venue, DOI, etc.) differ; shows a field-by-field diff
  - **Needs Review** -- title didn't match closely enough, or no result was found
- **Accept / reject** suggested changes individually per entry
- **Download** the corrected `.bib` file with your decisions applied
- **Enrichment** -- fills in missing DOIs, publisher info, and other fields from API data
- **LaTeX-aware** -- strips `\textbf`, accents (`\'e`), braces, etc. before comparing
- **Zero install** -- works in any modern browser via GitHub Pages

## How it works

```
Upload .bib  -->  Parse entries  -->  For each entry:
                                        1. Search Semantic Scholar /match (precise title lookup)
                                        2. Enrich with CrossRef (volume, pages, DOI)
                                        3. Fall back to CrossRef search / SS general search
                                      -->  Compare fields  -->  Categorize  -->  Show results
```

- **Semantic Scholar's `/match` endpoint** is tried first -- it's designed for exact title lookup and returns the single best match.
- **CrossRef** provides richer metadata (volume, pages, publisher, DOI). Results are merged only when the year and author overlap confirm it's the same paper.
- **Fuzzy matching** handles minor title variations, and author comparison is done by last-name set overlap to tolerate name ordering and formatting differences.

## Quick start

### Option 1: Use online (recommended)

Visit **[https://merfanian.github.io/GoogleScholarPaperChecker/](https://merfanian.github.io/GoogleScholarPaperChecker/)** -- no installation needed.

### Option 2: Docker

```bash
docker run -p 8080:8080 merfanian/bibtex-verifier
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 3: From source (Python backend)

The `main` branch contains a Python/FastAPI backend version with server-side processing.

**Requirements:** Python 3.10 or newer.

```bash
git clone https://github.com/merfanian/GoogleScholarPaperChecker.git
cd GoogleScholarPaperChecker
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m app.main
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

## Project structure

```
docs/                      Client-side app (served by GitHub Pages)
  index.html               Single-page web UI
  style.css                Dark-themed responsive CSS
  app.js                   All logic: parsing, API calls, comparison, download

app/                       Python backend version (main branch)
  main.py                  FastAPI server, SSE streaming, routes
  bib_parser.py            BibTeX parsing & writing, LaTeX stripping
  checker.py               Semantic Scholar + CrossRef API clients
  comparator.py            Field-level comparison, fuzzy matching
  static/                  Frontend for the backend version
```

## Limitations

- **Rate limits**: Both CrossRef and Semantic Scholar are free APIs with rate limits. For large `.bib` files (100+ entries), expect the process to take a few minutes. The app throttles requests automatically.
- **Coverage gaps**: Not every paper is indexed in CrossRef or Semantic Scholar. ArXiv preprints, workshop papers, and very recent publications may show as "Not Found".
- **Metadata quality**: API metadata isn't always perfect -- venue names may differ in format (e.g., "NeurIPS" vs "Neural Information Processing Systems"), and some CrossRef entries have incomplete data. The diff view lets you judge each change before accepting.

## Contributing

Contributions are welcome! Feel free to open issues or pull requests. Some ideas:

- Add support for additional APIs (OpenAlex, DBLP)
- Batch processing of multiple `.bib` files
- BibLaTeX-specific field handling
- Configurable thresholds via a UI settings panel

## License

This project is licensed under the [MIT License](LICENSE).
