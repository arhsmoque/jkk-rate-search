# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pymupdf",
# ]
# ///
"""
build-specs-database
━━━━━━━━━━━━━━━━━━━
Extract SYABAS and SPAN specification clauses and tables from PDFs into a
unified SQLite database with FTS5 full-text search.

Usage:
    uv run --script build-specs-database.py --output DB_PATH
"""

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF


def make_envelope(status, component, summary, data=None, steps=None, warnings=None, errors=None):
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    trace = f"{component}_{ts}_{id(summary):08x}"
    return {
        "status": status,
        "component": component,
        "trace_id": trace,
        "schema_version": "build-specs-database@0.1.0",
        "summary": summary,
        "data": data or {},
        "steps": steps or [],
        "warnings": warnings or [],
        "errors": errors or [],
    }


def emit(envelope):
    print(json.dumps(envelope, ensure_ascii=False))


# ── noise / header detection ──────────────────────────────────────────────────

def detect_repeated_lines(doc: fitz.Document, min_freq_ratio: float = 0.5) -> set[str]:
    line_counts = Counter()
    total_pages = len(doc)
    for page in doc:
        text = page.get_text()
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        unique_lines = set(lines)
        for line in unique_lines:
            line_counts[line] += 1

    threshold = max(3, int(total_pages * min_freq_ratio))
    repeated = {line for line, count in line_counts.items()
                if count >= threshold and 5 <= len(line) <= 120}
    return repeated


def is_toc_page(lines: list[str]) -> bool:
    """Detect TOC pages: clause-number + title + page-ref pattern repeated."""
    count = 0
    for i in range(len(lines) - 2):
        if not re.match(r"^\s*(\d+\.\d+|\d+\.\d+\.\d+|[A-Z]\.\d+|[A-Z]\.\d+\.\d+)\s*$", lines[i]):
            continue
        if re.match(r"^\s*(\d+\.\d+|\d+\.\d+\.\d+|[A-Z]\.\d+|[A-Z]\.\d+\.\d+)\s*$", lines[i + 1]):
            continue
        third = lines[i + 2].strip()
        if re.match(r"^[A-Z]\.\d+$", third) or (third.isdigit() and len(third) <= 3):
            count += 1
    return count >= 4


# ── per-document configurations ────────────────────────────────────────────────

DOC_CONFIGS = {
    "syabas": {
        "source_file": "2007 (1st. Ed.) SYABAS' Standard Specs For Pipe Laying Works.pdf",
        "doc_type": "syabas",
        "edition_year": 2007,
        "section_pattern": re.compile(r"SECTION\s+([A-Z])\s*:\s*(.+)", re.I),
        "clause_pattern": re.compile(r"^\s*(\d+\.\d+(?:\.\d+)*)\s+(.+)"),
        "table_pattern": re.compile(r"^\s*(?:Table|TABLE)\s+([A-Z]?\d+\.?\d*)\s*[-:–]\s*(.+)", re.I),
        "part_pattern": None,
        "noise_patterns": [
            re.compile(r"SYABAS[’']?\s*STANDARD\s*SPECIFICATION", re.I),
            re.compile(r"First\s+Edition\s*:\s*May\s*2007", re.I),
            re.compile(r"^\s*S\s*Y\s*A\s*B\s*A\s*S\s*$"),
            re.compile(r"^\s*Prepared\s+by\s*[:\-]?\s*$", re.I),
            re.compile(r"^\s*Planning\s+and\s+Design\s+Division\s*$", re.I),
            re.compile(r"^\s*393257-T\s*$"),
            re.compile(r"^\s*Standard\s+Specification\s+for\s+Pipe\s+Laying\s+Works\s*$", re.I),
            re.compile(r"^[A-Z]\.\d+$"),  # page refs like A.1, C.16, D.5
        ],
    },
    "span": {
        "source_file": "00 SPAN Unform Technical Guidelines (UTG).pdf",
        "doc_type": "span",
        "edition_year": 2018,
        "section_pattern": None,
        "clause_pattern": re.compile(r"^\s*([A-Z]\.\d+(?:\.\d+)*)\s+(.+)"),
        "table_pattern": re.compile(r"^\s*(?:Table|TABLE)\s+([A-Z]\.\d+)\s*[-:–]\s*(.+)", re.I),
        "part_pattern": re.compile(r"Part\s+([A-Z])\s*:\s*(.+)", re.I),
        "noise_patterns": [
            re.compile(r"Uniform\s+Technical\s+Guidelines", re.I),
            re.compile(r"^\s*\(?[ivxlcIVXLC]+\)?\s*$"),
            re.compile(r"©\s*Copyright", re.I),
            re.compile(r"Suruhanjaya\s+Perkhidmatan\s+Air\s+Negara", re.I),
            re.compile(r"^\s*ISBN\s+\d", re.I),
            re.compile(r"^\s*Publish\s+by\s*[:\-]?\s*$", re.I),
            re.compile(r"^\s*All\s+right\s+reserved", re.I),
            re.compile(r"^\s*No\s+part\s+of\s+this\s+publication", re.I),
            re.compile(r"^\s*Prima\s+Avenue", re.I),
            re.compile(r"^\s*Jalan\s+Teknokrat", re.I),
            re.compile(r"^\s*Cyberjaya", re.I),
            re.compile(r"^\s*Selangor", re.I),
            re.compile(r"^\s*Malaysia", re.I),
            re.compile(r"^\s*\d+\s*$"),  # standalone page numbers
        ],
    },
}


