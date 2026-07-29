#!/usr/bin/env python3
"""
Grooveprint — Show Refresh Script  v7
scripts/refresh_shows.py

Ingests a raw setlist.fm API export into Supabase.
Uses setlist_url as the deduplication key — existing shows are never overwritten.

Venue resolution chain:
  1. Exact match → dim_venue (name, city, state, country) composite key
  2. Exact match → venue_aliases table
  3. Fuzzy match  → interactive review (live) or blocked with SQL (--no-interactive)
  4. No match     → auto-create

  (GP-134: venue matching uses (name, city, state) composite key to prevent
   cross-city collisions — same venue name in different cities gets distinct venue_ids)
  (GP-136: extended to (name, city, state, country) 4-tuple to prevent collisions
   for European cities where stateCode is absent)

Artist resolution chain (no city dimension):
  1. Exact match → dim_artist.artist_name
  2. Exact match → artist_aliases table
  3. Fuzzy match  → interactive review or blocked
  4. No match     → auto-create (review_status = 'unverified')

Interactive review keys (live runs, per fuzzy suggestion):
  A  Alias     — same entity; writes alias to DB immediately
  N  New       — different entity; auto-creates this run
  S  Skip      — hold the show for later
  K  Keep all  — treat all remaining suggestions as New (no more prompts)

Venue-change reconciliation (SCRUM-68, post-insert pass):
  When setlist.fm corrects a venue on an existing show the URL changes, so our
  dedup key misses it and a new row is inserted.  After each live insert run,
  the script scans for (artist_id, date) collisions and prompts:
  A  Auto-reassign all user_shows + delete stale fact_shows rows
  S  Skip all  (leaves both rows; warns when user_shows are affected)
  1  Review pair-by-pair

Usage:
    pip install requests python-dotenv openpyxl

    python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --city Vancouver --state BC --country CA
    python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --city Vancouver --state BC --country CA --dry-run
    python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --city Vancouver --state BC --country CA --no-interactive

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
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
DEFAULT_CITY = os.getenv("REFRESH_CITY", "Vancouver")

BATCH_SIZE             = 500
VENUE_FUZZY_THRESHOLD  = 0.82
ARTIST_FUZZY_THRESHOLD = 0.96   # raised from 0.92 — 92-95% range still produced too many false positives
                                 # false positives (distinct artists) to review reliably

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


def sb_update(table: str, eq_filters: dict, data: dict) -> None:
    """PATCH rows matching eq_filters (values pre-formatted for PostgREST, e.g. 'eq.5')."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.patch(url, headers=_headers("return=minimal"), params=eq_filters, json=data)
    if not resp.ok:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text[:500]
        raise requests.exceptions.HTTPError(
            f"{resp.status_code} on PATCH {table}: {detail}", response=resp
        )


