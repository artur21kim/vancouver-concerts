#!/usr/bin/env python3
"""
Grooveprint — Show Refresh Script  v2
scripts/refresh_shows.py

Ingests a raw Octoparse setlist.fm export into Supabase.
Uses setlist_url as the deduplication key — existing shows are never overwritten.

Venue resolution chain (in order):
  1. Exact match against dim_venue.venue_name
  2. Exact match against dim_venue.other_names  (historical renames — auto-indexed)
  3. Exact match against venue_aliases table     (setlist.fm naming discrepancies)
  4. Fuzzy match (normalized names)              → blocked in live; SQL suggestion printed
  5. No match                                    → auto-create as new venue

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

BATCH_SIZE      = 500
FUZZY_THRESHOLD = 0.82   # similarity on normalised names; lower than raw since noise is removed

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
    resp.raise_for_status()
    if not return_rows:
        return []
    result = resp.json()
    return result if isinstance(result, list) else ([result] if result else [])


# ---------------------------------------------------------------------------
# Venue name normalisation (for fuzzy matching only — not for DB writes)
# ---------------------------------------------------------------------------

_VENUE_SUFFIXES = (
    " stadium", " arena", " theatre", " theater",
    " center", " centre", " hall", " club", " bar",
    " room", " lounge", " studio", " studios",
    " inc", " ltd", " co",
)


def normalize_venue(name: str) -> str:
    """
    Normalise for comparison. Never used for DB writes.

    'The Orpheum'          → 'orpheum'
    'Orpheum Theatre'      → 'orpheum'      ← exact match ✓
    'BC Place Stadium'     → 'bc place'
    'BC Place'             → 'bc place'     ← exact match ✓
    'W.I.S.E. Hall'        → 'wise'
    'Wise Hall'            → 'wise'         ← exact match ✓
    'Bully\'s Studios Inc' → 'bullys'
    'Bully\'s Studios'     → 'bullys'       ← exact match ✓
    """
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)   # remove punctuation
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    # Iteratively strip suffixes (handles "Studios Inc" → "Studios" → "")
    changed = True
    while changed:
        changed = False
        for suffix in _VENUE_SUFFIXES:
            if s.endswith(suffix):
                s = s[: -len(suffix)].strip()
                changed = True
                break
    return s


def find_fuzzy_match(
    name: str,
    id_map:   dict[str, int],
    name_map: dict[str, str],
) -> Optional[tuple[str, int, float]]:
    """
    Returns (canonical_display_name, venue_id, score) if a close match exists.

    Step 1: normalised exact match → score 1.0 (very high confidence)
    Step 2: difflib on normalised forms, threshold FUZZY_THRESHOLD
    """
    norm = normalize_venue(name)
    if not norm:
        return None

    best_score = 0.0
    best_key: Optional[str] = None

    for key in id_map:
        norm_key = normalize_venue(key)
        if norm == norm_key:
            return (name_map[key], id_map[key], 1.0)
        score = difflib.SequenceMatcher(None, norm, norm_key).ratio()
        if score > best_score:
            best_score = score
            best_key = key

    if best_key and best_score >= FUZZY_THRESHOLD:
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


def extract_venue_name(venue_full: str) -> str:
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
    Parse one Octoparse row. Returns None if invalid.

    details2 has two patterns:
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
    if "Venue:" in details2:
        venue_full = details4
    else:
        venue_full = details6 or details4
    venue_name = extract_venue_name(venue_full)
    if not venue_name:
        return None
    return {
        "setlist_url": setlist_url,
        "date":        date,
        "artist_name": artist_name,
        "venue_name":  venue_name,
        "show_type":   "music",
        "city":        city,
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


def load_existing_artists() -> dict[str, int]:
    print("  Existing artists …", end=" ", flush=True)
    rows = sb_get_all("dim_artist", {"select": "artist_id,artist_name"})
    result = {r["artist_name"].lower(): r["artist_id"] for r in rows if r.get("artist_name")}
    print(f"{len(result):,}")
    return result


def load_existing_venues() -> tuple[dict[str, int], dict[str, str]]:
    """
    Returns:
        id_map   {name_lower → venue_id}        — for resolution
        name_map {name_lower → canonical_name}  — for fuzzy suggestions display

    Indexes both venue_name and other_names (comma-separated historical names).
    Historical names resolve silently without needing a venue_aliases entry —
    e.g. a 1995 show at "GM Place" resolves to venue_id for "Rogers Arena"
    automatically because "GM Place" is in Rogers Arena's other_names.
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
            if len(alt) >= 4:                  # skip empty / very short fragments
                id_map[alt.lower()]   = vid
                name_map[alt.lower()] = canonical   # always points to canonical
    print(f"{len(id_map):,}  ({len(rows):,} venues + other_names)")
    return id_map, name_map


