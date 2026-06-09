#!/usr/bin/env python3
"""
Grooveprint — Show Refresh Script  v3
scripts/refresh_shows.py

Ingests a raw Octoparse setlist.fm export into Supabase.
Uses setlist_url as the deduplication key — existing shows are never overwritten.

Venue resolution chain:
  1. Exact match → dim_venue.venue_name
  2. Exact match → dim_venue.other_names  (historical renames — auto-indexed)
  3. Exact match → venue_aliases table     (setlist.fm naming discrepancies)
  4. Fuzzy match  → blocked in live; SQL suggestion printed in dry-run and live
  5. No match     → auto-create as new venue

Artist resolution chain (same pattern, no city dimension):
  1. Exact match → dim_artist.artist_name
  2. Exact match → artist_aliases table    (setlist.fm naming discrepancies)
  3. Fuzzy match  → blocked; SQL suggestion printed
  4. No match     → auto-create as new artist (review_status = 'unverified')

Usage:
    pip install requests python-dotenv openpyxl

    python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --dry-run
    python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv

Required .env:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key

Optional .env:
    REFRESH_CITY=Vancouver
"""

import argparse
import csv
import difflib
import io
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
DEFAULT_CITY = os.getenv("REFRESH_CITY", "Vancouver")

BATCH_SIZE            = 500
VENUE_FUZZY_THRESHOLD  = 0.82   # on normalised names
ARTIST_FUZZY_THRESHOLD = 0.85   # stricter — wrong artist link corrupts Spotify matching

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
    """Paginate through all rows — needed for fact_shows (36k+ rows)."""
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
    """Batch INSERT with ON CONFLICT DO NOTHING (idempotent on unique keys)."""
    if not records:
        return []
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    prefer = (
        "return=representation,resolution=ignore-duplicates"
        if return_rows
        else "return=minimal,resolution=ignore-duplicates"
    )
    resp = requests.post(url, headers=_headers(prefer), json=records)
    if not resp.ok:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text[:500]
        raise requests.exceptions.HTTPError(
            f"{resp.status_code} on {table}: {detail}", response=resp
        )
    if not return_rows:
        return []
    result = resp.json()
    return result if isinstance(result, list) else ([result] if result else [])


def get_max_id(table: str, id_col: str) -> int:
    """Return MAX(id_col) from table, or 0 if the table is empty."""
    rows = sb_get_page(table, {"select": id_col, "order": f"{id_col}.desc", "limit": "1"})
    if rows and rows[0].get(id_col) is not None:
        return int(rows[0][id_col])
    return 0


# ---------------------------------------------------------------------------
# Normalisation helpers (for fuzzy matching only — never used for DB writes)
# ---------------------------------------------------------------------------

_VENUE_SUFFIXES = (
    " stadium", " arena", " theatre", " theater",
    " center", " centre", " hall", " club", " bar",
    " room", " lounge", " studio", " studios",
    " inc", " ltd", " co",
)


def normalize_venue(name: str) -> str:
    """
    Strip leading 'The ', punctuation, and common venue-type suffixes.

    'The Orpheum'          → 'orpheum'
    'Orpheum Theatre'      → 'orpheum'      ← exact match ✓
    'BC Place Stadium'     → 'bc place'
    'BC Place'             → 'bc place'     ← exact match ✓
    'W.I.S.E. Hall'        → 'wise'
    'Wise Hall'            → 'wise'         ← exact match ✓
    """
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    changed = True
    while changed:
        changed = False
        for suffix in _VENUE_SUFFIXES:
            if s.endswith(suffix):
                s = s[: -len(suffix)].strip()
                changed = True
                break
    return s


def normalize_artist(name: str) -> str:
    """
    Strip leading 'The ' and punctuation for artist comparison.
    Intentionally simpler than venue normalisation — no suffix stripping.

    'The Smashing Pumpkins' → 'smashing pumpkins'
    'Smashing Pumpkins'     → 'smashing pumpkins'   ← exact match ✓
    'AC/DC'                 → 'acdc'
    'AC DC'                 → 'ac dc'               ← close match
    'Guns N\' Roses'        → 'guns n roses'
    """
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    return s


