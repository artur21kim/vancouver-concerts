#!/usr/bin/env python3
"""
Grooveprint — Show Refresh Script
scripts/refresh_shows.py

Parses a raw Octoparse setlist.fm export and ingests new shows into Supabase.
Uses setlist_url as the deduplication key — existing shows are never overwritten.

Supported input formats:  .csv  .tsv  .xlsx  (raw Octoparse export)

Usage:
    pip install requests python-dotenv openpyxl

    # Preview without writing anything:
    python scripts/refresh_shows.py --input exports/raw_2026.csv --dry-run

    # Apply changes:
    python scripts/refresh_shows.py --input exports/raw_2026.csv

    # Different city (future expansion):
    python scripts/refresh_shows.py --input exports/seattle_2026.csv --city Seattle

Required environment variables (.env or shell):
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key

Optional:
    REFRESH_CITY=Vancouver   # default city applied to new venue records

Expected Octoparse column names:
    Field1    Full show title, e.g. "Rush at Rogers Arena, Vancouver, BC, Canada"
    Field     setlist.fm URL  ← deduplication key
    month     e.g. "DEC"
    day       e.g. "17"
    Year      e.g. "2026"
    details   Artist name, e.g. "Rush"
    details2  Block containing "Tour:" or "Venue:" label
    details4  Tour name (when Tour:) OR full venue string (when Venue:)
    details6  Full venue string (when Tour:), empty (when Venue:)
"""

import argparse
import csv
import io
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
DEFAULT_CITY = os.getenv("REFRESH_CITY", "Vancouver")

BATCH_SIZE = 500   # rows per Supabase REST call

MONTH_MAP = {
    "JAN": 1, "FEB": 2, "MAR": 3, "APR": 4,  "MAY": 5,  "JUN": 6,
    "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12,
}

_BASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------

def _headers(prefer: str = "return=minimal") -> dict:
    return {**_BASE_HEADERS, "Prefer": prefer}


def sb_get_page(table: str, params: dict) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.get(url, headers=_headers(), params=params)
    resp.raise_for_status()
    return resp.json()


def sb_get_all(table: str, params: dict, page_size: int = 1000) -> list:
    """Paginate through all rows — fact_shows has 36k+ so a single request isn't enough."""
    all_rows: list = []
    offset = 0
    while True:
        batch = sb_get_page(table, {**params, "limit": page_size, "offset": offset})
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return all_rows


def sb_insert(table: str, records: list, *, return_rows: bool = False) -> list:
    """
    Batch INSERT with ON CONFLICT DO NOTHING (idempotent on unique keys).
    Returns inserted rows when return_rows=True (needed for new-artist/venue IDs).
    """
    if not records:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    prefer = (
        "return=representation,resolution=ignore-duplicates"
        if return_rows
        else "return=minimal,resolution=ignore-duplicates"
    )
    resp = requests.post(url, headers=_headers(prefer), json=records)
    resp.raise_for_status()
    if not return_rows:
        return []
    result = resp.json()
    return result if isinstance(result, list) else ([result] if result else [])


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_date(month_str: str, day_str: str, year_str: str) -> Optional[str]:
    """'DEC', '17', '2026' → '2026-12-17'. Returns None on any failure."""
    try:
        m = MONTH_MAP.get((month_str or "").strip().upper())
        d = int((day_str  or "").strip())
        y = int((year_str or "").strip())
        if not m or not (1 <= d <= 31) or y < 1900:
            return None
        return f"{y:04d}-{m:02d}-{d:02d}"
    except (ValueError, TypeError):
        return None


def extract_venue_name(venue_full: str) -> str:
    """
    Strip city/province/country suffix from a setlist.fm venue string.

    'Rogers Arena, Vancouver, BC, Canada'         → 'Rogers Arena'
    'Hollywood Theatre, Vancouver, BC, Canada'    → 'Hollywood Theatre'
    'The Pearl, Vancouver, BC, Canada'            → 'The Pearl'
    'Vancouver Convention Centre, East, Van, …'  → 'Vancouver Convention Centre, East'

    Strategy: split on ', ' and drop the last 3 parts (city, state, country).
    """
    venue_full = (venue_full or "").strip()
    if not venue_full:
        return ""
    parts = [p.strip() for p in venue_full.split(", ")]
    if len(parts) > 3:
        return ", ".join(parts[:-3])
    if len(parts) >= 2:
        return parts[0]
    return venue_full


