"""Field comparison and categorization logic for BibTeX entries."""

from __future__ import annotations

import re
import unicodedata
from enum import Enum
from typing import Any

from rapidfuzz import fuzz

from app.bib_parser import normalize_title


class Status(str, Enum):
    VERIFIED = "verified"
    UPDATED = "updated"
    NEEDS_REVIEW = "needs_review"
    NOT_FOUND = "not_found"


TITLE_MATCH_THRESHOLD = 85
FIELD_MATCH_THRESHOLD = 75

COMPARED_FIELDS = ("author", "year", "journal", "booktitle", "volume", "number", "pages", "doi", "publisher")


def _normalize_text(text: str) -> str:
    """Lowercase, strip accents, collapse whitespace."""
    if not text:
        return ""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower().strip()
    text = re.sub(r"\s+", " ", text)
    return text


def _normalize_author_set(author_str: str) -> set[str]:
    """Parse an author string into a normalized set of last-name tokens."""
    if not author_str:
        return set()
    author_str = _normalize_text(author_str)
    authors = re.split(r"\s+and\s+", author_str)
    names = set()
    for a in authors:
        a = a.strip()
        if not a:
            continue
        # "Last, First" or "First Last" -> extract last name
        if "," in a:
            last = a.split(",")[0].strip()
        else:
            parts = a.split()
            last = parts[-1] if parts else a
        names.add(last)
    return names


def compare_titles(title_a: str, title_b: str) -> float:
    """Return similarity ratio (0-100) between two titles."""
    a = normalize_title(title_a)
    b = normalize_title(title_b)
    return fuzz.token_sort_ratio(a, b)


def compare_authors(authors_a: str, authors_b: str) -> float:
    """Compare two author strings by last-name overlap. Returns 0-100."""
    set_a = _normalize_author_set(authors_a)
    set_b = _normalize_author_set(authors_b)
    if not set_a and not set_b:
        return 100.0
    if not set_a or not set_b:
        return 0.0
    intersection = set_a & set_b
    union = set_a | set_b
    return (len(intersection) / len(union)) * 100


def _normalize_pages(pages: str) -> str:
    """Normalize page ranges: convert -- to -, strip spaces."""
    return re.sub(r"\s*-+\s*", "-", pages.strip())


def compare_field(field: str, val_a: str, val_b: str) -> float:
    """Compare a single field. Returns similarity 0-100."""
    a = _normalize_text(val_a)
    b = _normalize_text(val_b)

    if not a and not b:
        return 100.0
    if not a or not b:
        return 0.0

    if field == "year":
        return 100.0 if a == b else 0.0
    if field == "doi":
        return 100.0 if a.lower() == b.lower() else 0.0
    if field == "author":
        return compare_authors(val_a, val_b)
    if field == "pages":
        return 100.0 if _normalize_pages(a) == _normalize_pages(b) else fuzz.token_sort_ratio(a, b)

    return fuzz.token_sort_ratio(a, b)


def compare_entry(original: dict[str, Any], found: dict[str, Any]) -> dict[str, Any]:
    """Compare an original bib entry with API-found metadata.

    Returns a result dict with:
        status: Status enum value
        title_score: float
        field_diffs: list of {field, original, found, score}
        suggested: dict of fields to update (only if status is UPDATED)
    """
    orig_title = original.get("title", "")
    found_title = found.get("title", "")
    title_score = compare_titles(orig_title, found_title)

    if title_score < TITLE_MATCH_THRESHOLD:
        return {
            "status": Status.NEEDS_REVIEW,
            "title_score": title_score,
            "field_diffs": [],
            "suggested": found,
        }

    field_diffs: list[dict[str, Any]] = []
    has_difference = False

    # Map found 'journal' to either 'journal' or 'booktitle' depending on what the original uses
    found_journal = found.get("journal", "")
    if "booktitle" in original and "journal" not in original and found_journal:
        found["booktitle"] = found_journal

    enrichments: list[dict[str, Any]] = []

    for field in COMPARED_FIELDS:
        orig_val = original.get(field, "")
        found_val = found.get(field, "")

        if not orig_val and not found_val:
            continue

        # Original empty, API has value -> enrichment (optional addition, not a mismatch)
        if not orig_val.strip() and found_val.strip():
            enrichments.append({
                "field": field,
                "original": orig_val,
                "found": found_val,
                "score": 0.0,
            })
            continue

        # API empty, original has value -> skip (we trust the original)
        if orig_val.strip() and not found_val.strip():
            continue

        score = compare_field(field, orig_val, found_val)
        if score < 100.0:
            has_difference = True
            field_diffs.append({
                "field": field,
                "original": orig_val,
                "found": found_val,
                "score": round(score, 1),
            })

    # Show enrichments in the diff table too, but they don't force status to UPDATED
    all_diffs = field_diffs + enrichments

    status = Status.VERIFIED if not has_difference else Status.UPDATED
    suggested = {}
    if has_difference or enrichments:
        for diff in all_diffs:
            if diff["found"]:
                suggested[diff["field"]] = diff["found"]

    return {
        "status": status,
        "title_score": round(title_score, 1),
        "field_diffs": all_diffs,
        "suggested": suggested,
    }