def _fuzzy_search(
    norm: str,
    id_map: dict[str, int],
    name_map: dict[str, str],
    threshold: float,
) -> Optional[tuple[str, int, float]]:
    """
    Shared fuzzy lookup used by both venue and artist matchers.
    Returns (canonical_display_name, id, score) or None.
    Step 1: normalised exact match → 1.0
    Step 2: difflib on normalised forms, must exceed threshold
    """
    if not norm:
        return None
    best_score = 0.0
    best_key: Optional[str] = None
    for key in id_map:
        norm_key = norm.__class__(key)   # key is already lowercase
        if norm == normalize_venue(norm_key) or norm == normalize_artist(norm_key):
            # handled below via explicit normaliser call
            pass
        score = difflib.SequenceMatcher(None, norm, norm_key).ratio()
        if score > best_score:
            best_score = score
            best_key = key
    if best_key and best_score >= threshold:
        return (name_map[best_key], id_map[best_key], best_score)
    return None


def find_fuzzy_venue_match(
    name: str, id_map: dict[str, int], name_map: dict[str, str],
) -> Optional[tuple[str, int, float]]:
    norm = normalize_venue(name)
    if not norm:
        return None
    best_score = 0.0
    best_key: Optional[str] = None
    for key in id_map:
        nk = normalize_venue(key)
        if norm == nk:
            return (name_map[key], id_map[key], 1.0)
        s = difflib.SequenceMatcher(None, norm, nk).ratio()
        if s > best_score:
            best_score = s
            best_key = key
    if best_key and best_score >= VENUE_FUZZY_THRESHOLD:
        return (name_map[best_key], id_map[best_key], best_score)
    return None


def find_fuzzy_artist_match(
    name: str, id_map: dict[str, int], name_map: dict[str, str],
) -> Optional[tuple[str, int, float]]:
    norm = normalize_artist(name)
    if not norm:
        return None
    best_score = 0.0
    best_key: Optional[str] = None
    for key in id_map:
        nk = normalize_artist(key)
        if norm == nk:
            return (name_map[key], id_map[key], 1.0)
        s = difflib.SequenceMatcher(None, norm, nk).ratio()
        if s > best_score:
            best_score = s
            best_key = key
    if best_key and best_score >= ARTIST_FUZZY_THRESHOLD:
        return (name_map[best_key], id_map[best_key], best_score)
    return None


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def parse_date(month_str: str, day_str: str, year_str: str) -> Optional[str]:
    try:
        m = MONTH_MAP.get((month_str or "").strip().upper())
        d = int((day_str  or "").strip())
        y = int((year_str or "").strip())
        if not m or not (1 <= d <= 31) or y < 1900:
            return None
        return f"{y:04d}-{m:02d}-{d:02d}"
    except (ValueError, TypeError):
        return None


def extract_venue_info(venue_full: str) -> tuple[str, str]:
    """
    Extract (venue_name, city) from a setlist.fm location string.

    'Lucky Bar, Victoria, BC, Canada'  → ('Lucky Bar', 'Victoria')
    'Commodore Ballroom, Vancouver, …' → ('Commodore Ballroom', 'Vancouver')
    """
    venue_full = (venue_full or "").strip()
    if not venue_full:
        return "", ""
    parts = [p.strip() for p in venue_full.split(", ")]
    if len(parts) > 3:
        return ", ".join(parts[:-3]), parts[-3]
    if len(parts) == 3:
        return parts[0], parts[0]
    if len(parts) == 2:
        return parts[0], ""
    return venue_full, ""


def parse_row(row: dict, city: str = DEFAULT_CITY) -> Optional[dict]:
    """
    Parse one Octoparse row. Returns None if invalid.

    details2 patterns:
      "Tour: <name>" → details4 = tour name, details6 = full venue string
      "Venue: <str>" → details4 = full venue string, details6 = empty
    """
    setlist_url = (row.get("Field") or "").strip()
    if not setlist_url or "setlist.fm" not in setlist_url:
        return None
    date = parse_date(row.get("month", ""), row.get("day", ""), row.get("Year", ""))
    if not date:
        return None
    artist_name = (row.get("details") or "").strip()
    if not artist_name:
        return None
    details2 = row.get("details2") or ""
    details4 = (row.get("details4") or "").strip()
    details6 = (row.get("details6") or "").strip()
    venue_full = details4 if "Venue:" in details2 else (details6 or details4)
    venue_name, venue_city = extract_venue_info(venue_full)
    if not venue_city:
        venue_city = city
    if not venue_name:
        return None
    return {
        "setlist_url": setlist_url,
        "date":        date,
        "artist_name": artist_name,
        "venue_name":  venue_name,
        "show_type":   "music",
        "city":        venue_city,
    }


