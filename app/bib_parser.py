"""BibTeX parsing and writing utilities."""

from __future__ import annotations

import re
from typing import Any

import bibtexparser
from bibtexparser.bparser import BibTexParser
from bibtexparser.bwriter import BibTexWriter


LATEX_ACCENT_MAP = {
    r"\'a": "á", r"\'e": "é", r"\'i": "í", r"\'o": "ó", r"\'u": "ú",
    r"\`a": "à", r"\`e": "è", r"\`i": "ì", r"\`o": "ò", r"\`u": "ù",
    r'\"a': "ä", r'\"e': "ë", r'\"i': "ï", r'\"o': "ö", r'\"u': "ü",
    r"\~n": "ñ", r"\~a": "ã", r"\~o": "õ",
    r"\^a": "â", r"\^e": "ê", r"\^i": "î", r"\^o": "ô", r"\^u": "û",
    r"\c{c}": "ç", r"\c c": "ç",
    r"{\ss}": "ß",
}


def strip_latex(text: str) -> str:
    """Remove LaTeX markup from a string for comparison purposes."""
    if not text:
        return ""
    for latex, char in LATEX_ACCENT_MAP.items():
        text = text.replace(latex, char)
    text = re.sub(r"\\[a-zA-Z]+\s*", "", text)
    text = text.replace("{", "").replace("}", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_title(title: str) -> str:
    """Normalize a title for comparison: strip LaTeX, lowercase, collapse whitespace."""
    return strip_latex(title).lower().strip()


def parse_bib(content: str) -> list[dict[str, Any]]:
    """Parse a .bib file string into a list of entry dicts.

    Each dict has at minimum 'ID', 'ENTRYTYPE', and whatever fields the entry
    contains (title, author, year, etc.).  We also add an '_original_key' that
    preserves the citation key.
    """
    parser = BibTexParser(common_strings=True)
    parser.ignore_nonstandard_types = False
    parser.homogenize_fields = True

    bib_db = bibtexparser.loads(content, parser=parser)

    entries: list[dict[str, Any]] = []
    for entry in bib_db.entries:
        entry["_original_key"] = entry.get("ID", "")
        entries.append(entry)
    return entries


def entries_to_bib(entries: list[dict[str, Any]]) -> str:
    """Convert a list of entry dicts back to a .bib format string."""
    db = bibtexparser.bibdatabase.BibDatabase()

    clean_entries = []
    for entry in entries:
        clean = {k: v for k, v in entry.items() if not k.startswith("_")}
        clean_entries.append(clean)

    db.entries = clean_entries

    writer = BibTexWriter()
    writer.indent = "  "
    writer.comma_first = False

    return writer.write(db)
