#!/usr/bin/env python3
"""
Grooveprint — setlist.fm API Fetch Script  v2
scripts/fetch_setlist_api.py

Fetches show data from the official setlist.fm API for a given city+year
and outputs a CSV that refresh_shows.py can ingest directly — no changes
to the existing pipeline required.

Rate limits (basic free key):
    2 requests/second  |  1,440 requests/day
    Script enforces a 0.55s inter-request delay and tracks the daily budget.
    When the daily cap is near, progress is saved so you can --resume tomorrow.

Usage:
    # Single year:
    python scripts/fetch_setlist_api.py \
        --city Seattle --state WA --country US --year 2025

    # Multiple years (one combined output CSV):
    python scripts/fetch_setlist_api.py \
        --city Seattle --state WA --country US --years 2024 2025

    # Long contiguous range (any shell — no brace expansion needed):
    python scripts/fetch_setlist_api.py \
        --city Tacoma --state WA --country US --year-range 1900 1992 \
        --output exports/seattle-tacoma/tacoma_1900-1992_api.csv

    # Custom output path:
    python scripts/fetch_setlist_api.py \
        --city Seattle --state WA --country US --year 2025 \
        --output exports/seattle/seattle_2025_api.csv

    # Resume an interrupted run:
    python scripts/fetch_setlist_api.py \
        --city Seattle --state WA --country US --year 2025 --resume

    # Vancouver (Canadian city — use CA country code):
    python scripts/fetch_setlist_api.py \
        --city Vancouver --state BC --country CA --year 2026

    # Default output now writes to exports/{city}/ subfolder automatically:
    #   exports/seattle/seattle_2025_api.csv
    #   exports/toronto/toronto_2024_api.csv
    #   exports/seattle-tacoma/tacoma_2024_api.csv  (use --output for secondaries)

Then feed into the pipeline as normal:
    python scripts/refresh_shows.py \
        --input exports/seattle/seattle_2025_api.csv \
        --city Seattle --state WA --country "United States" --dry-run

Required .env:
    SETLIST_API_KEY=your-api-key-from-setlist.fm/settings/api

Optional .env:
    SETLIST_DAILY_CAP=1440      # override daily request budget
    SETLIST_REQUEST_DELAY=0.55  # seconds between requests
"""

import argparse
import csv
import json
import math
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

API_KEY        = os.getenv("SETLIST_API_KEY", "")
BASE_URL       = "https://api.setlist.fm/rest/1.0"
DAILY_CAP      = int(os.getenv("SETLIST_DAILY_CAP", "1440"))
REQUEST_DELAY  = float(os.getenv("SETLIST_REQUEST_DELAY", "0.55"))
PAGE_SIZE      = 20   # fixed by the API — always 20 results per page
PAGE_CAP_WARN  = 990  # warn when approaching the web-UI 1,000-page limit

PROGRESS_DIR   = Path("exports") / ".fetch_progress"

# 3-letter month abbreviations matching refresh_shows.py's MONTH_MAP
MONTH_ABBR = {
    1: "JAN", 2: "FEB",  3: "MAR",  4: "APR",
    5: "MAY", 6: "JUN",  7: "JUL",  8: "AUG",
    9: "SEP", 10: "OCT", 11: "NOV", 12: "DEC",
}

# Output columns must match what parse_row() in refresh_shows.py reads
CSV_COLUMNS = ["Field", "month", "day", "Year", "details", "details2", "details4", "tour_name"]


# ---------------------------------------------------------------------------
# Daily request counter  (resets automatically each calendar day)
# ---------------------------------------------------------------------------

def _counter_path() -> Path:
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    return PROGRESS_DIR / "daily_counter.json"


def load_counter() -> dict:
    p = _counter_path()
    if p.exists():
        try:
            data = json.loads(p.read_text())
            if data.get("date") == str(date.today()):
                return data
        except Exception:
            pass
    return {"date": str(date.today()), "count": 0}


def save_counter(counter: dict) -> None:
    _counter_path().write_text(json.dumps(counter, indent=2))


def remaining(counter: dict) -> int:
    return DAILY_CAP - counter["count"]


# ---------------------------------------------------------------------------
# Per-run progress file  (keyed by city + year)
# ---------------------------------------------------------------------------

