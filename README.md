<div align="center">

# BibTeX Verifier

**Stop fixing citations by hand.** Paste or upload your `.bib`, compare every entry against real publications, and leave with a bibliography you trust — including catching **AI-hallucinated** references before they ship.

[![Live app](https://img.shields.io/badge/Try_it_live-merfanian.github.io-5b8def?style=for-the-badge)](https://merfanian.github.io/Bibtex-Verifier/)
[![License: MIT](https://img.shields.io/badge/license-MIT-22c55e?style=flat-square)](LICENSE)
[![CI](https://github.com/merfanian/Bibtex-Verifier/actions/workflows/ci.yml/badge.svg)](https://github.com/merfanian/Bibtex-Verifier/actions)

<br/>

### See it in action

<a href="https://merfanian.github.io/Bibtex-Verifier/" title="Try BibTeX Verifier">
  <img src="demo/demo.gif" alt="Screen recording: upload or paste a BibTeX file, verify entries against CrossRef and Semantic Scholar, review diffs and live preview, then download the corrected bibliography" width="92%">
</a>

<p align="center">
  <sub><strong>Live verification</strong> · pill-style field diffs · GitHub-style BibTeX preview · one-click export</sub>
</p>

<br/>

</div>

Runs **100% in your browser** — no install, no server, no account. Only paper titles are sent to public APIs ([CrossRef](https://www.crossref.org/), [Semantic Scholar](https://www.semanticscholar.org/)); your `.bib` never leaves your machine.

---

## Why use this?

| Pain | What BibTeX Verifier does |
|------|---------------------------|
| ChatGPT invented three papers | Flags **no-match** / weak-match titles so you delete hallucinations |
| Google Scholar tab × 80 | **Batch lookup** with adaptive rate limiting |
| “Is this venue name right?” | **Side-by-side** your value vs. database suggestion, accept per field |
| Overleaf paste chaos | **Paste** directly or upload; **download** a clean `.bib` when done |

---

## Features

- **Drag-and-drop** or **paste** BibTeX from Overleaf
- **Dual-source** checks (Semantic Scholar + CrossRef)
- **Hallucination detection** — titles that don’t exist in major indexes
- **Pill-style diffs** — choose your text vs. suggested metadata per field
- **Live BibTeX preview** with diff highlighting; **copy** or **download** the final file
- **Max authors** truncation for long author lists (plus peer-reviewed venue preference, dedup, optional filters)
- **Dark / light** theme
- **Quick search shortcuts** on each card (Scholar, CrossRef, DBLP, …)

---

## How it works

```
Upload or paste .bib → Parse entries → For each entry:
    Semantic Scholar match → CrossRef enrich → Fallback search
→ Compare fields → Verified / Auto-updated / Needs review / Not found
→ You edit choices → Export corrected .bib
```

**Statuses:** **Verified** (matches online record) · **Auto-updated** (same paper, metadata differs) · **Needs review** (weak title match — possible typo or fake cite) · **Not found** (no index hit).

---

## Quick start

### Online (recommended)

**[https://merfanian.github.io/Bibtex-Verifier/](https://merfanian.github.io/Bibtex-Verifier/)**

### Local

```bash
git clone https://github.com/merfanian/Bibtex-Verifier.git
cd Bibtex-Verifier
npx serve docs
```

Open the URL shown (often `http://localhost:3000`).

---

## Project layout

| Path | Role |
|------|------|
| `docs/` | GitHub Pages app: `index.html`, `style.css`, `app.js`, `lib.js` |
| `tests/test_lib.js` | Node tests for `lib.js` |
| `.github/workflows/` | CI + Pages deploy |

---

## Limitations

- **API rate limits** — large files take a few minutes; the app throttles politely.
- **Not everything is indexed** — some workshops, theses, or brand-new papers won’t appear.
- **Metadata isn’t perfect** — you always get the final say in the diff UI.

---

## Contributing

Issues and PRs welcome — extra APIs (OpenAlex, …), BibLaTeX edge cases, UX polish, etc.

---

## License

[MIT](LICENSE)
