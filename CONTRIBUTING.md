# Contributing to BibTeX Verifier

Thanks for helping out! Issues and pull requests are welcome — bug fixes, extra
metadata sources, BibLaTeX edge cases, and UX polish are all fair game.

## Project layout

| Path | Role |
|------|------|
| `docs/index.html` | Page markup; loads `lib.js`, `app.js`, and `fuzzball` from a CDN |
| `docs/lib.js` | **Pure logic** — parsing, normalization, fuzzy matching, field comparison, API-response converters. No DOM, no network. Runs in both the browser (`window.BibLib`) and Node. |
| `docs/app.js` | Everything with side effects — DOM rendering, network calls, rate limiting, UI state. |
| `docs/style.css` | Styles. |
| `tests/test_lib.js` | Node tests for `lib.js`. |
| `.github/workflows/` | CI (`ci.yml`) and GitHub Pages deploy (`deploy.yml`). |

The app is **100% client-side** — it is served as static files from `docs/`.
There is no build step: edit the files in `docs/` and open `docs/index.html`
in a browser (or run any static server from the repo root).

## Getting started

```bash
npm install     # installs the test-only fuzzball dependency
npm test        # runs tests/test_lib.js
```

`fuzzball` is the same fuzzy-matching library the browser loads from unpkg. The
tests load it so they exercise the **real** `token_sort_ratio`, not the crude
fallback baked into `lib.js` — keep it that way so test scores match production.

## Where code goes

- Anything **testable and side-effect-free** belongs in `lib.js`, with a matching
  test in `tests/test_lib.js`. This is the bar for logic changes: if it can be a
  pure function, it should be, and it should have a test.
- Anything touching the DOM or the network belongs in `app.js`.

### Adding a metadata source

1. Add a `<source>ToStandard(...)` converter in `lib.js` that maps the API's
   JSON into the standard record shape (`title`, `author`, `year`, `journal`,
   `volume`, `number`, `pages`, `doi`, `publisher`, `url`, `_source`). Export it
   and add a converter test.
2. In `app.js`, add a `search<Source>(title)` function and a rate-limit bucket
   in `rateBuckets`, then wire it into `lookupPaper`.
3. **Privacy rule:** send only the paper title. Do not attach emails,
   `mailto` parameters, or any part of the user's `.bib` — the promise is that
   only titles ever leave the machine.

See `openAlexToStandard` / `searchOpenAlex` for a worked example.

## Before you open a PR

- `npm test` passes.
- `node -c docs/lib.js && node -c docs/app.js` (CI runs these).
- New logic in `lib.js` has a test.
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