def _progress_path(city: str, year: int) -> Path:
    PROGRESS_DIR.mkdir(parents=True, exist_ok=True)
    slug = f"{city.lower().replace(' ', '_')}_{year}"
    return PROGRESS_DIR / f"{slug}.json"


def load_progress(city: str, year: int) -> dict:
    p = _progress_path(city, year)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {"last_page": 0, "total_pages": None, "rows": 0}


def save_progress(city: str, year: int, prog: dict) -> None:
    _progress_path(city, year).write_text(json.dumps(prog, indent=2))


def clear_progress(city: str, year: int) -> None:
    p = _progress_path(city, year)
    if p.exists():
        p.unlink()


# ---------------------------------------------------------------------------
# API call
# ---------------------------------------------------------------------------

def _headers() -> dict:
    return {
        "x-api-key": API_KEY,
        "Accept":    "application/json",
    }


def fetch_page(
    city_name:    str,
    state_code:   str,
    country_code: str,
    year:         int,
    page:         int,
) -> dict:
    """
    GET /1.0/search/setlists for one page.
    Retries automatically on 429 (rate limit).
    Returns empty result dict on 404 (no data for this page/year).
    """
    params: dict = {
        "cityName":    city_name,
        "countryCode": country_code,
        "year":        year,
        "p":           page,
    }
    if state_code:
        params["stateCode"] = state_code

    resp = requests.get(
        f"{BASE_URL}/search/setlists",
        headers=_headers(),
        params=params,
        timeout=20,
    )

    if resp.status_code == 429:
        wait = int(resp.headers.get("Retry-After", 60))
        print(f"\n  ⚠️  Rate limited — waiting {wait}s …", flush=True)
        time.sleep(wait)
        return fetch_page(city_name, state_code, country_code, year, page)

    if resp.status_code == 404:
        # API returns 404 when a page has no results (not an error condition)
        return {"setlist": [], "total": 0, "itemsPerPage": PAGE_SIZE, "page": page}

    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Row transformation
# ---------------------------------------------------------------------------

def parse_event_date(event_date: str) -> tuple[str, str, str]:
    """
    Convert API's 'dd-MM-yyyy' → (month_abbr, day_str, year_str).
    Returns ("", "", "") on parse failure — those rows get skipped.
    """
    try:
        dt = datetime.strptime(event_date, "%d-%m-%Y")
        return MONTH_ABBR[dt.month], str(dt.day), str(dt.year)
    except (ValueError, KeyError):
        return "", "", ""


def build_venue_string(setlist: dict) -> str:
    """
    Build 'Venue Name, City, StateCode, Country' for the details4 column.
    refresh_shows.py's extract_venue_info() expects comma-separated parts:
      len > 3  → parts[-3] = city, everything before that = venue name
      len == 3 → parts[0] = venue name, parts[-3] = city (same)
    So 'The Crocodile, Seattle, WA, United States' parses correctly.
    """
    try:
        venue   = setlist.get("venue") or {}
        city    = venue.get("city")    or {}
        country = city.get("country")  or {}

        parts = [
            (venue.get("name")        or "").strip(),
            (city.get("name")         or "").strip(),
            (city.get("stateCode")    or "").strip(),
            (country.get("name")      or "").strip(),
        ]
        return ", ".join(p for p in parts if p)
    except Exception:
        return ""


def setlist_to_row(setlist: dict) -> dict | None:
    """
    Map one API setlist object → CSV row dict.

    Column mapping (must match refresh_shows.py parse_row()):
      Field     ← setlist URL          (dedup key — setlist_url in fact_shows)
      month     ← 3-letter abbreviation (JAN … DEC)
      day       ← day of month
      Year      ← 4-digit year
      details   ← artist name
      details2  ← literal "Venue:"     (triggers venue-branch in parse_row)
      details4  ← "Venue, City, State, Country"
      tour_name ← tour name from API (empty string if not on a named tour)
    """
    url = (setlist.get("url") or "").strip()
    if not url:
        return None

    month, day, year = parse_event_date(setlist.get("eventDate", ""))
    if not month:
        return None

    artist_name = ((setlist.get("artist") or {}).get("name") or "").strip()
    if not artist_name:
        return None

    venue_str = build_venue_string(setlist)
    if not venue_str:
        return None

    return {
        "Field":     url,
        "month":     month,
        "day":       day,
        "Year":      year,
        "details":   artist_name,
        "details2":  "Venue:",
        "details4":  venue_str,
        "tour_name": (setlist.get("tour") or {}).get("name", ""),
    }