def sb_delete(table: str, eq_filters: dict) -> None:
    """DELETE rows matching eq_filters."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.delete(url, headers=_headers("return=minimal"), params=eq_filters)
    if not resp.ok:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text[:500]
        raise requests.exceptions.HTTPError(
            f"{resp.status_code} on DELETE {table}: {detail}", response=resp
        )


def get_max_id(table: str, id_col: str) -> int:
    rows = sb_get_page(table, {"select": id_col, "order": f"{id_col}.desc", "limit": "1"})
    if rows and rows[0].get(id_col) is not None:
        return int(rows[0][id_col])
    return 0


# ---------------------------------------------------------------------------
# Normalisation helpers (fuzzy matching only — never used for DB writes)
# ---------------------------------------------------------------------------

_VENUE_SUFFIXES = (
    " stadium", " arena", " theatre", " theater",
    " center", " centre", " hall", " club", " bar",
    " room", " lounge", " studio", " studios",
    " inc", " ltd", " co",
)


def normalize_venue(name: str) -> str:
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
    """Simpler than venue — strip 'The ' and punctuation only, no suffix stripping."""
    s = name.lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s.startswith("the "):
        s = s[4:]
    return s


def find_fuzzy_venue_match(
    name: str,
    id_map: dict[tuple, int],
    name_map: dict[tuple, str],
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
) -> Optional[tuple[str, int, float]]:
    """Fuzzy-match a venue name against existing venues.

    id_map and name_map are keyed by (name, city, state, country) tuples — all lowercase.
    City/state/country filtering uses the tuple key directly; no separate location_map needed.

    Candidates are restricted to the same city+state+country before scoring to prevent
    cross-city false positives (e.g. 'Royal Room, Seattle' matching 'The Royal,
    Vancouver', or 'The Edge, Vancouver BC' matching 'The Edge, Toronto ON').
    """
    norm = normalize_venue(name)
    if not norm:
        return None
    city_l    = (city    or "").lower()
    state_l   = (state   or "").lower()
    country_l = (country or "").lower()
    best_score, best_key = 0.0, None
    for key in id_map:
        key_name, key_city, key_state, key_country = key
        if city_l    and key_city    != city_l:
            continue
        if state_l   and key_state   != state_l:
            continue
        if country_l and key_country != country_l:
            continue
        nk = normalize_venue(key_name)
        if norm == nk:
            return (name_map[key], id_map[key], 1.0)
        s = difflib.SequenceMatcher(None, norm, nk).ratio()
        if s > best_score:
            best_score, best_key = s, key
    if best_key and best_score >= VENUE_FUZZY_THRESHOLD:
        return (name_map[best_key], id_map[best_key], best_score)
    return None


def find_fuzzy_artist_match(
    name: str, id_map: dict[str, int], name_map: dict[str, str],
) -> Optional[tuple[str, int, float]]:
    norm = normalize_artist(name)
    if not norm:
        return None
    best_score, best_key = 0.0, None
    for key in id_map:
        nk = normalize_artist(key)
        if norm == nk:
            return (name_map[key], id_map[key], 1.0)
        s = difflib.SequenceMatcher(None, norm, nk).ratio()
        if s > best_score:
            best_score, best_key = s, key
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


def extract_venue_info(venue_full: str) -> tuple[str, str, str, str]:
    """Returns (venue_name, city, state, country) from a setlist.fm location string.

    API format: "Venue Name, City, State, Country"  (4 parts)
    Octoparse:  "Venue Name, City, State, Country"  (same)
    Older/short:"Venue Name, City"                  (2 parts, no state/country)
    """
    venue_full = (venue_full or "").strip()
    if not venue_full:
        return "", "", "", ""
    parts = [p.strip() for p in venue_full.split(", ")]
    if len(parts) >= 4:
        country = parts[-1]
        state   = parts[-2]
        city    = parts[-3]
        name    = ", ".join(parts[:-3])
        return name, city, state, country
    if len(parts) == 3:
        last = parts[-1]
        # If last part is a 2-letter state/province code (e.g. "WA", "ON"), country is absent
        if len(last) == 2 and last.upper() == last and last.isalpha():
            return parts[0], parts[1], last, ""
        # Otherwise treat as "Venue, City, Country" with no state
        return parts[0], parts[1], "", last
    if len(parts) == 2:
        return parts[0], parts[1], "", ""
    return venue_full, "", "", ""


def parse_row(
    row: dict,
    city: str    = "",
    state: str   = "",
    country: str = "",
) -> Optional[dict]:
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
    venue_name, venue_city, venue_state, venue_country = extract_venue_info(venue_full)
    # GP-169: setlist.fm uses "Private Venue" as its placeholder name when a show's
    # location is unlisted. Grooveprint's canonical label is "Unknown Venue" — normalize
    # at parse time (the single point every source — API fetch or Octoparse — flows
    # through) so this never needs a manual per-city SQL rename again.
    if venue_name.strip().lower() == "private venue":
        venue_name = "Unknown Venue"
    # Guard: if the parsed city field looks like a 2-letter state/province code
    # (e.g. "TX", "CA", "ON"), extract_venue_info miscategorized a 3-part venue string
    # where the city name was used as the venue name and the state code landed in the
    # city slot (e.g. "Austin, TX, United States" → venue="Austin", city="TX").
    # Normalize to Unknown Venue and clear city so the script-level city default applies.
    if (venue_city
            and len(venue_city) == 2
            and venue_city.upper() == venue_city
            and venue_city.isalpha()):
        venue_name = "Unknown Venue"
        venue_city = ""
    if not venue_city:
        venue_city = city
    if not venue_state:
        venue_state = state
    if not venue_country:
        venue_country = country
    if not venue_name:
        return None
    tour_name = (row.get("tour_name") or "").strip() or None
    # GP-172: pass artist_mbid through from the CSV so the classification loop
    # can attempt an exact MBID lookup before fuzzy name matching. Empty string
    # for old CSVs that predate this column — falls through to name resolution.
    artist_mbid = (row.get("artist_mbid") or "").strip()
    return {
        "setlist_url": setlist_url,
        "date":        date,
        "artist_name": artist_name,
        "artist_mbid": artist_mbid,
        "venue_name":  venue_name,
        "show_type":   "music",
        "city":        venue_city,
        "state":       venue_state,
        "country":     venue_country,
        "tour_name":   tour_name,
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

def load_existing_urls(input_urls: set[str]) -> set[str]:
    """Check which of the input_urls already exist in fact_shows.

    Scoped to the input batch — avoids loading the full fact_shows table via
    offset pagination, which becomes unreliable at 300k+ rows and can produce
    truncated snapshots that cause duplicate inserts (GP-157).
    """
    print("  Existing shows …", end=" ", flush=True)
    if not input_urls:
        print("0")
        return set()

    CHUNK = 50          # 50 URLs × ~80 chars ≈ 4 KB per request, well under limits
    url_list = list(input_urls)
    found: set[str] = set()

    for i in range(0, len(url_list), CHUNK):
        chunk = url_list[i : i + CHUNK]
        rows = sb_get_page("fact_shows", {
            "select":      "setlist_url",
            "setlist_url": "in.(" + ",".join(chunk) + ")",
        })
        for r in rows:
            if r.get("setlist_url"):
                found.add(r["setlist_url"])

    print(f"{len(found):,}  (checked {len(input_urls):,} input URLs against DB)")
    return found


def load_existing_artists() -> tuple[dict[str, int], dict[str, str], dict[str, int]]:
    """Return (name→id map, name→canonical_name map, mbid→id map).

    The mbid map enables GP-172: exact MBID lookup against dim_artist before
    falling back to fuzzy name matching, eliminating alias review noise for
    any artist already enriched via MusicBrainz.
    """
    print("  Existing artists …", end=" ", flush=True)
    rows = sb_get_all("dim_artist", {"select": "artist_id,artist_name,musicbrainz_artist_id"})
    id_map:   dict[str, int] = {}
    name_map: dict[str, str] = {}
    mbid_map: dict[str, int] = {}
    for r in rows:
        if r.get("artist_name"):
            k = r["artist_name"].lower()
            id_map[k]   = r["artist_id"]
            name_map[k] = r["artist_name"]
        if r.get("musicbrainz_artist_id"):
            mbid_map[r["musicbrainz_artist_id"]] = r["artist_id"]
    print(f"{len(id_map):,}")
    return id_map, name_map, mbid_map


def load_existing_venues() -> tuple[dict[tuple, int], dict[tuple, str], dict[str, tuple]]:
    """Load dim_venue into (name, city, state, country) tuple-keyed dicts.

    GP-134: composite (name, city, state) key prevents cross-city venue collisions.
    GP-136: extended to (name, city, state, country) 4-tuple to prevent collisions
    for European cities where stateCode is absent — e.g. 'The Roundhouse' in London
    vs 'The Roundhouse' in another country with no stateCode both map to the same
    3-tuple without this fix.

    Returns:
        id_map:       (name, city, state, country) → venue_id
        name_map:     (name, city, state, country) → canonical_name
        location_map: canonical_name.lower() → (city, state, country)
                      (string-keyed; used only for display in alias review prompts)

    other_names (historical renames at the same location) share the venue's
    city/state/country and are indexed under the same tuple structure.

    Future: add UNIQUE(venue_name, city, state, country) constraint to dim_venue to make
    the DB enforce this composite key at the storage layer (GP-136 follow-up).
    """
    print("  Existing venues …", end=" ", flush=True)
    rows = sb_get_all("dim_venue", {"select": "venue_id,venue_name,other_names,city,state,country"})
    id_map:       dict[tuple, int]   = {}
    name_map:     dict[tuple, str]   = {}
    location_map: dict[str,  tuple]  = {}   # canonical/alt name → (city, state, country) for display
    for r in rows:
        if not r.get("venue_name"):
            continue
        canonical = r["venue_name"]
        vid       = r["venue_id"]
        city_l    = (r.get("city")    or "").lower()
        state_l   = (r.get("state")   or "").lower()
        country_l = (r.get("country") or "").lower()
        vloc      = (r.get("city") or "", r.get("state") or "", r.get("country") or "")

        ckey = (canonical.lower(), city_l, state_l, country_l)
        id_map[ckey]                    = vid
        name_map[ckey]                  = canonical
        location_map[canonical.lower()] = vloc

        for alt in (r.get("other_names") or "").split(","):
            alt = alt.strip()
            if len(alt) >= 4:
                akey = (alt.lower(), city_l, state_l, country_l)
                id_map[akey]              = vid
                name_map[akey]            = canonical
                location_map[alt.lower()] = vloc

    print(f"{len(id_map):,}  ({len(rows):,} venues + other_names)")
    return id_map, name_map, location_map


def load_artist_aliases() -> dict[str, int]:
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


def load_venue_aliases(city: str, state: str, country: str) -> dict[str, int]:
    """Load venue aliases for the current city — string-keyed by setlist_name.lower().

    venue_aliases is already scoped to (city, state, country) in the DB, so
    name-only keys are safe here — aliases for 'The Hideout' in Seattle will
    never be returned when ingesting Toronto shows.
    """
    print("  Venue aliases …", end=" ", flush=True)
    try:
        rows = sb_get_page("venue_aliases", {
            "select":  "setlist_name,venue_id",
            "city":    f"eq.{city}",
            "state":   f"eq.{state}",
            "country": f"eq.{country}",
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
    id_map: dict,
    key_fields: Optional[list[str]] = None,
) -> int:
    """Insert `records` into `table` (ignoring duplicates) and populate `id_map`.

    By default id_map is keyed by name_key.lower() — correct for artists, whose
    name is globally unique. Venues are NOT globally unique (e.g. "Private Venue"
    exists in 16+ cities), so venue callers pass
    key_fields=["venue_name", "city", "state", "country"] to key id_map by the same
    composite tuple used everywhere else for venue lookups (GP-169). This lets
    multiple same-named venues in different cities all resolve correctly within a
    single run, instead of colliding on a name-only key.
    """
    def make_key(row: dict):
        if key_fields:
            return tuple((row.get(f) or "").lower() for f in key_fields)
        return (row.get(name_key) or "").lower()

    select_fields = f"{id_key},{name_key}"
    if key_fields:
        extra = [f for f in key_fields if f != name_key]
        if extra:
            select_fields += "," + ",".join(extra)

    created = 0
    for i in range(0, len(records), BATCH_SIZE):
        chunk    = records[i: i + BATCH_SIZE]
        returned = sb_insert(table, chunk, return_rows=True)
        for row in returned:
            rid = row.get(id_key)
            key = make_key(row)
            if rid and key:
                id_map[key] = rid
                created += 1

    missing = [r for r in records if make_key(r) not in id_map]
    for r in missing:
        filters = {"select": select_fields, f"{name_key}": f"ilike.{r[name_key]}"}
        if key_fields:
            for f in key_fields:
                if f != name_key and r.get(f):
                    filters[f] = f"eq.{r[f]}"
        rows = sb_get_page(table, filters)
        for row in rows:
            if row.get(name_key) and row.get(id_key):
                id_map[make_key(row)] = row[id_key]
    return created


# ---------------------------------------------------------------------------
# City dimension (GP-153) — resolve (city, state, country) → dim_city.city_id
# ---------------------------------------------------------------------------

# setlist.fm 4-part location strings yield full country names ("Canada",
# "United States"), but parse_row falls back to the --country arg ("CA"/"US")
# whenever a location string omits the country. dim_city is seeded with the full
# names, so normalize before lookup/insert — otherwise an edge-case venue would
# mint a duplicate city row, e.g. ('Vancouver','BC','CA') beside the canonical
# ('Vancouver','BC','Canada'). State codes (BC/WA/ON) already match both sides.
_COUNTRY_CANON = {
    "ca": "Canada", "can": "Canada", "canada": "Canada",
    "us": "United States", "usa": "United States",
    "united states": "United States",
    "united states of america": "United States",
}


def _canon_country(country: str) -> str:
    c = (country or "").strip()
    return _COUNTRY_CANON.get(c.lower(), c)


# Run-scoped cache: a single-city ingestion touches one (city,state,country)
# tuple (plus the odd secondary), so this collapses to ~1 dim_city read per run.
_city_id_cache: dict[tuple, int] = {}


def get_or_create_city_id(city: str, state: str, country: str) -> Optional[int]:
    """Resolve (city, state, country) → dim_city.city_id, creating the row if absent.

    Country is normalized to dim_city's canonical full-name form before lookup so
    the --country arg fallback ('CA'/'US') can't spawn duplicate city rows. New
    rows are created with NULL coordinates — Nominatim backfills them later (Phase
    4); until then the city simply has no map bubble, which is acceptable.

    Returns None when city is blank (e.g. state-abbrev-as-city junk rows), leaving
    the venue's city_id NULL — matching the Phase 2 backfill, which left exactly
    those rows unmatched.
    """
    city = (city or "").strip()
    if not city:
        return None
    state   = (state or "").strip()
    country = _canon_country(country)
    key = (city.lower(), state.lower(), country.lower())
    if key in _city_id_cache:
        return _city_id_cache[key]

    rows = sb_get_page("dim_city", {
        "select":  "city_id",
        "city":    f"eq.{city}",
        "state":   f"eq.{state}",
        "country": f"eq.{country}",
    })
    if rows:
        cid = rows[0]["city_id"]
    else:
        created = sb_insert(
            "dim_city",
            [{"city": city, "state": state, "country": country}],
            return_rows=True,
        )
        cid = created[0]["city_id"] if created else None

    if cid is not None:
        _city_id_cache[key] = cid
    return cid


# ---------------------------------------------------------------------------
# Interactive alias review
# ---------------------------------------------------------------------------

def interactive_alias_review(
    fuzzy_suggestions: dict,
    shows_list: list[dict],
    show_match_key: str,
    context_key: str,
    table: str,
    id_col: str,
    alias_map: dict[str, int],
    genuinely_new: dict,
    label: str,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    venue_location_map: Optional[dict[str, tuple]] = None,
) -> None:
    """
    Interactive review for each fuzzy suggestion. Prompts user for each:

      A  Alias    — same entity; writes to alias table immediately
      N  New      — different entity; auto-creates this run
      S  Skip     — hold the show (can re-run later after manual check)
      K  Keep all — treat all remaining suggestions as New (no more prompts)
    """
    if not fuzzy_suggestions:
        return

    total = len(fuzzy_suggestions)
    print(f"\n{'─' * 64}")
    print(f"⚠️  {label} alias review — {total} to verify")
    print(f"    A = same entity (alias)  |  N = different (new)  |  S = skip  |  K = keep all as new")
    print(f"{'─' * 64}")

    for i, input_name in enumerate(list(fuzzy_suggestions.keys())):
        if input_name not in fuzzy_suggestions:
            continue

        canonical, rid, score = fuzzy_suggestions[input_name]
        score_s = "exact (normalised)" if score == 1.0 else f"{score:.0%} similarity"
        loc     = venue_location_map.get(canonical.lower(), ("", "", "")) if venue_location_map else ("", "", "")
        loc_label = f" [{loc[0]}, {loc[1]}]" if (loc[0] or loc[1]) else ""

        blocked = [s for s in shows_list if s[show_match_key] == input_name]

        print(f"\n{i+1}/{total}  '{input_name}'  →  '{canonical}'{loc_label}  [{score_s}]")
        for show in blocked[:3]:
            context = show.get(context_key, "")
            print(f"       {show['date']}  {'@ ' + context if context else ''}")
        if len(blocked) > 3:
            print(f"       … {len(blocked) - 3} more show(s)")

        while True:
            try:
                choice = input("  [A]lias / [N]ew / [S]kip / [K]eep all as new: ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print("\n  Interrupted — remaining suggestions held.")
                return

            if choice in ("a", "alias"):
                record = {"setlist_name": input_name, id_col: rid}
                if city:
                    record["city"]    = city
                    record["state"]   = state or ""
                    record["country"] = country or ""
                try:
                    sb_insert(table, [record])
                    alias_map[input_name.lower()] = rid
                    del fuzzy_suggestions[input_name]
                    print(f"  ✅  Alias saved: '{input_name}' → '{canonical}'")
                except Exception as e:
                    print(f"  ⚠️   Could not save alias ({e}) — treating as Skip")
                break

            elif choice in ("n", "new"):
                del fuzzy_suggestions[input_name]
                if city is None:
                    genuinely_new[input_name] = None
                else:
                    src = blocked[0] if blocked else {}
                    v_city    = src.get("city", city)
                    v_state   = src.get("state", state or "")
                    v_country = src.get("country", country or "")
                    vtkey = (input_name.lower(), (v_city or "").lower(), (v_state or "").lower(), (v_country or "").lower())
                    genuinely_new[vtkey] = {
                        "name":    input_name,
                        "city":    v_city,
                        "state":   v_state,
                        "country": v_country,
                    }
                print(f"  →  Will create '{input_name}' as new {label.lower()} this run")
                break

            elif choice in ("s", "skip"):
                print(f"  →  '{input_name}' held — show(s) will not be inserted this run")
                break

            elif choice in ("k", "keep"):
                remaining = list(fuzzy_suggestions.keys())
                for name in remaining:
                    can, rid2, _ = fuzzy_suggestions.pop(name)
                    if city is None:
                        genuinely_new[name] = None
                    else:
                        b = next((s for s in shows_list if s[show_match_key] == name), None)
                        v_city    = b["city"]    if b else city
                        v_state   = b["state"]   if b else (state or "")
                        v_country = b["country"] if b else (country or "")
                        vtkey = (name.lower(), (v_city or "").lower(), (v_state or "").lower(), (v_country or "").lower())
                        genuinely_new[vtkey] = {
                            "name":    name,
                            "city":    v_city,
                            "state":   v_state,
                            "country": v_country,
                        }
                print(f"  →  All {len(remaining)} remaining marked as new {label.lower()}(s)")
                return

            else:
                print("  Please enter A, N, S, or K")


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------

def _print_alias_report(
    suggestions: dict,
    shows_list: list[dict],
    show_match_key: str,
    table: str,
    id_col: str,
    header: str,
    city: Optional[str] = None,
    state: Optional[str] = None,
    country: Optional[str] = None,
    venue_location_map: Optional[dict[str, tuple]] = None,
) -> None:
    """Non-interactive alias report (dry-run or --no-interactive)."""
    if not suggestions:
        return

    blocked_by_name: dict[str, int] = {}
    for s in shows_list:
        if s[show_match_key] in suggestions:
            blocked_by_name[s[show_match_key]] = blocked_by_name.get(s[show_match_key], 0) + 1

    print(f"\n{header} ({len(suggestions)}):")
    for input_name, (canonical, rid, score) in suggestions.items():
        n         = blocked_by_name.get(input_name, 0)
        score_s   = "exact (normalised)" if score == 1.0 else f"{score:.0%} similarity"
        loc       = venue_location_map.get(canonical.lower(), ("", "", "")) if venue_location_map else ("", "", "")
        loc_label = f" [{loc[0]}, {loc[1]}]" if (loc[0] or loc[1]) else ""
        print(f"  '{input_name}'  →  '{canonical}'{loc_label}  [{score_s}, {n} show(s)]")

    print(f"\n  SQL — verify each line, then run in Supabase SQL editor:")
    if city:
        print(f"  INSERT INTO {table} (setlist_name, city, state, country, {id_col}) VALUES")
        lines = [
            f"    ('{n.replace(chr(39), chr(39)*2)}', '{city}', '{state or ''}', '{country or ''}', {rid})"
            for n, (_, rid, _) in suggestions.items() if blocked_by_name.get(n, 0) > 0
        ]
    else:
        print(f"  INSERT INTO {table} (setlist_name, {id_col}) VALUES")
        lines = [
            f"    ('{n.replace(chr(39), chr(39)*2)}', {rid})"
            for n, (_, rid, _) in suggestions.items() if blocked_by_name.get(n, 0) > 0
        ]
    print(",\n".join(lines) + "\n  ON CONFLICT DO NOTHING;")
    print(f"  Then re-run the script to insert the held shows.")


def _n_blocked(to_insert, fuzzy_artist, fuzzy_venue) -> int:
    return sum(
        1 for s in to_insert
        if s["artist_name"] in fuzzy_artist or s["venue_name"] in fuzzy_venue
    )


def _summary(
    parsed, duplicates, to_insert, error_rows,
    genuinely_new_artists, genuinely_new_venues,
    fuzzy_artist_suggestions, fuzzy_venue_suggestions,
    inserted, fuzzy_blocked, dry_run,
    mbid_resolved_count: int = 0,
) -> None:
    nb            = _n_blocked(to_insert, fuzzy_artist_suggestions, fuzzy_venue_suggestions)
    n_artist_b    = sum(1 for s in to_insert if s["artist_name"] in fuzzy_artist_suggestions)
    n_venue_b     = sum(1 for s in to_insert if s["venue_name"]  in fuzzy_venue_suggestions)
    n_ready       = len(to_insert) - nb
    note          = " (no DB writes)" if dry_run else ""
    verb          = "Ready to insert" if dry_run else "Inserted      "

    print("\n" + "=" * 64)
    print(f"Summary{note}")
    print(f"  Finished:             {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Rows parsed:        {len(parsed):>8,}")
    print(f"  Duplicates skipped: {len(duplicates):>8,}")
    print(f"  Parse errors:       {len(error_rows):>8,}")
    print(f"  {verb}:     {(n_ready if dry_run else inserted):>8,}  shows")
    if nb:
        print(f"  Alias-blocked:      {nb:>8,}  shows  (add aliases, re-run)")
        if n_artist_b: print(f"    ↳ artist:         {n_artist_b:>8,}")
        if n_venue_b:  print(f"    ↳ venue:          {n_venue_b:>8,}")
    print(f"  New artists:        {len(genuinely_new_artists):>8,}")
    print(f"  New venues:         {len(genuinely_new_venues):>8,}")
    if mbid_resolved_count:
        print(f"  MBID-resolved:      {mbid_resolved_count:>8,}  artists bypassed fuzzy review (GP-172)")
    if fuzzy_artist_suggestions:
        print(f"  Artist aliases:     {len(fuzzy_artist_suggestions):>8,}  still pending")
    if fuzzy_venue_suggestions:
        print(f"  Venue aliases:      {len(fuzzy_venue_suggestions):>8,}  still pending")
    if dry_run:
        if n_ready > 0:
            print(f"\n  {n_ready:,} shows ready — run without --dry-run to apply.")
        if nb:
            print(f"  {nb} more shows once aliases are resolved.")
    elif fuzzy_blocked:
        print(f"\n  {len(fuzzy_blocked)} held shows — re-run to review and insert them.")
    print("=" * 64)


# ---------------------------------------------------------------------------
# Venue-change detection & reconciliation  (SCRUM-68)
# ---------------------------------------------------------------------------

def _build_reverse_maps(
    existing_artists: dict[str, int],
    artist_name_map:  dict[str, str],
    existing_venues:  dict[tuple, int],   # tuple-keyed (name, city, state, country)
    venue_name_map:   dict[tuple, str],   # tuple-keyed (name, city, state, country)
) -> tuple[dict[int, str], dict[int, str]]:
    """Invert the name→id maps so IDs can be displayed as names."""
    artist_id_to_name: dict[int, str] = {}
    for key, aid in existing_artists.items():
        if key in artist_name_map:
            artist_id_to_name.setdefault(aid, artist_name_map[key])

    venue_id_to_name: dict[int, str] = {}
    for key, vid in existing_venues.items():
        if key in venue_name_map:
            venue_id_to_name.setdefault(vid, venue_name_map[key])

    return artist_id_to_name, venue_id_to_name


def detect_venue_changes(
    show_records:      list[dict],
    venue_id_to_name:  dict[int, str],
    artist_id_to_name: dict[int, str],
) -> list[dict]:
    if not show_records:
        return []

    new_show_ids: set[int] = {r["show_id"] for r in show_records}

    new_by_key: dict[tuple, dict] = {}
    for r in show_records:
        new_by_key[(r["artist_id"], r["date"])] = r

    unique_artist_ids = list({r["artist_id"] for r in show_records})

    all_existing: list[dict] = []
    ID_BATCH = 50
    for i in range(0, len(unique_artist_ids), ID_BATCH):
        ids_str = ",".join(str(x) for x in unique_artist_ids[i: i + ID_BATCH])
        rows = sb_get_all(
            "fact_shows",
            {
                "select":    "show_id,artist_id,date,venue_id,setlist_url",
                "artist_id": f"in.({ids_str})",
            },
        )
        all_existing.extend(rows)

    by_key: dict[tuple, list] = defaultdict(list)
    for row in all_existing:
        by_key[(row["artist_id"], row["date"])].append(row)

    pairs: list[dict] = []
    for key, rows_for_key in by_key.items():
        if key not in new_by_key:
            continue
        new_r = new_by_key[key]
        for old_r in rows_for_key:
            if old_r["show_id"] in new_show_ids:
                continue
            if old_r["venue_id"] == new_r["venue_id"]:
                continue
            # Different URLs = different shows on the same date, not a venue change
            if old_r.get("setlist_url") != new_r.get("setlist_url"):
                continue
            pairs.append({
                "old_show_id":    old_r["show_id"],
                "new_show_id":    new_r["show_id"],
                "artist_id":      new_r["artist_id"],
                "date":           new_r["date"],
                "old_venue_id":   old_r["venue_id"],
                "new_venue_id":   new_r["venue_id"],
                "old_venue_name": venue_id_to_name.get(
                    old_r["venue_id"], f"venue_id={old_r['venue_id']}"),
                "new_venue_name": venue_id_to_name.get(
                    new_r["venue_id"], f"venue_id={new_r['venue_id']}"),
                "artist_name":    artist_id_to_name.get(
                    new_r["artist_id"], f"artist_id={new_r['artist_id']}"),
                "old_url":        old_r.get("setlist_url") or "",
            })

    return pairs


def _reconcile_pair(pair: dict) -> bool:
    old_id = pair["old_show_id"]
    new_id = pair["new_show_id"]

    if pair.get("user_shows_count", 0) > 0:
        print(
            f"  Reassigning {pair['user_shows_count']} user_shows row(s): "
            f"show_id {old_id} → {new_id} … ",
            end="", flush=True,
        )
        try:
            sb_update("user_shows", {"show_id": f"eq.{old_id}"}, {"show_id": new_id})
            print("✅")
        except Exception as ex:
            print(f"❌  UPDATE failed: {ex}")
            print(f"  ⚠️  Aborting delete — stale row show_id={old_id} left intact.")
            print(f"  ⚠️  Manual cleanup:")
            print(f"       DELETE FROM user_shows WHERE show_id = {old_id};")
            print(f"       DELETE FROM fact_shows  WHERE show_id = {old_id};")
            return False

    print(
        f"  Deleting stale fact_shows row: show_id={old_id} "
        f"({pair['artist_name']}, {pair['date']}, {pair['old_venue_name']}) … ",
        end="", flush=True,
    )
    try:
        sb_delete("fact_shows", {"show_id": f"eq.{old_id}"})
        print("✅")
        return True
    except Exception as ex:
        print(f"❌  DELETE failed: {ex}")
        if pair.get("user_shows_count", 0) > 0:
            print(
                f"  ⚠️  user_shows already reassigned — stale fact_shows row "
                f"show_id={old_id} remains but is no longer referenced."
            )
        return False


def _reconcile_individually(pairs: list[dict]) -> None:
    total = len(pairs)
    print(f"\n{'─' * 64}")
    for i, p in enumerate(pairs):
        impact = (
            f"{p['user_shows_count']} user_shows row(s) affected"
            if p["user_shows_count"] else "no user_shows affected"
        )
        print(f"\n{i + 1}/{total}  {p['artist_name']}  {p['date']}")
        print(f"       Old venue: {p['old_venue_name']}  (show_id={p['old_show_id']}, {impact})")
        print(f"       New venue: {p['new_venue_name']}  (show_id={p['new_show_id']})")

        while True:
            try:
                choice = input("  [A]uto-reconcile / [S]kip: ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print("\n  Interrupted — remaining pairs skipped.")
                return

            if choice in ("a", "auto"):
                _reconcile_pair(p)
                break
            elif choice in ("s", "skip"):
                print(f"  →  Skipped — both rows remain.")
                if p["user_shows_count"] > 0:
                    print(
                        f"  ⚠️  Manual cleanup needed: show_id={p['old_show_id']} "
                        f"still referenced by {p['user_shows_count']} user_shows row(s)."
                    )
                break
            else:
                print("  Please enter A or S")


def reconcile_venue_changes(pairs: list[dict], interactive: bool) -> None:
    if not pairs:
        return

    print("\nChecking user_shows references …", end=" ", flush=True)
    for p in pairs:
        rows = sb_get_all(
            "user_shows",
            {"show_id": f"eq.{p['old_show_id']}", "select": "user_id"},
        )
        p["user_shows_count"] = len(rows)
    pairs.sort(key=lambda x: -x["user_shows_count"])
    print("done")

    print(f"\n{'─' * 64}")
    print(f"⚠️  Possible venue changes detected — {len(pairs)} pair(s) to review")
    print(f"{'─' * 64}")
    for p in pairs:
        impact = (
            f"[{p['user_shows_count']} user_shows affected]"
            if p["user_shows_count"] else "[0 user_shows]"
        )
        print(
            f"  {p['artist_name']:<30}  {p['date']}  "
            f"{p['old_venue_name']}  →  {p['new_venue_name']}  {impact}"
        )

    if not interactive:
        print(
            f"\n  Non-interactive mode — all {len(pairs)} pair(s) skipped."
            f"\n  ⚠️  Both old and new fact_shows rows remain — manual cleanup needed."
        )
        for p in pairs:
            print(
                f"     old show_id={p['old_show_id']}  new show_id={p['new_show_id']}"
                f"  ({p['artist_name']}, {p['date']})"
            )
        print(f"\n  Re-run interactively or execute in Supabase SQL editor:")
        for p in pairs:
            print(
                f"  -- {p['artist_name']} {p['date']}: "
                f"{p['old_venue_name']} → {p['new_venue_name']}"
            )
            if p["user_shows_count"] > 0:
                print(
                    f"  UPDATE user_shows SET show_id = {p['new_show_id']}"
                    f" WHERE show_id = {p['old_show_id']};"
                )
            print(f"  DELETE FROM fact_shows WHERE show_id = {p['old_show_id']};")
        return

    print(f"\n  [A]uto-reassign all user_shows + delete all stale rows")
    print(f"  [S]kip all  (leaves both rows; warns on user_shows impact)")
    print(f"  [1]  Review pair-by-pair")
    while True:
        try:
            choice = input("\n  Your choice [A / S / 1]: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  Interrupted — all pairs skipped.")
            return

        if choice in ("a", "auto"):
            print()
            ok = sum(1 for p in pairs if _reconcile_pair(p))
            print(f"\n✅  Reconciled {ok}/{len(pairs)} pair(s).")
            return
        elif choice in ("s", "skip"):
            print(f"  →  All {len(pairs)} pair(s) skipped — both rows remain.")
            for p in pairs:
                if p["user_shows_count"] > 0:
                    print(
                        f"  ⚠️  Manual cleanup needed: show_id={p['old_show_id']}"
                        f" still referenced by {p['user_shows_count']} user_shows row(s)."
                    )
            return
        elif choice in ("1", "individual"):
            _reconcile_individually(pairs)
            return
        else:
            print("  Please enter A, S, or 1")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Ingest raw setlist.fm export into Grooveprint Supabase.",
    )
    ap.add_argument("--input",          required=True, help="Path to .csv, .tsv, or .xlsx")
    ap.add_argument("--dry-run",        action="store_true", help="Report without writing to DB")
    ap.add_argument("--no-interactive", action="store_true",
                    help="Skip interactive review; block and print SQL instead (for automation)")
    ap.add_argument("--city",           required=True,
                    help="Target city (e.g. Vancouver, Seattle)")
    ap.add_argument("--state",          required=True,
                    help="State/province code (e.g. BC, WA, ON)")
    ap.add_argument("--country",        required=True,
                    help="Full country name (e.g. Canada, 'United States')")
    args = ap.parse_args()

    # Expand ISO country codes to full names used in setlist.fm venue strings
    _COUNTRY_CODES = {"CA": "Canada", "US": "United States", "AU": "Australia", "UK": "United Kingdom"}
    args.country = _COUNTRY_CODES.get(args.country.upper(), args.country)

    interactive = (
        not args.dry_run
        and not args.no_interactive
        and sys.stdin.isatty()
    )

    print("=" * 64)
    print("Grooveprint — Show Refresh  v7")
    print(f"Started:  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Input:    {args.input}")
    print(f"Location: {args.city}, {args.state}, {args.country}")
    mode = "DRY RUN" if args.dry_run else ("LIVE + interactive review" if interactive else "LIVE (non-interactive)")
    print(f"Mode:     {mode}")
    print("=" * 64)

    # ── 1. Load & parse ──────────────────────────────────────────────────────
    print("\nLoading input file…")
    raw_rows = load_file(args.input)
    print(f"  {len(raw_rows):,} raw rows read")

    print("\nParsing rows…")
    parsed:    list[dict]   = []
    error_rows: list[tuple] = []
    for idx, raw in enumerate(raw_rows):
        show = parse_row(raw, city=args.city, state=args.state, country=args.country)
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
    input_urls    = {s["setlist_url"] for s in parsed if s.get("setlist_url")}
    existing_urls                                         = load_existing_urls(input_urls)
    existing_artists, artist_name_map, artist_mbid_map       = load_existing_artists()
    existing_venues,  venue_name_map, venue_location_map = load_existing_venues()
    artist_aliases                                        = load_artist_aliases()
    venue_aliases                                         = load_venue_aliases(args.city, args.state, args.country)

    # ── 3. Classify ──────────────────────────────────────────────────────────
    print("\nClassifying…")

    duplicates:               list[dict]        = []
    to_insert:                list[dict]        = []
    genuinely_new_artists:    dict[str, None]   = {}
    genuinely_new_venues:     dict[tuple, dict] = {}
    fuzzy_artist_suggestions: dict[str, tuple]  = {}
    fuzzy_venue_suggestions:  dict[str, tuple]  = {}
    mbid_resolved_count:      int               = 0   # GP-172: artists resolved by MBID

    for show in parsed:
        if show["setlist_url"] in existing_urls:
            duplicates.append(show)
            continue

        # ── Artist resolution (name-only; artists are global) ─────────────
        akey         = show["artist_name"].lower()
        artist_mbid  = show.get("artist_mbid", "")
        # GP-172: exact MBID lookup before name/alias/fuzzy.  When the CSV carries
        # an MBID and that MBID is already in dim_artist (from a prior MB enrichment
        # run), the show is immediately resolved — no fuzzy review needed, even if
        # setlist.fm spelled the name differently from our canonical row.
        a_name_resolved = akey in existing_artists or akey in artist_aliases
        a_mbid_resolved = bool(artist_mbid) and artist_mbid in artist_mbid_map
        a_resolved      = a_name_resolved or a_mbid_resolved
        if a_mbid_resolved and not a_name_resolved:
            mbid_resolved_count += 1
        if not a_resolved and show["artist_name"] not in fuzzy_artist_suggestions \
                          and show["artist_name"] not in genuinely_new_artists:
            s = find_fuzzy_artist_match(show["artist_name"], existing_artists, artist_name_map)
            if s:
                fuzzy_artist_suggestions[show["artist_name"]] = s
            else:
                genuinely_new_artists[show["artist_name"]] = None

        # ── Venue resolution — composite (name, city, state, country) key (GP-136) ─
        vtkey      = (
            show["venue_name"].lower(),
            (show.get("city")    or "").lower(),
            (show.get("state")   or "").lower(),
            (show.get("country") or "").lower(),
        )
        v_resolved = vtkey in existing_venues or show["venue_name"].lower() in venue_aliases
        if not v_resolved and show["venue_name"] not in fuzzy_venue_suggestions \
                          and vtkey not in genuinely_new_venues:
            s = find_fuzzy_venue_match(
                show["venue_name"], existing_venues, venue_name_map,
                show.get("city"), show.get("state"), show.get("country"),
            )
            if s:
                fuzzy_venue_suggestions[show["venue_name"]] = s
            else:
                genuinely_new_venues[vtkey] = {
                    "name":    show["venue_name"],
                    "city":    show.get("city",    ""),
                    "state":   show.get("state",   ""),
                    "country": show.get("country", ""),
                }

        to_insert.append(show)

    nb = _n_blocked(to_insert, fuzzy_artist_suggestions, fuzzy_venue_suggestions)
    print(
        f"  {len(duplicates):,} duplicates  |  {len(to_insert):,} new  "
        f"|  {len(genuinely_new_artists):,} new artists  "
        f"|  {len(genuinely_new_venues):,} new venues  "
        f"|  {nb} alias-blocked"
    )

    # ── 4. Preview ────────────────────────────────────────────────────────────
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
        for vtkey, loc in list(genuinely_new_venues.items())[:MAX]:
            print(f"  + {loc['name']}  [{loc.get('city')}, {loc.get('state')}]")

    # ── 5. Alias resolution ───────────────────────────────────────────────────
    if args.dry_run:
        _print_alias_report(
            fuzzy_artist_suggestions, to_insert, "artist_name",
            "artist_aliases", "artist_id",
            header="⚠️  Potential artist aliases",
            city=None,
        )
        _print_alias_report(
            fuzzy_venue_suggestions, to_insert, "venue_name",
            "venue_aliases", "venue_id",
            header="⚠️  Potential venue aliases",
            city=args.city, state=args.state, country=args.country,
            venue_location_map=venue_location_map,
        )
        _summary(
            parsed, duplicates, to_insert, error_rows,
            genuinely_new_artists, genuinely_new_venues,
            fuzzy_artist_suggestions, fuzzy_venue_suggestions,
            inserted=0, fuzzy_blocked=[], dry_run=True,
            mbid_resolved_count=mbid_resolved_count,
        )
        print(
            "\n  📝  Venue-change detection runs after a live insert (not in --dry-run mode)."
        )
        return

    if interactive and (fuzzy_artist_suggestions or fuzzy_venue_suggestions):
        interactive_alias_review(
            fuzzy_artist_suggestions, to_insert,
            "artist_name", "venue_name",
            "artist_aliases", "artist_id",
            artist_aliases, genuinely_new_artists,
            label="Artist", city=None,
        )
        interactive_alias_review(
            fuzzy_venue_suggestions, to_insert,
            "venue_name", "artist_name",
            "venue_aliases", "venue_id",
            venue_aliases, genuinely_new_venues,
            label="Venue", city=args.city, state=args.state, country=args.country,
            venue_location_map=venue_location_map,
        )
    elif fuzzy_artist_suggestions or fuzzy_venue_suggestions:
        _print_alias_report(
            fuzzy_artist_suggestions, to_insert, "artist_name",
            "artist_aliases", "artist_id",
            header="⚠️  Potential artist aliases — add to artist_aliases and re-run",
            city=None,
        )
        _print_alias_report(
            fuzzy_venue_suggestions, to_insert, "venue_name",
            "venue_aliases", "venue_id",
            header="⚠️  Potential venue aliases — add to venue_aliases and re-run",
            city=args.city, state=args.state, country=args.country,
            venue_location_map=venue_location_map,
        )

    nb      = _n_blocked(to_insert, fuzzy_artist_suggestions, fuzzy_venue_suggestions)
    n_ready = len(to_insert) - nb

    if n_ready == 0:
        print("\nNothing ready to insert.")
        _summary(
            parsed, duplicates, to_insert, error_rows,
            genuinely_new_artists, genuinely_new_venues,
            fuzzy_artist_suggestions, fuzzy_venue_suggestions,
            inserted=0, fuzzy_blocked=[], dry_run=False,
            mbid_resolved_count=mbid_resolved_count,
        )
        return

    # ── 6. Apply ──────────────────────────────────────────────────────────────
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
            {
                "venue_id":   next_id + i,
                "venue_name": loc["name"],
                "city":       loc.get("city", ""),
                "state":      loc.get("state", ""),
                "country":    loc.get("country", ""),
                "city_id":    get_or_create_city_id(
                    loc.get("city", ""), loc.get("state", ""), loc.get("country", ""),
                ),
                "status":     "Open",
            }
            for i, (vtkey, loc) in enumerate(genuinely_new_venues.items())
        ]
        # key_fields makes create_and_resolve populate existing_venues with the same
        # (name, city, state, country) tuple keys used by every other venue lookup —
        # multiple same-named venues across different cities now all resolve correctly
        # within this run instead of colliding on a name-only key (GP-169).
        count = create_and_resolve(
            "dim_venue", records, "venue_name", "venue_id", existing_venues,
            key_fields=["venue_name", "city", "state", "country"],
        )

        print(f"✅  {count} created")

    show_records:  list[dict] = []
    unresolved:    list[dict] = []
    fuzzy_blocked: list[dict] = []

    for show in to_insert:
        if show["artist_name"] in fuzzy_artist_suggestions \
                or show["venue_name"] in fuzzy_venue_suggestions:
            fuzzy_blocked.append(show)
            continue

        akey      = show["artist_name"].lower()
        # GP-172: resolve artist_id by name → alias → MBID, in that order.
        # MBID fallback catches shows where the setlist.fm name differs from our
        # canonical dim_artist name but the MBID matches an already-enriched row.
        artist_id = (existing_artists.get(akey)
                     or artist_aliases.get(akey)
                     or artist_mbid_map.get(show.get("artist_mbid", "")))

        vtkey    = (
            show["venue_name"].lower(),
            (show.get("city")    or "").lower(),
            (show.get("state")   or "").lower(),
            (show.get("country") or "").lower(),
        )
        venue_id = existing_venues.get(vtkey) or venue_aliases.get(show["venue_name"].lower())

        if not artist_id or not venue_id:
            unresolved.append(show)
            continue

        record: dict = {
            "date":          show["date"],
            "artist_id":     artist_id,
            "venue_id":      venue_id,
            "setlist_url":   show["setlist_url"],
            "show_type":     show["show_type"],
            "festival_name": show.get("festival_name") or None,
            "tour_name":     show.get("tour_name") or None,
        }
        show_records.append(record)

    if unresolved:
        print(f"  ⚠️  {len(unresolved)} show(s) skipped — ID unresolved:")
        for s in unresolved[:5]:
            print(f"     {s['date']}  {s['artist_name']}  @  {s['venue_name']}")

    # Deduplicate within the CSV — the same setlist_url can appear twice if the
    # source file was built from multiple partial fetches (--resume runs).
    seen_urls: set[str] = set()
    deduped: list[dict] = []
    for r in show_records:
        if r["setlist_url"] not in seen_urls:
            seen_urls.add(r["setlist_url"])
            deduped.append(r)
    intra_csv_dupes = len(show_records) - len(deduped)
    if intra_csv_dupes:
        print(f"  ⚠️  {intra_csv_dupes} intra-CSV duplicate URL(s) removed before insert")
    show_records = deduped

    inserted = 0
    if show_records:
        next_show_id = get_max_id("fact_shows", "show_id") + 1
        for idx, record in enumerate(show_records):
            record["show_id"] = next_show_id + idx
        print(f"  Inserting {len(show_records):,} shows…", end=" ", flush=True)
        for i in range(0, len(show_records), BATCH_SIZE):
            sb_insert("fact_shows", show_records[i: i + BATCH_SIZE])
            inserted += min(BATCH_SIZE, len(show_records) - i)
        print(f"✅  {inserted:,} inserted")

    if fuzzy_blocked:
        print(f"\n  {len(fuzzy_blocked)} show(s) still held — re-run to review them.")

    # ── 7. Venue-change detection & reconciliation ────────────────────────────
    if show_records:
        print("\nScanning for venue changes …", end=" ", flush=True)
        artist_id_to_name, venue_id_to_name = _build_reverse_maps(
            existing_artists, artist_name_map,
            existing_venues,  venue_name_map,
        )
        venue_pairs = detect_venue_changes(
            show_records, venue_id_to_name, artist_id_to_name,
        )
        if not venue_pairs:
            print("none found.")
        else:
            print(f"{len(venue_pairs)} pair(s) found.")
            reconcile_venue_changes(venue_pairs, interactive=interactive)

    _summary(
        parsed, duplicates, to_insert, error_rows,
        genuinely_new_artists, genuinely_new_venues,
        fuzzy_artist_suggestions, fuzzy_venue_suggestions,
        inserted=inserted, fuzzy_blocked=fuzzy_blocked, dry_run=False,
        mbid_resolved_count=mbid_resolved_count,
    )

    # ── 8. Post-insert housekeeping (live runs only) ─────────────────────────
    if not args.dry_run and (inserted > 0 or genuinely_new_venues):
        print("\nRunning auto_update_venue_status()…", end=" ", flush=True)
        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/auto_update_venue_status",
            headers=_headers("return=minimal"),
            json={},
        )
        if resp.ok:
            print("✅")
        else:
            print(
                f"⚠️  Failed ({resp.status_code}) — "
                f"run manually: SELECT auto_update_venue_status();"
            )

        # Refresh home page materialized views so stats reflect new data
        print("\nRefreshing home page materialized views…", end=" ", flush=True)
        resp_mv = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/refresh_home_materialized_views",
            headers=_headers("return=minimal"),
            json={},
            timeout=120,
        )
        if resp_mv.ok:
            print("✅")
        else:
            print(
                f"⚠️  Failed ({resp_mv.status_code}) — "
                f"run manually: SELECT refresh_home_materialized_views();"
            )

        if genuinely_new_artists:
            print(
                f"\n  💡  {len(genuinely_new_artists)} new artist(s) added — "
                f"run MusicBrainz enrichment when ready:\n"
                f"  python scripts/musicbrainz_artist_enrich.py --new-only --live"
            )


if __name__ == "__main__":
    main()
