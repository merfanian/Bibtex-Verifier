# Contributing to BibTeX Verifier

Thanks for helping out! Issues and pull requests are welcome — bug fixes, extra
metadata sources, BibLaTeX edge cases, and UX polish are all fair game.

## Project layout

| Path | Role |
|------|------|
| `src/index.html` | Page markup; loads `fuzzball` from a CDN and `app/main.js` as an ES module |
| `src/style.css` | Styles. |
| `src/lib/` | **Pure logic** — no DOM, no network, runs unchanged in the browser and Node. `index.js` re-exports everything. |
| `src/lib/bibtex.js`, `latex.js` | Parsing / serializing `.bib`, LaTeX stripping |
| `src/lib/similarity.js`, `matching.js`, `compare.js` | Fuzzy matching, same-paper / preprint logic, field-by-field comparison |
| `src/lib/sources.js` | API-response converters to the standard record shape |
| `src/lib/results.js`, `export.js`, `diff.js` | Result objects, building the exported entries, preview line diff |
| `src/lib/notes.js`, `venues.js`, `search.js` | Note cleaning, venue abbreviations, entry search |
| `src/app/` | Everything with side effects. `main.js` wires the modules; `api.js` does rate-limited lookups; `verify.js` runs a verification; `cards.js`, `field-actions.js`, `authors.js`, `filters.js`, `preview.js`, `settings.js`, `input.js`, `onboarding.js` own their part of the UI; `state.js` holds shared run state. |
| `tests/*.test.js` | Node tests (`node:test`) for `src/lib` and `src/app/api.js`. |
| `.github/workflows/` | CI (`ci.yml`) and GitHub Pages deploy (`deploy.yml`, reuses CI). |

The app is **100% client-side** — it is served as static files from `src/`.
There is no build step: edit the files in `src/` and run `npm start` (or any
static server). ES modules don't load over `file://`, so use a server.

## Getting started

```bash
npm install     # installs the test-only fuzzball dependency
npm test        # runs tests/*.test.js with node:test
npm run check   # syntax-checks every module
npm start       # serves src/ locally
```

`fuzzball` is the same fuzzy-matching library the browser loads from unpkg. The
tests load it so they exercise the **real** `token_sort_ratio`. `lib/similarity.js`
has a fallback that mirrors it (used if the CDN script fails); a test keeps the
two in agreement. If you bump the fuzzball version, update both `package.json`
and the `<script>` tag in `src/index.html`, including its `integrity` hash.

## Where code goes

- Anything **testable and side-effect-free** belongs in `src/lib/`, with a
  matching test in `tests/`. This is the bar for logic changes: if it can be a
  pure function, it should be, and it should have a test.
- Anything touching the DOM or the network belongs in `src/app/`.

### Adding a metadata source

1. Add a `<source>ToStandard(...)` converter in `src/lib/sources.js` that maps
   the API's JSON into the standard record shape (`title`, `author`, `year`,
   `journal`, `volume`, `number`, `pages`, `doi`, `publisher`, `url`, `_source`).
   Add a converter test in `tests/sources.test.js`.
2. In `src/app/api.js`, add a `search<Source>(title)` function and a rate-limit
   bucket in `RATE_DEFAULTS`, then wire it into `lookupPaper` (and cover it in
   `tests/api.test.js`).
3. **Privacy rule:** send only the paper title. Do not attach emails,
   `mailto` parameters, or any part of the user's `.bib` — the promise is that
   only titles ever leave the machine.

See `openAlexToStandard` / `searchOpenAlex` for a worked example.

## Before you open a PR

- `npm test` and `npm run check` pass (CI runs both).
- New logic in `src/lib/` has a test.
- Commits use a single short imperative line describing what changed.

## Pull request flow

This is a fork-and-PR project. Fork the repo, branch per change, push to your
fork, and open the PR against `main`:

```bash
git checkout -b my-change
# ... edit, npm test ...
git push -u origin my-change
```

CI runs the tests on Node 18, 20, and 22 — please keep it green.
