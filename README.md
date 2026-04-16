# BibTeX Verifier

A local web app that verifies your `.bib` file entries against academic databases. Upload a bibliography, and it checks every entry's metadata (authors, year, venue, DOI, etc.) against [CrossRef](https://www.crossref.org/) and [Semantic Scholar](https://www.semanticscholar.org/) to catch errors and fill in missing fields.

![Python 3.10+](https://img.shields.io/badge/python-3.10%2B-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Why?

If you've ever manually compared dozens of BibTeX entries against Google Scholar to make sure the authors, year, and venue are correct, you know how tedious it is. This tool automates that process: it looks up each entry by title, compares the fields, and tells you exactly what's wrong -- or fixes it for you.

## Features

- **Drag-and-drop upload** of `.bib` files (standard BibTeX and BibLaTeX)
- **Real-time progress** via Server-Sent Events as entries are checked one by one
- **Three-tier categorization** of results:
  - **Verified** -- title and all metadata fields match the online record
  - **Auto-Updated** -- title matches but other details (authors, year, venue, DOI, etc.) differ; shows a field-by-field diff
  - **Needs Review** -- title didn't match closely enough, or no result was found
- **Accept / reject** suggested changes individually per entry
- **Download** the corrected `.bib` file with your decisions applied
- **Enrichment** -- fills in missing DOIs, publisher info, and other fields from API data
- **LaTeX-aware** -- strips `\textbf`, accents (`\'e`), braces, etc. before comparing

## How it works

```
Upload .bib  ──>  Parse entries  ──>  For each entry:
                                        1. Search Semantic Scholar /match (precise title lookup)
                                        2. Enrich with CrossRef (volume, pages, DOI)
                                        3. Fall back to CrossRef search / SS general search
                                      ──>  Compare fields  ──>  Categorize  ──>  Show results
```

- **Semantic Scholar's `/match` endpoint** is tried first -- it's designed for exact title lookup and returns the single best match.
- **CrossRef** provides richer metadata (volume, pages, publisher, DOI). Results are merged only when the year and author overlap confirm it's the same paper.
- **Fuzzy matching** (`rapidfuzz`) handles minor title variations, and author comparison is done by last-name set overlap to tolerate name ordering and formatting differences.

## Quick start

**Requirements:** Python 3.10 or newer.

```bash
# Clone the repo
git clone https://github.com/your-username/BibTeX-Verifier.git
cd BibTeX-Verifier

# Create a virtual environment and install dependencies
python -m venv venv
source venv/bin/activate   # on Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run the app
python -m app.main
```

Then open [http://localhost:8080](http://localhost:8080) in your browser.

## Project structure

```
app/
  main.py          FastAPI server, SSE streaming, upload/verify/download routes
  bib_parser.py    BibTeX parsing & writing, LaTeX stripping
  checker.py       Semantic Scholar + CrossRef API clients, smart result merging
  comparator.py    Field-level comparison, fuzzy matching, categorization
  static/
    index.html     Single-page web UI
    style.css      Dark-themed responsive CSS
    app.js         Upload handling, SSE progress, result rendering
requirements.txt
LICENSE
```

## API overview

| Endpoint | Method | Description |
|---|---|---|
| `/` | GET | Serves the web UI |
| `/api/upload` | POST | Accepts a `.bib` file, returns a session ID |
| `/api/verify/{session_id}` | GET | SSE stream of verification progress and results |
| `/api/accept/{session_id}` | POST | Submit accept/reject decisions per entry |
| `/api/download/{session_id}` | GET | Download the corrected `.bib` file |

## Configuration

The app runs with sensible defaults and requires no API keys. A few things you can tweak in the source:

| Setting | File | Default | Description |
|---|---|---|---|
| Port | `app/main.py` | `8080` | Server port |
| Title match threshold | `app/comparator.py` | `85%` | Minimum fuzzy similarity to consider a title "matched" |
| Concurrency limit | `app/checker.py` | `5` | Max concurrent API requests (be polite to free APIs) |
| Request timeout | `app/checker.py` | `15s` | Per-request timeout for API calls |

## Limitations

- **Rate limits**: Both CrossRef and Semantic Scholar are free APIs with rate limits. For large `.bib` files (100+ entries), expect the process to take a few minutes. The app throttles requests automatically.
- **Coverage gaps**: Not every paper is indexed in CrossRef or Semantic Scholar. ArXiv preprints, workshop papers, and very recent publications may show as "Not Found".
- **Metadata quality**: API metadata isn't always perfect -- venue names may differ in format (e.g., "NeurIPS" vs "Neural Information Processing Systems"), and some CrossRef entries have incomplete data. The diff view lets you judge each change before accepting.

## Contributing

Contributions are welcome! Feel free to open issues or pull requests. Some ideas:

- Add support for additional APIs (OpenAlex, DBLP)
- Batch processing of multiple `.bib` files
- Persistent storage (SQLite) for verification history
- BibLaTeX-specific field handling
- Configurable settings via a UI panel

## License

This project is licensed under the [MIT License](LICENSE).