def parse_row(row: dict, city: str = DEFAULT_CITY) -> Optional[dict]:
    """
    Parse one Octoparse row dict → normalised show dict.
    Returns None if the row is invalid or unparseable.

    details2 has two patterns depending on whether setlist.fm recorded a tour:
      "Tour: <name>" → details4 = tour name, details6 = full venue string
      "Venue: <str>" → details4 = full venue string, details6 = empty
    """
    setlist_url = (row.get("Field") or "").strip()
    if not setlist_url or "setlist.fm" not in setlist_url:
        return None

    date = parse_date(
        row.get("month", ""), row.get("day", ""), row.get("Year", "")
    )
    if not date:
        return None

    artist_name = (row.get("details") or "").strip()
    if not artist_name:
        return None

    details2 = row.get("details2") or ""
    details4 = (row.get("details4") or "").strip()
    details6 = (row.get("details6") or "").strip()

    if "Venue:" in details2:
        # Support act / no tour — details4 contains the full venue string
        venue_full = details4
        tour_name  = None
    else:
        # Tour present — details4 is the tour name, details6 is the venue
        venue_full = details6 or details4   # fallback if details6 missing
        tour_name  = details4 if "Tour:" in details2 else None

    venue_name = extract_venue_name(venue_full)
    if not venue_name:
        return None

    return {
        "setlist_url": setlist_url,
        "date":        date,
        "artist_name": artist_name,
        "venue_name":  venue_name,
        "tour_name":   tour_name,     # informational only — not stored in fact_shows
        "show_type":   "music",
        "city":        city,
    }


# ---------------------------------------------------------------------------
# File loading
# ---------------------------------------------------------------------------

def load_file(path: str) -> list[dict]:
    """Load .csv, .tsv, or .xlsx and return a list of row dicts."""
    p = Path(path)
    if not p.exists():
        print(f"ERROR: File not found: {path}")
        sys.exit(1)

    if p.suffix.lower() in (".xlsx", ".xls"):
        try:
            import openpyxl
        except ImportError:
            print("ERROR: openpyxl required for Excel input. Run: pip install openpyxl")
            sys.exit(1)
        wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            return []
        headers = [
            str(h).strip() if h is not None else f"col_{i}"
            for i, h in enumerate(rows[0])
        ]
        return [
            {headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(r) if i < len(headers)}
            for r in rows[1:]
        ]

    # CSV / TSV — detect encoding then delimiter
    content: Optional[str] = None
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            content = p.read_text(encoding=enc)
            break
        except UnicodeDecodeError:
            continue
    if content is None:
        print(f"ERROR: Cannot decode {path}. Save the file as UTF-8 and try again.")
        sys.exit(1)

    sample    = content[:4096]
    delimiter = "\t" if sample.count("\t") > sample.count(",") else ","
    reader    = csv.DictReader(io.StringIO(content), delimiter=delimiter)
    return list(reader)


# ---------------------------------------------------------------------------
# DB pre-loading
# ---------------------------------------------------------------------------

def load_existing_urls() -> set[str]:
    """Returns all setlist_urls currently in fact_shows."""
    print("  Existing shows …", end=" ", flush=True)
    rows = sb_get_all("fact_shows", {"select": "setlist_url", "setlist_url": "not.is.null"})
    urls = {r["setlist_url"] for r in rows if r.get("setlist_url")}
    print(f"{len(urls):,}")
    return urls


def load_existing_artists() -> dict[str, int]:
    """Returns {artist_name.lower(): artist_id}."""
    print("  Existing artists …", end=" ", flush=True)
    rows = sb_get_all("dim_artist", {"select": "artist_id,artist_name"})
    result = {r["artist_name"].lower(): r["artist_id"] for r in rows if r.get("artist_name")}
    print(f"{len(result):,}")
    return result


def load_existing_venues() -> dict[str, int]:
    """Returns {venue_name.lower(): venue_id}."""
    print("  Existing venues …", end=" ", flush=True)
    rows = sb_get_all("dim_venue", {"select": "venue_id,venue_name"})
    result = {r["venue_name"].lower(): r["venue_id"] for r in rows if r.get("venue_name")}
    print(f"{len(result):,}")
    return result


# ---------------------------------------------------------------------------
# Entity creation helpers
# ---------------------------------------------------------------------------