# ---------------------------------------------------------------------------
# Core fetch loop for a single city+year
# ---------------------------------------------------------------------------

def fetch_year(
    city_name:    str,
    state_code:   str,
    country_code: str,
    year:         int,
    output_path:  Path,
    resume:       bool,
    counter:      dict,
    force_append: bool = False,   # True for 2nd+ year in a multi-year run
) -> tuple[int, bool]:
    """
    Page through all results for city+year, writing rows to output_path.

    Returns (rows_written_this_run, completed).
    completed=False means we hit the daily cap — call with --resume tomorrow.
    """
    prog       = load_progress(city_name, year) if resume else {"last_page": 0, "total_pages": None, "rows": 0}
    start_page = prog["last_page"] + 1

    # Already done from a previous run
    if prog.get("total_pages") and start_page > prog["total_pages"]:
        print(f"  {year}: already complete ({prog['rows']:,} rows) — skipping.")
        return 0, True

    # Decide whether to write a fresh header or append to an existing file
    is_append   = force_append or (resume and output_path.exists() and prog["last_page"] > 0)
    file_mode   = "a" if is_append else "w"
    write_hdr   = not is_append

    rows_written = 0
    completed    = False

    with open(output_path, file_mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        if write_hdr:
            writer.writeheader()

        page = start_page
        while True:

            # Daily cap check
            if remaining(counter) <= 0:
                print(f"\n  ⚠️  Daily cap ({DAILY_CAP} requests) reached.")
                print(f"  Progress saved — re-run with --resume tomorrow to continue.")
                save_progress(city_name, year, {
                    "last_page":   page - 1,
                    "total_pages": prog.get("total_pages"),
                    "rows":        prog["rows"] + rows_written,
                })
                save_counter(counter)
                return rows_written, False

            # Page-cap warning
            if page == PAGE_CAP_WARN:
                print(f"\n  ⚠️  Approaching page {PAGE_CAP_WARN} — the API may enforce a "
                      f"1,000-page cap (same as the web UI).")
                print(f"  If results stop before {year} is fully fetched, re-run with a "
                      f"narrower year range or contact setlist.fm for a higher limit.")

            # Progress line
            total_pages_display = (
                f"/{prog['total_pages']}" if prog.get("total_pages") else ""
            )
            print(f"  [{year}] p{page}{total_pages_display} … ", end="", flush=True)

            data = fetch_page(city_name, state_code, country_code, year, page)
            counter["count"] += 1
            save_counter(counter)

            setlists = data.get("setlist") or []
            total    = int(data.get("total") or 0)

            # Derive total pages from first response
            if prog.get("total_pages") is None and total > 0:
                prog["total_pages"] = math.ceil(total / PAGE_SIZE)
                print(f"{total:,} shows → {prog['total_pages']} pages  ", end="")

            # Write rows
            page_rows = 0
            for sl in setlists:
                row = setlist_to_row(sl)
                if row:
                    writer.writerow(row)
                    page_rows += 1

            rows_written += page_rows
            print(f"+{page_rows}  [{remaining(counter)} req left today]")

            # Save progress after every page
            save_progress(city_name, year, {
                "last_page":   page,
                "total_pages": prog.get("total_pages"),
                "rows":        prog["rows"] + rows_written,
            })

            # Stop conditions
            if not setlists:
                print(f"  [{year}] Empty page — done.")
                completed = True
                break

            if prog.get("total_pages") and page >= prog["total_pages"]:
                print(f"  [{year}] All {prog['total_pages']} pages fetched.")
                completed = True
                break

            page += 1
            time.sleep(REQUEST_DELAY)

    if completed:
        clear_progress(city_name, year)

    return rows_written, completed


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fetch setlist.fm API → CSV for refresh_shows.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("--city",    required=True, help="City name, e.g. Seattle")
    ap.add_argument("--state",   default="",    help="State/province code, e.g. WA or BC")
    ap.add_argument("--country", default="US",  help="ISO country code (default: US)")
    ap.add_argument("--year",    type=int,       help="Single year (shorthand for --years YEAR)")
    ap.add_argument("--years",   type=int, nargs="+", metavar="YEAR",
                    help="One or more years, e.g. --years 2024 2025")
    ap.add_argument("--year-range", type=int, nargs=2, metavar=("START", "END"),
                    help="Inclusive year range, e.g. --year-range 1900 1992 "
                         "(use instead of --years for long spans — works in any shell)")
    ap.add_argument("--output",  default="",
                    help="Output CSV path (default: exports/{city}/{city}_{years}_api.csv)")
    ap.add_argument("--resume",  action="store_true",
                    help="Resume an interrupted run from saved progress files")
    args = ap.parse_args()

    if not API_KEY:
        print("ERROR: SETLIST_API_KEY is not set in .env")
        print("  Apply for a key at: https://www.setlist.fm/settings/api")
        sys.exit(1)

    if args.year_range and args.year_range[0] > args.year_range[1]:
        print(f"ERROR: --year-range start ({args.year_range[0]}) must be <= end ({args.year_range[1]})")
        sys.exit(1)

    years = sorted(set(
        (args.years or [])
        + ([args.year] if args.year else [])
        + (list(range(args.year_range[0], args.year_range[1] + 1)) if args.year_range else [])
    ))
    if not years:
        print("ERROR: provide at least one year via --year YYYY, --years YYYY YYYY …, or --year-range START END")
        sys.exit(1)

    # Compact slug for long contiguous ranges (e.g. 1900-1992) to avoid unwieldy
    # default filenames; explicit short lists (e.g. 2024 2025) keep the underscore form.
    if len(years) > 2 and years == list(range(years[0], years[-1] + 1)):
        year_slug = f"{years[0]}-{years[-1]}"
    else:
        year_slug = "_".join(str(y) for y in years)
    city_slug   = args.city.lower().replace(" ", "_")

    # Default: exports/{city_slug}/{city_slug}_{year_slug}_api.csv
    # Secondary cities should use --output exports/{parent}-{secondary}/{filename}
    output_path = Path(args.output) if args.output else (
        Path("exports") / city_slug / f"{city_slug}_{year_slug}_api.csv"
    )
    output_path.parent.mkdir(parents=True, exist_ok=True)

    counter = load_counter()

    print("=" * 64)
    print("Grooveprint — setlist.fm API Fetch  v1")
    print(f"City:       {args.city}" + (f", {args.state}" if args.state else "") +
          f", {args.country}")
    years_display = (f"{years[0]}-{years[-1]} ({len(years)} years)"
                     if len(years) > 2 and years == list(range(years[0], years[-1] + 1))
                     else ', '.join(str(y) for y in years))
    print(f"Year(s):    {years_display}")
    print(f"Output:     {output_path}")
    print(f"Daily cap:  {remaining(counter):,} / {DAILY_CAP} requests remaining today")
    if args.resume:
        print(f"Mode:       RESUME from saved progress")
    print("=" * 64)

    if remaining(counter) <= 0:
        print("\nERROR: Daily request budget exhausted. Try again tomorrow.")
        sys.exit(1)

    total_rows = 0
    all_complete = True

    for i, year in enumerate(years):
        print(f"\n── {args.city} {year} " + "─" * (44 - len(args.city)))
        rows, completed = fetch_year(
            city_name=args.city,
            state_code=args.state,
            country_code=args.country,
            year=year,
            output_path=output_path,
            resume=args.resume,
            counter=counter,
            force_append=(i > 0),   # 2nd+ year always appends to same output file
        )
        total_rows  += rows
        all_complete = all_complete and completed
        status = "✅  complete" if completed else "⏸  paused (daily cap)"
        print(f"  {year}: {rows:,} new rows written  {status}")

        if not completed:
            all_complete = False
            break

        # Brief pause between years
        if i < len(years) - 1:
            time.sleep(1.0)

    print(f"\n{'=' * 64}")
    print(f"Total rows written:  {total_rows:,}")
    print(f"Output file:         {output_path}")
    print(f"Requests used today: {counter['count']} / {DAILY_CAP}")

    if not all_complete:
        print(f"\n⏸  Run again tomorrow with --resume to finish.")
    else:
        print(f"\nNext steps:")
        print(f"  # Dry run first to check alias matches and row counts:")
        print(f"  python scripts/refresh_shows.py \\")
        print(f"      --input {output_path} \\")
        print(f"      --city {args.city} --dry-run")
        print(f"\n  # Then live run:")
        print(f"  python scripts/refresh_shows.py \\")
        print(f"      --input {output_path} \\")
        print(f"      --city {args.city}")
    print("=" * 64)


if __name__ == "__main__":
    main()