def clean_line(line: str, noise_patterns: list[re.Pattern]) -> str | None:
    stripped = line.strip()
    if not stripped:
        return None
    for pat in noise_patterns:
        if pat.match(stripped):
            return None
    return stripped


def preprocess_multiline_clauses(lines: list[str]) -> list[str]:
    """Merge clause-number lines with their title lines."""
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        m = re.match(r"^\s*(\d+\.\d+(?:\.\d+)*|[A-Z]\.\d+(?:\.\d+)*)\s*$", line)
        if m and i + 1 < len(lines):
            next_line = lines[i + 1]
            if not re.match(r"^\s*(\d+\.\d+(?:\.\d+)*|[A-Z]\.\d+(?:\.\d+)*)\s*$", next_line):
                if not re.match(r"^[A-Z]\.\d+$", next_line.strip()):
                    result.append(f"{line.strip()} {next_line.strip()}")
                    i += 2
                    continue
        result.append(line)
        i += 1
    return result


def extract_document(doc: fitz.Document, cfg: dict) -> tuple[list[dict], list[str]]:
    warnings = []
    repeated = detect_repeated_lines(doc)

    # Build noise patterns including repeated lines
    cfg_noise = cfg["noise_patterns"].copy()
    for rep in repeated:
        if len(rep) > 5:
            cfg_noise.append(re.compile(re.escape(rep)))

    # Gather all lines from non-TOC pages
    all_lines: list[tuple[int, str]] = []
    for page_idx, page in enumerate(doc):
        page_num = page_idx + 1
        text = page.get_text()
        if not text or not text.strip():
            continue

        raw_lines = [l.strip() for l in text.splitlines() if l.strip()]

        # Detect TOC on minimally-cleaned lines (only remove repeated headers)
        minimal_cleaned = [l for l in raw_lines if l not in repeated]
        if is_toc_page(minimal_cleaned):
            continue

        # Full clean for content pages
        cleaned = [cl for cl in (clean_line(l, cfg_noise) for l in raw_lines) if cl is not None]
        cleaned = preprocess_multiline_clauses(cleaned)

        for cl in cleaned:
            all_lines.append((page_num, cl))

    # Find boundaries
    section = ""
    boundaries = []
    for idx, (page_num, line) in enumerate(all_lines):
        if cfg["section_pattern"]:
            m = cfg["section_pattern"].search(line)
            if m:
                section = f"SECTION {m.group(1)} - {m.group(2)}".strip()
                continue
        if cfg["part_pattern"]:
            m = cfg["part_pattern"].search(line)
            if m:
                section = f"Part {m.group(1)}: {m.group(2)}".strip()
                continue

        m = cfg["clause_pattern"].match(line)
        if m:
            item_no = re.sub(r"\s+", "", m.group(1))
            boundaries.append((idx, "clause", item_no, m.group(2).strip(), section))
            continue

        m = cfg["table_pattern"].match(line)
        if m:
            boundaries.append((idx, "table", m.group(1), m.group(2).strip(), section))
            continue

    if not boundaries:
        warnings.append("No clauses or tables found in document")
        return [], warnings

    items = []
    for i, (idx, typ, item_no, title, sec) in enumerate(boundaries):
        start_idx = idx
        end_idx = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(all_lines)
        chunk_lines = all_lines[start_idx:end_idx]

        page_nums = [ln[0] for ln in chunk_lines]
        first_page = page_nums[0]
        last_page = page_nums[-1]

        body_lines = chunk_lines[1:] if len(chunk_lines) > 1 else []
        full_text = "\n".join(ln[1] for ln in chunk_lines)
        body_text = "\n".join(ln[1] for ln in body_lines)

        items.append({
            "doc_type": cfg["doc_type"],
            "edition_year": cfg["edition_year"],
            "source_file": cfg["source_file"],
            "source_page": first_page,
            "source_page_end": last_page,
            "item_no": item_no,
            "item_type": typ,
            "section": sec,
            "description": title,
            "remarks": body_text,
            "full_text": full_text,
        })

    # Post-clean
    for it in items:
        it["description"] = re.sub(r"\s+", " ", it["description"]).strip()
        it["remarks"] = re.sub(r"\n{3,}", "\n\n", it["remarks"]).strip()
        it["full_text"] = re.sub(r"\n{3,}", "\n\n", it["full_text"]).strip()
        it["description"] = re.sub(r"[^\w\s\-.,;:()/&'\"]", "", it["description"]).strip()
        it["remarks"] = re.sub(r"[^\w\s\-.,;:()/&'\"]", "", it["remarks"]).strip()

    return items, warnings