def create_and_resolve(
    table: str,
    records: list[dict],
    name_key: str,
    id_key: str,
    id_map: dict[str, int],
) -> int:
    """
    Batch-insert records, update id_map with returned IDs.
    Falls back to a GET for any name that wasn't returned (shouldn't happen
    in normal operation, but guards against conflict edge cases).
    Returns count of records actually created.
    """
    created = 0
    for i in range(0, len(records), BATCH_SIZE):
        chunk = records[i: i + BATCH_SIZE]
        returned = sb_insert(table, chunk, return_rows=True)
        for row in returned:
            name = (row.get(name_key) or "").lower()
            rid  = row.get(id_key)
            if name and rid:
                id_map[name] = rid
                created += 1

    # Re-fetch any names that weren't returned (conflict silently skipped)
    missing = [r[name_key] for r in records if r[name_key].lower() not in id_map]
    for name in missing:
        rows = sb_get_page(table, {"select": f"{id_key},{name_key}", f"{name_key}": f"ilike.{name}"})
        for row in rows:
            if row.get(name_key) and row.get(id_key):
                id_map[row[name_key].lower()] = row[id_key]

    return created


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def _preview(to_insert: list[dict], new_artists: dict, new_venues: dict) -> None:
    MAX = 20
    if to_insert:
        print(f"\nNew shows (first {min(MAX, len(to_insert))} of {len(to_insert):,}):")
        for s in to_insert[:MAX]:
            print(f"  {s['date']}  {s['artist_name']:<32}  {s['venue_name']}")
        if len(to_insert) > MAX:
            print(f"  … {len(to_insert) - MAX:,} more")

    if new_artists:
        print(f"\nNew artists ({len(new_artists)}):")
        for name in list(new_artists)[:MAX]:
            print(f"  + {name}")
        if len(new_artists) > MAX:
            print(f"  … {len(new_artists) - MAX} more")

    if new_venues:
        print(f"\nNew venues ({len(new_venues)}):")
        for name in list(new_venues)[:MAX]:
            print(f"  + {name}")
        if len(new_venues) > MAX:
            print(f"  … {len(new_venues) - MAX} more")


