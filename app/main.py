"""FastAPI application: routes, SSE streaming, and session management."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.responses import StreamingResponse

from app.bib_parser import entries_to_bib, parse_bib, strip_latex
from app.checker import lookup_paper
from app.comparator import Status, compare_entry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="BibTeX Verifier")

STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# In-memory session store: session_id -> session data
sessions: dict[str, dict[str, Any]] = {}


@app.get("/", response_class=HTMLResponse)
async def index():
    return (STATIC_DIR / "index.html").read_text()


@app.post("/api/upload")
async def upload_bib(file: UploadFile = File(...)):
    content = (await file.read()).decode("utf-8", errors="replace")
    try:
        entries = parse_bib(content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse .bib file: {exc}")

    if not entries:
        raise HTTPException(status_code=400, detail="No entries found in the .bib file.")

    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "original_entries": entries,
        "results": [],
        "decisions": {},
        "done": False,
    }

    return {"session_id": session_id, "entry_count": len(entries)}


@app.get("/api/verify/{session_id}")
async def verify_entries(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    entries = session["original_entries"]

    async def event_stream():
        async with httpx.AsyncClient() as client:
            for i, entry in enumerate(entries):
                title = entry.get("title", "")
                entry_id = entry.get("ID", f"entry_{i}")

                yield _sse_event("progress", {
                    "current": i + 1,
                    "total": len(entries),
                    "entry_id": entry_id,
                    "title": title[:80],
                })

                if not title.strip():
                    result = _build_result(entry, i, Status.NOT_FOUND, 0, [], {}, None)
                    session["results"].append(result)
                    yield _sse_event("entry_result", result)
                    continue

                clean_title = strip_latex(title)
                found = await lookup_paper(clean_title, client)

                if not found:
                    result = _build_result(entry, i, Status.NOT_FOUND, 0, [], {}, None)
                    session["results"].append(result)
                    yield _sse_event("entry_result", result)
                    continue

                comparison = compare_entry(entry, found)
                result = _build_result(
                    entry, i,
                    comparison["status"],
                    comparison["title_score"],
                    comparison["field_diffs"],
                    comparison["suggested"],
                    found,
                )
                session["results"].append(result)
                yield _sse_event("entry_result", result)

                # Small delay to avoid hammering APIs
                await asyncio.sleep(0.3)

        session["done"] = True
        yield _sse_event("done", {"total": len(entries)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/accept/{session_id}")
async def accept_changes(session_id: str, decisions: dict[str, Any]):
    """Accept or reject suggested changes.

    Body: { "decisions": { "0": "accept", "2": "reject", ... } }
    Keys are entry indices (as strings), values are "accept" or "reject".
    """
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session["decisions"].update(decisions.get("decisions", decisions))
    return {"status": "ok"}


@app.get("/api/download/{session_id}")
async def download_bib(session_id: str):
    session = sessions.get(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    entries = session["original_entries"]
    results = session["results"]
    decisions = session["decisions"]

    final_entries = []
    for i, entry in enumerate(entries):
        idx_str = str(i)
        if i < len(results):
            result = results[i]
            status = result["status"]
            decision = decisions.get(idx_str, "accept" if status == Status.VERIFIED else None)

            if status in (Status.UPDATED, Status.NEEDS_REVIEW) and decision == "accept" and result.get("suggested"):
                updated = dict(entry)
                for field, value in result["suggested"].items():
                    if value:
                        updated[field] = value
                final_entries.append(updated)
            else:
                final_entries.append(entry)
        else:
            final_entries.append(entry)

    bib_content = entries_to_bib(final_entries)

    return Response(
        content=bib_content,
        media_type="application/x-bibtex",
        headers={"Content-Disposition": "attachment; filename=verified_refs.bib"},
    )


def _build_result(
    entry: dict[str, Any],
    index: int,
    status: Status,
    title_score: float,
    field_diffs: list[dict[str, Any]],
    suggested: dict[str, Any],
    found: dict[str, Any] | None,
) -> dict[str, Any]:
    return {
        "index": index,
        "entry_id": entry.get("ID", ""),
        "entry_type": entry.get("ENTRYTYPE", ""),
        "title": entry.get("title", ""),
        "status": status.value if isinstance(status, Status) else status,
        "title_score": title_score,
        "field_diffs": field_diffs,
        "suggested": suggested,
        "found_title": found.get("title", "") if found else "",
        "original": {k: v for k, v in entry.items() if not k.startswith("_") and k not in ("ID", "ENTRYTYPE")},
    }


def _sse_event(event_type: str, data: Any) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8080, reload=True)
