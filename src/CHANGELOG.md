# Changelog

What changed for people using BibTeX Verifier, newest first.

## 2026-11-13

### Changed
- The site has an icon in the browser tab and on phone home screens, and a preview image when its link is shared.
- **A new look for the start page:** a headline with an example of a corrected and a made-up entry, clearer "How it works" and feature sections, and a fuller footer.
- The **Star on GitHub** button shows the project's star count.
- The header buttons are now the same height.

## 2026-11-12

### Added
- **Settings, About and What's new** behind the gear button at the top of the page.
- **Optional Semantic Scholar API key.** With your own free key, lookups no longer wait on the shared anonymous limit. The key is stored only in your browser and sent only to Semantic Scholar.
- **Retraction warnings.** Matched papers are checked against Retraction Watch data (via CrossRef).
- **Checks on the file itself:** one citation key used for different papers, missing author or year, malformed DOIs, fields that can't be read. Find them under the **Issues** filter.
- **"Can't Check" status** for web pages, theses, reports and software, kept apart from Not Found.
- **Keyboard review:** click an entry, then use the arrow keys (or `j` / `k`), `a` to accept all, `o` to keep the original.
- **Saved progress.** A reload or a closed tab no longer loses a run or your choices.

### Changed
- **Much faster verification:** about 2 seconds per entry instead of 10 or more. Papers are found on CrossRef first, and Semantic Scholar is asked about many of them in one request.
- An entry's DOI or arXiv ID is used to find the paper before its title.

### Fixed
- `month = may`, `@string` macros and field names with hyphens (`date-added`) no longer make the rest of an entry disappear from the download.
- Long reason labels no longer overlap the "Your value" box.

## 2026-11-11

### Fixed
- A re-upload of a famous paper to a repository could replace the paper's real DOI and publisher.
- Conference papers were offered a `journal` field they don't need.

## 2026-11-10

### Added
- **"To check" view:** results open on the entries that need a decision; the rest are one line.
- **Triage of differences:** formatting-only changes are applied for you (optional), and only real conflicts ask for review.
- **Conference names from dblp,** so "NeurIPS" and "Advances in Neural Information Processing Systems" count as the same venue, and different venues never do.

Earlier changes are in the [commit history](https://github.com/merfanian/Bibtex-Verifier/commits/main).