def _summary(
    parsed: list, duplicates: list, to_insert: list,
    error_rows: list, new_artists: dict, new_venues: dict,
    inserted: int, dry_run: bool,
) -> None:
    note = " (no DB writes)" if dry_run else ""
    verb = "Would insert" if dry_run else "Inserted    "
    print("\n" + "=" * 64)
    print(f"Summary{note}")
    print(f"  Finished:             {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Rows parsed:        {len(parsed):>8,}")
    print(f"  Duplicates skipped: {len(duplicates):>8,}")
    print(f"  Parse errors:       {len(error_rows):>8,}")
    print(f"  {verb}          {(len(to_insert) if dry_run else inserted):>8,}  shows")
    if dry_run:
        print(f"  Would create:       {len(new_artists):>8,}  artists")
        print(f"  Would create:       {len(new_venues):>8,}  venues")
    else:
        print(f"  Artists created:    {len(new_artists):>8,}")
        print(f"  Venues created:     {len(new_venues):>8,}")
    if dry_run and to_insert:
        print(f"\nRun without --dry-run to apply {len(to_insert):,} changes.")
    print("=" * 64)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Ingest raw Octoparse setlist.fm export into Grooveprint Supabase.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="See module docstring for column format and env var requirements.",
    )
    ap.add_argument("--input",   required=True, help="Path to .csv, .tsv, or .xlsx input file")
    ap.add_argument("--dry-run", action="store_true", help="Report changes without writing to DB")
    ap.add_argument("--city",    default=DEFAULT_CITY, help=f"Target city for new venues (default: {DEFAULT_CITY})")
    args = ap.parse_args()

    print("=" * 64)
    print("Grooveprint — Show Refresh")
    print(f"Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Input:    {args.input}")
    print(f"City:     {args.city}")
    print(f"Mode:     {'DRY RUN (no DB writes)' if args.dry_run else 'LIVE'}")
    print("=" * 64)

    # ── 1. Load input ────────────────────────────────────────────────────────
    print("\nLoading input file…")
    raw_rows = load_file(args.input)
    print(f"  {len(raw_rows):,} raw rows read")

    # ── 2. Parse ─────────────────────────────────────────────────────────────
    print("\nParsing rows…")
    parsed: list[dict] = []
    error_rows: list[tuple[int, dict]] = []

    for idx, raw in enumerate(raw_rows):
        show = parse_row(raw, city=args.city)
        if show:
            parsed.append(show)
        else:
            has_content = any(str(v).strip() for v in raw.values())
            if has_content:
                error_rows.append((idx + 2, raw))  # +2: 1-indexed + header row

    print(f"  {len(parsed):,} parsed   |   {len(error_rows):,} skipped (parse errors)")
    if error_rows:
        for line_no, row in error_rows[:3]:
            print(f"    Line {line_no}: {row.get('Field1', str(row))[:80]}")
        if len(error_rows) > 3:
            print(f"    … {len(error_rows) - 3} more")

    if not parsed:
        print("\nNo valid rows to process. Exiting.")
        return

    # ── 3. Snapshot existing DB state ────────────────────────────────────────
    print("\nLoading Supabase snapshot…")
    existing_urls    = load_existing_urls()
    existing_artists = load_existing_artists()
    existing_venues  = load_existing_venues()

    # ── 4. Classify ──────────────────────────────────────────────────────────
    print("\nClassifying…")
    duplicates:      list[dict]      = []
    to_insert:       list[dict]      = []
    new_artist_names: dict[str, None] = {}   # ordered-dict as an ordered set
    new_venue_names:  dict[str, str]  = {}   # name → city

    for show in parsed:
        if show["setlist_url"] in existing_urls:
            duplicates.append(show)
            continue
        if show["artist_name"].lower() not in existing_artists:
            new_artist_names[show["artist_name"]] = None
        if show["venue_name"].lower() not in existing_venues:
            new_venue_names[show["venue_name"]] = show["city"]
        to_insert.append(show)

    print(f"  {len(duplicates):,} duplicates  |  {len(to_insert):,} new  |  "
          f"{len(new_artist_names):,} new artists  |  {len(new_venue_names):,} new venues")

    _preview(to_insert, new_artist_names, new_venue_names)

    # ── 5. Dry-run exit ───────────────────────────────────────────────────────
    if args.dry_run:
        _summary(parsed, duplicates, to_insert, error_rows,
                 new_artist_names, new_venue_names, inserted=0, dry_run=True)
        return

    if not to_insert:
        print("\nNothing new to insert.")
        _summary(parsed, duplicates, to_insert, error_rows,
                 new_artist_names, new_venue_names, inserted=0, dry_run=False)
        return

    # ── 6. Apply ─────────────────────────────────────────────────────────────
    print("\nApplying changes…")

    # 6a. New artists
    new_artist_count = 0
    if new_artist_names:
        print(f"  Creating {len(new_artist_names)} artist(s)…", end=" ", flush=True)
        records = [{"artist_name": name} for name in new_artist_names]
        new_artist_count = create_and_resolve(
            "dim_artist", records, "artist_name", "artist_id", existing_artists
        )
        print(f"✅  {new_artist_count} created")

    # 6b. New venues
    new_venue_count = 0
    if new_venue_names:
        print(f"  Creating {len(new_venue_names)} venue(s)…", end=" ", flush=True)
        records = [{"venue_name": n, "city": c, "status": "Open"} for n, c in new_venue_names.items()]
        new_venue_count = create_and_resolve(
            "dim_venue", records, "venue_name", "venue_id", existing_venues
        )
        print(f"✅  {new_venue_count} created")

    # 6c. Build fact_shows records — resolve FK IDs
    show_records: list[dict] = []
    unresolved:   list[dict] = []

    for show in to_insert:
        artist_id = existing_artists.get(show["artist_name"].lower())
        venue_id  = existing_venues.get(show["venue_name"].lower())
        if not artist_id or not venue_id:
            unresolved.append(show)
            continue
        record: dict = {
            "date":        show["date"],
            "artist_id":   artist_id,
            "venue_id":    venue_id,
            "setlist_url": show["setlist_url"],
            "show_type":   show["show_type"],
        }
        if show.get("festival_name"):
            record["festival_name"] = show["festival_name"]
        show_records.append(record)

    if unresolved:
        print(f"  ⚠️  {len(unresolved)} show(s) skipped — artist or venue ID unresolved:")
        for s in unresolved[:5]:
            print(f"     {s['date']}  {s['artist_name']}  @  {s['venue_name']}")

    # 6d. Insert shows (idempotent — setlist_url unique constraint handles reruns)
    inserted = 0
    if show_records:
        print(f"  Inserting {len(show_records):,} shows…", end=" ", flush=True)
        for i in range(0, len(show_records), BATCH_SIZE):
            sb_insert("fact_shows", show_records[i: i + BATCH_SIZE])
            inserted += min(BATCH_SIZE, len(show_records) - i)
        print(f"✅  {inserted:,} inserted")

    _summary(parsed, duplicates, to_insert, error_rows,
             new_artist_names, new_venue_names, inserted=inserted, dry_run=False)


if __name__ == "__main__":
    main()