def load_venue_aliases(city: str) -> dict[str, int]:
    """
    Returns {setlist_name.lower() → venue_id} for the given city.
    Returns empty dict gracefully if the table doesn't exist yet.
    """
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
    fuzzy_suggestions: dict,   # {setlist_name: (canonical, vid, score)}
    shows_list: list[dict],    # list of shows (to_insert or fuzzy_blocked)
    city: str,
    header: str,
) -> None:
    """Print fuzzy suggestions with blocked counts and copy-paste SQL."""
    if not fuzzy_suggestions:
        return

    blocked_by_venue: dict[str, int] = {}
    for s in shows_list:
        if s["venue_name"] in fuzzy_suggestions:
            blocked_by_venue[s["venue_name"]] = blocked_by_venue.get(s["venue_name"], 0) + 1

    print(f"\n{header} ({len(fuzzy_suggestions)}):")
    for name, (canonical, vid, score) in fuzzy_suggestions.items():
        n        = blocked_by_venue.get(name, 0)
        score_s  = "exact (normalised)" if score == 1.0 else f"{score:.0%} similarity"
        print(f"  '{name}'  →  '{canonical}'  [{score_s}, {n} show(s)]")

    print(f"\n  SQL — verify each line, then run in Supabase SQL editor:")
    print(f"  INSERT INTO venue_aliases (setlist_name, city, venue_id) VALUES")
    lines = [
        f"    ('{name.replace(chr(39), chr(39)*2)}', '{city}', {vid})"
        for name, (_, vid, _) in fuzzy_suggestions.items()
        if blocked_by_venue.get(name, 0) > 0
    ]
    print(",\n".join(lines) + "\n  ON CONFLICT DO NOTHING;")
    print(f"  Then re-run the script to insert the held shows.")