# ---------------------------------------------------------------------------
# File loading
# ---------------------------------------------------------------------------

def load_file(path: str) -> list[dict]:
    p = Path(path)
    if not p.exists():
        print(f"ERROR: File not found: {path}")
        sys.exit(1)
    if p.suffix.lower() in (".xlsx", ".xls"):
        try:
            import openpyxl
        except ImportError:
            print("ERROR: openpyxl required. Run: pip install openpyxl")
            sys.exit(1)
        wb = openpyxl.load_workbook(str(p), read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not rows:
            return []
        headers = [str(h).strip() if h is not None else f"col_{i}" for i, h in enumerate(rows[0])]
        return [
            {headers[i]: (str(v).strip() if v is not None else "") for i, v in enumerate(r) if i < len(headers)}
            for r in rows[1:]
        ]
    content: Optional[str] = None
    for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
        try:
            content = p.read_text(encoding=enc)
            break
        except UnicodeDecodeError:
            continue
    if content is None:
        print(f"ERROR: Cannot decode {path}.")
        sys.exit(1)
    sample    = content[:4096]
    delimiter = "\t" if sample.count("\t") > sample.count(",") else ","
    return list(csv.DictReader(io.StringIO(content), delimiter=delimiter))


# ---------------------------------------------------------------------------
# DB pre-loading
# ---------------------------------------------------------------------------

def load_existing_urls() -> set[str]:
    print("  Existing shows …", end=" ", flush=True)
    rows = sb_get_all("fact_shows", {"select": "setlist_url", "setlist_url": "not.is.null"})
    urls = {r["setlist_url"] for r in rows if r.get("setlist_url")}
    print(f"{len(urls):,}")
    return urls


def load_existing_artists() -> tuple[dict[str, int], dict[str, str]]:
    """
    Returns:
        id_map   {name_lower → artist_id}
        name_map {name_lower → canonical_display_name}
    """
    print("  Existing artists …", end=" ", flush=True)
    rows = sb_get_all("dim_artist", {"select": "artist_id,artist_name"})
    id_map:   dict[str, int] = {}
    name_map: dict[str, str] = {}
    for r in rows:
        if r.get("artist_name"):
            k = r["artist_name"].lower()
            id_map[k]   = r["artist_id"]
            name_map[k] = r["artist_name"]
    print(f"{len(id_map):,}")
    return id_map, name_map


def load_existing_venues() -> tuple[dict[str, int], dict[str, str]]:
    """
    Returns id_map and name_map. Indexes venue_name and other_names (historical names).
    Historical names resolve silently — e.g. 'GM Place' → Rogers Arena.
    """
    print("  Existing venues …", end=" ", flush=True)
    rows = sb_get_all("dim_venue", {"select": "venue_id,venue_name,other_names"})
    id_map:   dict[str, int] = {}
    name_map: dict[str, str] = {}
    for r in rows:
        if not r.get("venue_name"):
            continue
        canonical = r["venue_name"]
        vid       = r["venue_id"]
        id_map[canonical.lower()]   = vid
        name_map[canonical.lower()] = canonical
        for alt in (r.get("other_names") or "").split(","):
            alt = alt.strip()
            if len(alt) >= 4:
                id_map[alt.lower()]   = vid
                name_map[alt.lower()] = canonical
    print(f"{len(id_map):,}  ({len(rows):,} venues + other_names)")
    return id_map, name_map


def load_artist_aliases() -> dict[str, int]:
    """
    Returns {setlist_name.lower() → artist_id}.
    No city filter — artist names are global.
    """
    print("  Artist aliases …", end=" ", flush=True)
    try:
        rows = sb_get_page("artist_aliases", {"select": "setlist_name,artist_id"})
        result = {
            r["setlist_name"].lower(): r["artist_id"]
            for r in rows if r.get("setlist_name") and r.get("artist_id")
        }
        print(f"{len(result):,}")
        return result
    except Exception:
        print("0  (table not found — run migration SQL first)")
        return {}


def load_venue_aliases(city: str) -> dict[str, int]:
    """Returns {setlist_name.lower() → venue_id} for the given city."""
    print("  Venue aliases …", end=" ", flush=True)
    try:
        rows = sb_get_page("venue_aliases", {
            "select": "setlist_name,venue_id",
            "city":   f"eq.{city}",
        })
        result = {
            r["setlist_name"].lower(): r["venue_id"]
            for r in rows if r.get("setlist_name") and r.get("venue_id")
        }
        print(f"{len(result):,}")
        return result
    except Exception:
        print("0  (table not found — run migration SQL first)")
        return {}


# ---------------------------------------------------------------------------
# Entity creation helper
# ---------------------------------------------------------------------------

def create_and_resolve(
    table: str, records: list[dict],
    name_key: str, id_key: str,
    id_map: dict[str, int],
) -> int:
    created = 0
    for i in range(0, len(records), BATCH_SIZE):
        chunk    = records[i: i + BATCH_SIZE]
        returned = sb_insert(table, chunk, return_rows=True)
        for row in returned:
            name = (row.get(name_key) or "").lower()
            rid  = row.get(id_key)
            if name and rid:
                id_map[name] = rid
                created += 1
    # Re-fetch any not returned (conflict edge case)
    missing = [r[name_key] for r in records if r[name_key].lower() not in id_map]
    for name in missing:
        rows = sb_get_page(table, {"select": f"{id_key},{name_key}", f"{name_key}": f"ilike.{name}"})
        for row in rows:
            if row.get(name_key) and row.get(id_key):
                id_map[row[name_key].lower()] = row[id_key]
    return created


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------

def _print_alias_report(
    suggestions: dict,       # {input_name: (canonical_name, id, score)}
    shows_list: list[dict],  # to count blocked shows per suggestion
    show_match_key: str,     # 'artist_name' or 'venue_name'
    table: str,              # 'artist_aliases' or 'venue_aliases'
    id_col: str,             # 'artist_id' or 'venue_id'
    header: str,
    city: Optional[str] = None,   # venue_aliases only; None for artist_aliases
) -> None:
    """Generic alias report for both artists and venues."""
    if not suggestions:
        return

    blocked_by_name: dict[str, int] = {}
    for s in shows_list:
        if s[show_match_key] in suggestions:
            blocked_by_name[s[show_match_key]] = blocked_by_name.get(s[show_match_key], 0) + 1

    print(f"\n{header} ({len(suggestions)}):")
    for input_name, (canonical, rid, score) in suggestions.items():
        n       = blocked_by_name.get(input_name, 0)
        score_s = "exact (normalised)" if score == 1.0 else f"{score:.0%} similarity"
        print(f"  '{input_name}'  →  '{canonical}'  [{score_s}, {n} show(s)]")

    print(f"\n  SQL — verify each line, then run in Supabase SQL editor:")
    if city:
        # venue_aliases — includes city column
        print(f"  INSERT INTO {table} (setlist_name, city, {id_col}) VALUES")
        lines = [
            f"    ('{name.replace(chr(39), chr(39)*2)}', '{city}', {rid})"
            for name, (_, rid, _) in suggestions.items()
            if blocked_by_name.get(name, 0) > 0
        ]
    else:
        # artist_aliases — no city column
        print(f"  INSERT INTO {table} (setlist_name, {id_col}) VALUES")
        lines = [
            f"    ('{name.replace(chr(39), chr(39)*2)}', {rid})"
            for name, (_, rid, _) in suggestions.items()
            if blocked_by_name.get(name, 0) > 0
        ]
    print(",\n".join(lines) + "\n  ON CONFLICT DO NOTHING;")
    print(f"  Then re-run the script to insert the held shows.")


def _summary(
    parsed, duplicates, to_insert, error_rows,
    genuinely_new_artists, genuinely_new_venues,
    fuzzy_artist_suggestions, fuzzy_venue_suggestions,
    inserted, fuzzy_blocked, dry_run,
) -> None:
    n_artist_blocked = sum(1 for s in to_insert if s["artist_name"] in fuzzy_artist_suggestions)
    n_venue_blocked  = sum(1 for s in to_insert if s["venue_name"]  in fuzzy_venue_suggestions)
    n_blocked        = sum(1 for s in to_insert
                          if s["artist_name"] in fuzzy_artist_suggestions
                          or s["venue_name"]  in fuzzy_venue_suggestions)
    n_ready          = len(to_insert) - n_blocked
    note             = " (no DB writes)" if dry_run else ""
    verb             = "Ready to insert" if dry_run else "Inserted      "

    print("\n" + "=" * 64)
    print(f"Summary{note}")
    print(f"  Finished:             {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Rows parsed:        {len(parsed):>8,}")
    print(f"  Duplicates skipped: {len(duplicates):>8,}")
    print(f"  Parse errors:       {len(error_rows):>8,}")
    print(f"  {verb}:     {(n_ready if dry_run else inserted):>8,}  shows")
    if n_blocked:
        print(f"  Alias-blocked:      {n_blocked:>8,}  shows  (add aliases, re-run)")
        if n_artist_blocked:
            print(f"    of which artist:  {n_artist_blocked:>8,}")
        if n_venue_blocked:
            print(f"    of which venue:   {n_venue_blocked:>8,}")
    print(f"  New artists:        {len(genuinely_new_artists):>8,}")
    print(f"  New venues:         {len(genuinely_new_venues):>8,}")
    if fuzzy_artist_suggestions:
        print(f"  Artist aliases needed:{len(fuzzy_artist_suggestions):>6,}")
    if fuzzy_venue_suggestions:
        print(f"  Venue aliases needed: {len(fuzzy_venue_suggestions):>6,}")
    if dry_run:
        if n_ready > 0:
            print(f"\n  {n_ready:,} shows ready — run without --dry-run to apply.")
        if n_blocked:
            print(f"  {n_blocked} more shows once aliases are added.")
    elif fuzzy_blocked:
        print(f"\n  {len(fuzzy_blocked)} held shows — add aliases and re-run.")
    print("=" * 64)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Ingest raw Octoparse setlist.fm export into Grooveprint Supabase.",
    )
    ap.add_argument("--input",   required=True, help="Path to .csv, .tsv, or .xlsx")
    ap.add_argument("--dry-run", action="store_true", help="Report without writing to DB")
    ap.add_argument("--city",    default=DEFAULT_CITY, help=f"Target city (default: {DEFAULT_CITY})")
    args = ap.parse_args()

    print("=" * 64)
    print("Grooveprint — Show Refresh  v3")
    print(f"Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Input:    {args.input}")
    print(f"City:     {args.city}")
    print(f"Mode:     {'DRY RUN (no DB writes)' if args.dry_run else 'LIVE'}")
    print("=" * 64)

    # ── 1. Load & parse ──────────────────────────────────────────────────────
    print("\nLoading input file…")
    raw_rows = load_file(args.input)
    print(f"  {len(raw_rows):,} raw rows read")

    print("\nParsing rows…")
    parsed:    list[dict]    = []
    error_rows: list[tuple]  = []
    for idx, raw in enumerate(raw_rows):
        show = parse_row(raw, city=args.city)
        if show:
            parsed.append(show)
        else:
            if any(str(v).strip() for v in raw.values()):
                error_rows.append((idx + 2, raw))
    print(f"  {len(parsed):,} parsed   |   {len(error_rows):,} skipped (parse errors)")
    if error_rows:
        for line_no, row in error_rows[:3]:
            print(f"    Line {line_no}: {row.get('Field1', str(row))[:80]}")
        if len(error_rows) > 3:
            print(f"    … {len(error_rows) - 3} more")
    if not parsed:
        print("\nNo valid rows to process. Exiting.")
        return

    # ── 2. Snapshot DB state ─────────────────────────────────────────────────
    print("\nLoading Supabase snapshot…")
    existing_urls                      = load_existing_urls()
    existing_artists, artist_name_map  = load_existing_artists()
    existing_venues,  venue_name_map   = load_existing_venues()
    artist_aliases                     = load_artist_aliases()
    venue_aliases                      = load_venue_aliases(args.city)

    # ── 3. Classify ──────────────────────────────────────────────────────────
    print("\nClassifying…")
    duplicates:              list[dict]       = []
    to_insert:               list[dict]       = []
    genuinely_new_artists:   dict[str, None]  = {}   # auto-create
    genuinely_new_venues:    dict[str, str]   = {}   # name → city, auto-create
    fuzzy_artist_suggestions: dict[str, tuple] = {}  # block + suggest
    fuzzy_venue_suggestions:  dict[str, tuple] = {}  # block + suggest

    for show in parsed:
        if show["setlist_url"] in existing_urls:
            duplicates.append(show)
            continue

        # ── Artist classification ──
        akey     = show["artist_name"].lower()
        a_resolved = akey in existing_artists or akey in artist_aliases
        if not a_resolved and show["artist_name"] not in fuzzy_artist_suggestions \
                          and show["artist_name"] not in genuinely_new_artists:
            suggestion = find_fuzzy_artist_match(show["artist_name"], existing_artists, artist_name_map)
            if suggestion:
                fuzzy_artist_suggestions[show["artist_name"]] = suggestion
            else:
                genuinely_new_artists[show["artist_name"]] = None

        # ── Venue classification ──
        vkey     = show["venue_name"].lower()
        v_resolved = vkey in existing_venues or vkey in venue_aliases
        if not v_resolved and show["venue_name"] not in fuzzy_venue_suggestions \
                          and show["venue_name"] not in genuinely_new_venues:
            suggestion = find_fuzzy_venue_match(show["venue_name"], existing_venues, venue_name_map)
            if suggestion:
                fuzzy_venue_suggestions[show["venue_name"]] = suggestion
            else:
                genuinely_new_venues[show["venue_name"]] = show["city"]

        to_insert.append(show)

    n_blocked = sum(
        1 for s in to_insert
        if s["artist_name"] in fuzzy_artist_suggestions
        or s["venue_name"]  in fuzzy_venue_suggestions
    )
    print(
        f"  {len(duplicates):,} duplicates  |  {len(to_insert):,} new  "
        f"|  {len(genuinely_new_artists):,} new artists  "
        f"|  {len(genuinely_new_venues):,} new venues  "
        f"|  {n_blocked} alias-blocked"
    )

    # ── Preview ───────────────────────────────────────────────────────────────
    MAX = 20
    if to_insert:
        print(f"\nNew shows (first {min(MAX, len(to_insert))} of {len(to_insert):,}):")
        for s in to_insert[:MAX]:
            flags = []
            if s["artist_name"] in fuzzy_artist_suggestions: flags.append("artist⚠")
            if s["venue_name"]  in fuzzy_venue_suggestions:  flags.append("venue⚠")
            flag_str = f"  [{', '.join(flags)}]" if flags else ""
            print(f"  {s['date']}  {s['artist_name']:<32}  {s['venue_name']}{flag_str}")
        if len(to_insert) > MAX:
            print(f"  … {len(to_insert) - MAX:,} more")

    if genuinely_new_artists:
        print(f"\nNew artists to auto-create ({len(genuinely_new_artists)}):")
        for name in list(genuinely_new_artists)[:MAX]:
            print(f"  + {name}")
        if len(genuinely_new_artists) > MAX:
            print(f"  … {len(genuinely_new_artists) - MAX} more")

    if genuinely_new_venues:
        print(f"\nNew venues to auto-create ({len(genuinely_new_venues)}):")
        for name in list(genuinely_new_venues)[:MAX]:
            print(f"  + {name}")

    _print_alias_report(
        fuzzy_artist_suggestions, to_insert, "artist_name",
        "artist_aliases", "artist_id",
        header="⚠️  Potential artist aliases — verify and add to artist_aliases",
        city=None,
    )
    _print_alias_report(
        fuzzy_venue_suggestions, to_insert, "venue_name",
        "venue_aliases", "venue_id",
        header="⚠️  Potential venue aliases — verify and add to venue_aliases",
        city=args.city,
    )

    # ── Dry-run exit ──────────────────────────────────────────────────────────
    if args.dry_run:
        _summary(
            parsed, duplicates, to_insert, error_rows,
            genuinely_new_artists, genuinely_new_venues,
            fuzzy_artist_suggestions, fuzzy_venue_suggestions,
            inserted=0, fuzzy_blocked=[], dry_run=True,
        )
        return

    n_ready = len(to_insert) - n_blocked
    if n_ready == 0:
        print("\nNothing ready to insert.")
        _summary(
            parsed, duplicates, to_insert, error_rows,
            genuinely_new_artists, genuinely_new_venues,
            fuzzy_artist_suggestions, fuzzy_venue_suggestions,
            inserted=0, fuzzy_blocked=[], dry_run=False,
        )
        return

    # ── 4. Apply ──────────────────────────────────────────────────────────────
    print("\nApplying changes…")

    if genuinely_new_artists:
        print(f"  Creating {len(genuinely_new_artists)} artist(s)…", end=" ", flush=True)
        next_id = get_max_id("dim_artist", "artist_id") + 1
        records = [
            {"artist_id": next_id + i, "artist_name": n, "review_status": "unverified"}
            for i, n in enumerate(genuinely_new_artists)
        ]
        count = create_and_resolve("dim_artist", records, "artist_name", "artist_id", existing_artists)
        print(f"✅  {count} created")

    if genuinely_new_venues:
        print(f"  Creating {len(genuinely_new_venues)} venue(s)…", end=" ", flush=True)
        next_id = get_max_id("dim_venue", "venue_id") + 1
        records = [
            {"venue_id": next_id + i, "venue_name": n, "city": c, "status": "Open"}
            for i, (n, c) in enumerate(genuinely_new_venues.items())
        ]
        count = create_and_resolve("dim_venue", records, "venue_name", "venue_id", existing_venues)
        print(f"✅  {count} created")

    show_records:  list[dict] = []
    unresolved:    list[dict] = []
    fuzzy_blocked: list[dict] = []

    for show in to_insert:
        # Block shows where either artist or venue has a fuzzy suggestion but no alias
        if show["artist_name"] in fuzzy_artist_suggestions \
                or show["venue_name"] in fuzzy_venue_suggestions:
            fuzzy_blocked.append(show)
            continue

        akey      = show["artist_name"].lower()
        artist_id = existing_artists.get(akey) or artist_aliases.get(akey)

        vkey      = show["venue_name"].lower()
        venue_id  = existing_venues.get(vkey) or venue_aliases.get(vkey)

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
        print(f"  ⚠️  {len(unresolved)} show(s) skipped — ID unresolved after creation:")
        for s in unresolved[:5]:
            print(f"     {s['date']}  {s['artist_name']}  @  {s['venue_name']}")

    inserted = 0
    if show_records:
        # fact_shows has no auto-increment sequence — assign IDs explicitly
        next_show_id = get_max_id("fact_shows", "show_id") + 1
        for idx, record in enumerate(show_records):
            record["show_id"] = next_show_id + idx
        print(f"  Inserting {len(show_records):,} shows…", end=" ", flush=True)
        for i in range(0, len(show_records), BATCH_SIZE):
            sb_insert("fact_shows", show_records[i: i + BATCH_SIZE])
            inserted += min(BATCH_SIZE, len(show_records) - i)
        print(f"✅  {inserted:,} inserted")

    if fuzzy_blocked:
        _print_alias_report(
            fuzzy_artist_suggestions, fuzzy_blocked, "artist_name",
            "artist_aliases", "artist_id",
            header="⚠️  Artist-blocked shows — add aliases and re-run",
            city=None,
        )
        _print_alias_report(
            fuzzy_venue_suggestions, fuzzy_blocked, "venue_name",
            "venue_aliases", "venue_id",
            header="⚠️  Venue-blocked shows — add aliases and re-run",
            city=args.city,
        )

    _summary(
        parsed, duplicates, to_insert, error_rows,
        genuinely_new_artists, genuinely_new_venues,
        fuzzy_artist_suggestions, fuzzy_venue_suggestions,
        inserted=inserted, fuzzy_blocked=fuzzy_blocked, dry_run=False,
    )


if __name__ == "__main__":
    main()