def write_database(all_items: list[dict], db_path: Path) -> dict:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    if db_path.exists():
        db_path.unlink()

    con = sqlite3.connect(str(db_path))
    con.execute("PRAGMA foreign_keys = ON")

    con.execute("""
        CREATE TABLE spec_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_type TEXT NOT NULL,
            edition_year INTEGER NOT NULL,
            source_file TEXT NOT NULL,
            source_page INTEGER,
            item_no TEXT,
            section TEXT,
            description TEXT NOT NULL,
            unit TEXT,
            remarks TEXT
        )
    """)

    con.execute("""
        CREATE TABLE spec_details (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL REFERENCES spec_items(id) ON DELETE CASCADE,
            variant_label TEXT NOT NULL,
            variant_type TEXT,
            rate_rm REAL
        )
    """)

    item_insert = """
        INSERT INTO spec_items (doc_type, edition_year, source_file, source_page, item_no, section, description, unit, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    for item in all_items:
        con.execute(item_insert, (
            item["doc_type"],
            item["edition_year"],
            item["source_file"],
            item.get("source_page", 0),
            item.get("item_no", ""),
            item.get("section", ""),
            item["description"],
            item.get("unit", ""),
            item.get("remarks", ""),
        ))

    # FTS5
    con.execute("""
        CREATE VIRTUAL TABLE spec_items_fts USING fts5(
            item_no,
            description,
            unit,
            section,
            content='spec_items',
            content_rowid='id',
            prefix='2 3 4'
        )
    """)
    con.execute("INSERT INTO spec_items_fts(spec_items_fts) VALUES('rebuild')")
    con.commit()

    item_count = con.execute("SELECT COUNT(*) FROM spec_items").fetchone()[0]
    con.close()

    return {
        "db_path": str(db_path),
        "item_count": item_count,
    }


def main():
    parser = argparse.ArgumentParser(description="Build Air Selangor specs SQLite database from PDFs")
    parser.add_argument("--output", required=True, help="Output SQLite DB path")
    parser.add_argument("--pdf-dir", default=r"C:\Users\smoqu\Downloads", help="Directory containing PDFs")
    parser.add_argument("--dry-run", action="store_true", help="Preview without writing DB")
    args = parser.parse_args()

    pdf_dir = Path(args.pdf_dir)
    all_items = []
    all_warnings = []
    steps = []

    for key, cfg in DOC_CONFIGS.items():
        pdf_path = pdf_dir / cfg["source_file"]
        if not pdf_path.exists():
            all_warnings.append(f"PDF not found: {pdf_path}")
            steps.append({
                "name": f"extract_{key}",
                "status": "warning",
                "count": 0,
                "warning": "file_not_found",
            })
            continue

        doc = fitz.open(str(pdf_path))
        items, warns = extract_document(doc, cfg)
        doc.close()
        all_items.extend(items)
        all_warnings.extend(warns)
        steps.append({
            "name": f"extract_{key}",
            "primitive": "pdf.extract_text",
            "status": "success" if items else "warning",
            "count": len(items),
            "warnings": len(warns),
        })

    if not all_items:
        emit(make_envelope("failure", "build_specs_database", "No items extracted from any PDF",
                           warnings=all_warnings,
                           errors=[{"code": "zero_extraction", "message": "All PDFs yielded zero items"}]))
        sys.exit(1)

    if args.dry_run:
        sample = []
        for it in all_items[:30]:
            sample.append({
                "doc": it["doc_type"],
                "item_no": it["item_no"],
                "section": it["section"],
                "description": it["description"][:80],
                "page": it["source_page"],
                "rem_len": len(it["remarks"]),
            })
        emit(make_envelope("blocked", "build_specs_database",
                           f"Would create database with {len(all_items)} items",
                           data={"items": len(all_items), "dry_run": True, "sample": sample},
                           steps=steps, warnings=all_warnings))
        sys.exit(0)

    db_stats = write_database(all_items, Path(args.output))

    emit(make_envelope("success", "build_specs_database",
                       f"Database created: {db_stats['item_count']} items",
                       data=db_stats, steps=steps, warnings=all_warnings))
    sys.exit(0)


if __name__ == "__main__":
    main()
