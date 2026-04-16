"""CrossRef and Semantic Scholar API lookup engine."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx
from rapidfuzz import fuzz

logger = logging.getLogger(__name__)

CROSSREF_API = "https://api.crossref.org/works"
SEMANTIC_SCHOLAR_SEARCH = "https://api.semanticscholar.org/graph/v1/paper/search"
SEMANTIC_SCHOLAR_MATCH = "https://api.semanticscholar.org/graph/v1/paper/search/match"

HEADERS = {
    "User-Agent": "BibTexVerifier/1.0 (https://github.com/example; mailto:bibcheck@example.com)",
}

_semaphore = asyncio.Semaphore(5)
_MIN_TITLE_SIM = 70

SS_FIELDS = "title,authors,year,venue,publicationVenue,externalIds"


def _title_similarity(a: str, b: str) -> float:
    return fuzz.token_sort_ratio(a.lower().strip(), b.lower().strip())


def _crossref_to_standard(item: dict[str, Any]) -> dict[str, Any]:
    authors_raw = item.get("author", [])
    authors = []
    for a in authors_raw:
        given = a.get("given", "")
        family = a.get("family", "")
        if family:
            authors.append(f"{family}, {given}".strip(", "))

    date_parts = item.get("published-print", item.get("published-online", {}))
    year = ""
    if date_parts and date_parts.get("date-parts"):
        parts = date_parts["date-parts"][0]
        if parts:
            year = str(parts[0])

    container = item.get("container-title", [])
    journal = container[0] if container else ""

    return {
        "title": (item.get("title") or [""])[0],
        "author": " and ".join(authors),
        "year": year,
        "journal": journal,
        "volume": item.get("volume", ""),
        "number": item.get("issue", ""),
        "pages": item.get("page", ""),
        "doi": item.get("DOI", ""),
        "publisher": item.get("publisher", ""),
        "url": item.get("URL", ""),
        "_source": "crossref",
    }


def _semantic_scholar_to_standard(paper: dict[str, Any]) -> dict[str, Any]:
    authors_raw = paper.get("authors", [])
    authors = []
    for a in authors_raw:
        name = a.get("name", "")
        if name:
            parts = name.rsplit(" ", 1)
            if len(parts) == 2:
                authors.append(f"{parts[1]}, {parts[0]}")
            else:
                authors.append(name)

    ext_ids = paper.get("externalIds") or {}
    pub_venue = paper.get("publicationVenue")
    venue = paper.get("venue", "")
    if pub_venue and isinstance(pub_venue, dict):
        venue = pub_venue.get("name", "") or venue

    return {
        "title": paper.get("title", ""),
        "author": " and ".join(authors),
        "year": str(paper.get("year") or ""),
        "journal": venue,
        "volume": "",
        "number": "",
        "pages": "",
        "doi": ext_ids.get("DOI", ""),
        "publisher": "",
        "url": f"https://doi.org/{ext_ids['DOI']}" if ext_ids.get("DOI") else "",
        "_source": "semantic_scholar",
    }


def _best_match(candidates: list[dict[str, Any]], query_title: str) -> dict[str, Any] | None:
    best, best_score = None, 0.0
    for c in candidates:
        score = _title_similarity(query_title, c.get("title", ""))
        if score > best_score:
            best_score = score
            best = c
    if best and best_score >= _MIN_TITLE_SIM:
        return best
    return None


async def _search_ss_match(title: str, client: httpx.AsyncClient) -> dict[str, Any] | None:
    """Use Semantic Scholar's /match endpoint for precise single-paper lookup."""
    async with _semaphore:
        try:
            resp = await client.get(
                SEMANTIC_SCHOLAR_MATCH,
                params={"query": title, "fields": SS_FIELDS},
                headers=HEADERS,
                timeout=15.0,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.warning("SS match request failed for %r: %s", title[:60], exc)
            return None

        data = resp.json()
        if not data or not data.get("data"):
            return None
        paper = data["data"][0] if isinstance(data["data"], list) else data["data"]
        return _semantic_scholar_to_standard(paper)


async def _search_ss_search(title: str, client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Use Semantic Scholar's general search endpoint."""
    async with _semaphore:
        try:
            resp = await client.get(
                SEMANTIC_SCHOLAR_SEARCH,
                params={"query": title, "limit": 5, "fields": SS_FIELDS},
                headers=HEADERS,
                timeout=15.0,
            )
            resp.raise_for_status()
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.warning("SS search request failed for %r: %s", title[:60], exc)
            return []

        papers = resp.json().get("data", [])
        return [_semantic_scholar_to_standard(p) for p in papers]


async def _search_crossref(title: str, client: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Search CrossRef for a paper by title."""
    async with _semaphore:
        try:
            resp = await client.get(
                CROSSREF_API,
                params={
                    "query.title": title,
                    "rows": 5,
                    "select": "title,author,published-print,published-online,"
                              "container-title,volume,issue,page,DOI,publisher,URL,type",
                },
                headers=HEADERS,
                timeout=15.0,
            )
            resp.raise_for_status()
        except (httpx.HTTPError, httpx.TimeoutException) as exc:
            logger.warning("CrossRef request failed for %r: %s", title[:60], exc)
            return []

        items = resp.json().get("message", {}).get("items", [])
        return [_crossref_to_standard(item) for item in items]


async def lookup_paper(title: str, client: httpx.AsyncClient) -> dict[str, Any] | None:
    """Look up a paper by title.

    Strategy:
    1. Try Semantic Scholar /match (best for exact title lookup)
    2. Enrich with CrossRef if it returns the *same* paper (year must match)
    3. Fall back to CrossRef search alone
    4. Fall back to Semantic Scholar general search
    """
    ss_match = await _search_ss_match(title, client)
    if ss_match and _title_similarity(title, ss_match.get("title", "")) >= _MIN_TITLE_SIM:
        cr_candidates = await _search_crossref(title, client)
        cr_match = _best_match(cr_candidates, title)
        if cr_match and _is_same_paper(ss_match, cr_match):
            return _merge_metadata(ss_match, cr_match)
        return ss_match

    cr_candidates = await _search_crossref(title, client)
    cr_match = _best_match(cr_candidates, title)
    if cr_match:
        return cr_match

    ss_candidates = await _search_ss_search(title, client)
    return _best_match(ss_candidates, title)


def _is_same_paper(a: dict[str, Any], b: dict[str, Any]) -> bool:
    """Check whether two metadata dicts likely describe the same paper."""
    if _title_similarity(a.get("title", ""), b.get("title", "")) < 85:
        return False
    ya, yb = a.get("year", ""), b.get("year", "")
    if ya and yb and ya != yb:
        return False
    # Check author last-name overlap to guard against different papers with the same title
    a_authors = _extract_last_names(a.get("author", ""))
    b_authors = _extract_last_names(b.get("author", ""))
    if a_authors and b_authors:
        overlap = len(a_authors & b_authors) / max(len(a_authors), len(b_authors))
        if overlap < 0.3:
            return False
    return True


def _extract_last_names(author_str: str) -> set[str]:
    """Extract a set of lowercased last names from a BibTeX author string."""
    if not author_str:
        return set()
    names = set()
    for part in re.split(r"\s+and\s+", author_str):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            last = part.split(",")[0].strip()
        else:
            tokens = part.split()
            last = tokens[-1] if tokens else part
        names.add(last.lower())
    return names


def _merge_metadata(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    """Merge two metadata dicts, preferring *primary* but filling blank fields from secondary."""
    merged = dict(primary)
    for key, val in secondary.items():
        if key.startswith("_"):
            continue
        if not merged.get(key) and val:
            merged[key] = val
    merged["_source"] = f"{primary.get('_source', '')}+{secondary.get('_source', '')}"
    return merged