def _summary(
    parsed, duplicates, to_insert, error_rows,
    new_artists, genuinely_new, fuzzy_suggestions,
    inserted, fuzzy_blocked, dry_run,
) -> None:
    n_blocked  = sum(1 for s in to_insert if s["venue_name"] in fuzzy_suggestions)
    n_ready    = len(to_insert) - n_blocked
    note       = " (no DB writes)" if dry_run else ""
    print("\n" + "=" * 64)
    print(f"Summary{note}")
    print(f"  Finished:             {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Rows parsed:        {len(parsed):>8,}")
    print(f"  Duplicates skipped: {len(duplicates):>8,}")
    print(f"  Parse errors:       {len(error_rows):>8,}")
    if dry_run:
        print(f"  Ready to insert:    {n_ready:>8,}  shows")
        if n_blocked:
            print(f"  Alias-blocked:      {n_blocked:>8,}  shows  (add aliases, re-run)")
        print(f"  New artists:        {len(new_artists):>8,}")
        print(f"  New venues:         {len(genuinely_new):>8,}")
        if fuzzy_suggestions:
            print(f"  Aliases needed:     {len(fuzzy_suggestions):>8,}  venues")
        if n_ready > 0:
            print(f"\n  {n_ready:,} shows ready — run without --dry-run to apply.")
        if n_blocked:
            print(f"  {n_blocked} more shows once venue aliases are added.")
    else:
        print(f"  Inserted:           {inserted:>8,}  shows")
        if fuzzy_blocked:
            print(f"  Alias-blocked:      {len(fuzzy_blocked):>8,}  shows  (add aliases, re-run)")
        print(f"  Artists created:    {len(new_artists):>8,}")
        print(f"  Venues created:     {len(genuinely_new):>8,}")
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
    print("Grooveprint — Show Refresh  v2")
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
    parsed: list[dict]             = []
    error_rows: list[tuple]        = []
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
    existing_urls              = load_existing_urls()
    existing_artists           = load_existing_artists()
    existing_venues, name_map  = load_existing_venues()
    venue_aliases              = load_venue_aliases(args.city)

    # ── 3. Classify ──────────────────────────────────────────────────────────
    print("\nClassifying…")
    duplicates:        list[dict]       = []
    to_insert:         list[dict]       = []
    new_artist_names:  dict[str, None]  = {}
    genuinely_new:     dict[str, str]   = {}   # name → city  (auto-create)
    fuzzy_suggestions: dict[str, tuple] = {}   # name → (canonical, vid, score)  (block + suggest)

    for show in parsed:
        if show["setlist_url"] in existing_urls:
            duplicates.append(show)
            continue

        if show["artist_name"].lower() not in existing_artists:
            new_artist_names[show["artist_name"]] = None

        vkey     = show["venue_name"].lower()
        resolved = vkey in existing_venues or vkey in venue_aliases

        if not resolved and show["venue_name"] not in fuzzy_suggestions and show["venue_name"] not in genuinely_new:
            suggestion = find_fuzzy_match(show["venue_name"], existing_venues, name_map)
            if suggestion:
                fuzzy_suggestions[show["venue_name"]] = suggestion
            else:
                genuinely_new[show["venue_name"]] = show["city"]

        to_insert.append(show)

    n_blocked = sum(1 for s in to_insert if s["venue_name"] in fuzzy_suggestions)
    print(
        f"  {len(duplicates):,} duplicates  |  {len(to_insert):,} new  "
        f"|  {len(new_artist_names):,} new artists  "
        f"|  {len(genuinely_new):,} new venues  "
        f"|  {n_blocked} alias-blocked"
    )

    # Preview new shows
    MAX = 20
    if to_insert:
        print(f"\nNew shows (first {min(MAX, len(to_insert))} of {len(to_insert):,}):")
        for s in to_insert[:MAX]:
            flag = "  ⚠" if s["venue_name"] in fuzzy_suggestions else ""
            print(f"  {s['date']}  {s['artist_name']:<32}  {s['venue_name']}{flag}")
        if len(to_insert) > MAX:
            print(f"  … {len(to_insert) - MAX:,} more")

    if new_artist_names:
        print(f"\nNew artists ({len(new_artist_names)}):")
        for name in list(new_artist_names)[:MAX]:
            print(f"  + {name}")
        if len(new_artist_names) > MAX:
            print(f"  … {len(new_artist_names) - MAX} more")

    if genuinely_new:
        print(f"\nNew venues to auto-create ({len(genuinely_new)}):")
        for name in list(genuinely_new)[:MAX]:
            print(f"  + {name}")

    if fuzzy_suggestions:
        _print_alias_report(
            fuzzy_suggestions, to_insert, args.city,
            header="⚠️  Potential venue aliases — add to venue_aliases before running live",
        )

    # ── 4. Dry-run exit ───────────────────────────────────────────────────────
    if args.dry_run:
        _summary(parsed, duplicates, to_insert, error_rows,
                 new_artist_names, genuinely_new, fuzzy_suggestions,
                 inserted=0, fuzzy_blocked=[], dry_run=True)
        return

    n_ready = len(to_insert) - n_blocked
    if n_ready == 0:
        print("\nNothing ready to insert (all shows are duplicates or alias-blocked).")
        _summary(parsed, duplicates, to_insert, error_rows,
                 new_artist_names, genuinely_new, fuzzy_suggestions,
                 inserted=0, fuzzy_blocked=[], dry_run=False)
        return

    # ── 5. Apply ─────────────────────────────────────────────────────────────
    print("\nApplying changes…")

    if new_artist_names:
        print(f"  Creating {len(new_artist_names)} artist(s)…", end=" ", flush=True)
        new_artist_count = create_and_resolve(
            "dim_artist", [{"artist_name": n} for n in new_artist_names],
            "artist_name", "artist_id", existing_artists,
        )
        print(f"✅  {new_artist_count} created")

    if genuinely_new:
        print(f"  Creating {len(genuinely_new)} venue(s)…", end=" ", flush=True)
        new_venue_count = create_and_resolve(
            "dim_venue",
            [{"venue_name": n, "city": c, "status": "Open"} for n, c in genuinely_new.items()],
            "venue_name", "venue_id", existing_venues,
        )
        print(f"✅  {new_venue_count} created")

    show_records:  list[dict] = []
    unresolved:    list[dict] = []
    fuzzy_blocked: list[dict] = []

    for show in to_insert:
        if show["venue_name"] in fuzzy_suggestions:
            fuzzy_blocked.append(show)
            continue

        artist_id = existing_artists.get(show["artist_name"].lower())
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
        print(f"  Inserting {len(show_records):,} shows…", end=" ", flush=True)
        for i in range(0, len(show_records), BATCH_SIZE):
            sb_insert("fact_shows", show_records[i: i + BATCH_SIZE])
            inserted += min(BATCH_SIZE, len(show_records) - i)
        print(f"✅  {inserted:,} inserted")

    if fuzzy_blocked:
        _print_alias_report(
            fuzzy_suggestions, fuzzy_blocked, args.city,
            header="⚠️  Shows held pending venue aliases",
        )

    _summary(parsed, duplicates, to_insert, error_rows,
             new_artist_names, genuinely_new, fuzzy_suggestions,
             inserted=inserted, fuzzy_blocked=fuzzy_blocked, dry_run=False)


if __name__ == "__main__":
    main()
