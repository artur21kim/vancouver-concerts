#!/usr/bin/env python3
"""
Grooveprint — Secondary City Discovery Script
scripts/find_secondary_cities.py

For each primary city in the expansion plan, queries the setlist.fm API to
get total show counts for known metro-area secondary cities, then flags any
that exceed the threshold as worth a dedicated fetch pass.

One API request per candidate city (just page 1 — total is in the response).
Respects the same daily cap as fetch_setlist_api.py via shared counter file.

Covers both US and Canadian expansion cities.

Usage:
    python scripts/find_secondary_cities.py
    python scripts/find_secondary_cities.py --threshold 500
    python scripts/find_secondary_cities.py --output exports/secondary_cities.csv
    python scripts/find_secondary_cities.py --city "Toronto" --city "Montreal"
    python scripts/find_secondary_cities.py --city "New York" --city "Los Angeles"

Output:
    Console table + CSV with columns:
      primary_city, secondary_city, state, country_code, total_shows, fetch_recommended, note

Required .env:
    SETLIST_API_KEY=your-api-key-from-setlist.fm/settings/api
"""

import argparse
import csv
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY       = os.getenv("SETLIST_API_KEY", "")
BASE_URL      = "https://api.setlist.fm/rest/1.0"
PROGRESS_DIR  = Path("exports") / ".fetch_progress"

# ---------------------------------------------------------------------------
# Metro area definitions
# Format: "Primary City" → list of (city_name, state_code, country_code, note)
# state_code: 2-letter US state, or province (BC, ON, etc.)
# country_code: ISO 2-letter (US, CA)
# note: why this city matters / key venues
# ---------------------------------------------------------------------------

METRO_AREAS: dict[str, list[tuple[str, str, str, str]]] = {
    # ── US cities ─────────────────────────────────────────────────────────────
    "New York": [
        ("Brooklyn",        "NY", "US", "Independent borough, huge venue base"),
        ("Queens",          "NY", "US", "Flushing Meadows, Citi Field shows"),
        ("Newark",          "NJ", "US", "Prudential Center arena shows"),
        ("East Rutherford", "NJ", "US", "MetLife Stadium"),
        ("Hoboken",         "NJ", "US", "Maxwell's and bar scene"),
        ("Sayreville",      "NJ", "US", "Starland Ballroom"),
        ("Wantagh",         "NY", "US", "Jones Beach Theater"),
        ("Westbury",        "NY", "US", "NYCB Theatre"),
        ("Buffalo",         "NY", "US", "Separate market but same state"),
    ],
    "Los Angeles": [
        ("West Hollywood",  "CA", "US", "Whisky A Go Go, Troubadour, Roxy — separate city on setlist.fm"),
        ("Anaheim",         "CA", "US", "House of Blues, Honda Center"),
        ("Inglewood",       "CA", "US", "Kia Forum, SoFi Stadium"),
        ("Hollywood",       "CA", "US", "Hollywood Bowl, Palladium"),
        ("Pasadena",        "CA", "US", "Rose Bowl shows"),
        ("Long Beach",      "CA", "US", "Long Beach Arena"),
        ("San Bernardino",  "CA", "US", "Glen Helen Amphitheater"),
    ],
    "Chicago": [
        ("Rosemont",        "IL", "US", "Allstate Arena, Now Arena"),
        ("Tinley Park",     "IL", "US", "Hollywood Casino Amphitheatre"),
        ("Waukegan",        "IL", "US", "Genesee Theatre"),
    ],
    "Boston": [
        ("Cambridge",       "MA", "US", "The Middle East (7,755 shows in venue list)"),
        ("Somerville",      "MA", "US", "Once Ballroom, Thunder Road"),
        ("Worcester",       "MA", "US", "Palladium (7,652 shows in venue list)"),
        ("Providence",      "RI", "US", "Already in R3 — verify overlap with Boston fetch"),
        ("Mansfield",       "MA", "US", "Xfinity Center amphitheatre shows"),
    ],
    "San Francisco": [
        ("Oakland",         "CA", "US", "Fox Theater, Oracle Arena"),
        ("Berkeley",        "CA", "US", "Greek Theatre, Freight & Salvage"),
        ("San Jose",        "CA", "US", "SAP Center, City Lights"),
        ("Mountain View",   "CA", "US", "Shoreline Amphitheatre"),
        ("Concord",         "CA", "US", "Concord Pavilion"),
    ],
    "Dallas": [
        ("Fort Worth",      "TX", "US", "Venue logged separately from Dallas"),
        ("Irving",          "TX", "US", "Toyota Music Factory"),
        ("Grand Prairie",   "TX", "US", "Texas Trust CU Theatre"),
        ("Frisco",          "TX", "US", "Growing suburb with larger venues"),
    ],
    "Denver": [
        ("Morrison",        "CO", "US", "Red Rocks Amphitheatre — dedicated fetch already planned"),
        ("Boulder",         "CO", "US", "Fox Theatre, Boulder Theater"),
        ("Fort Collins",    "CO", "US", "Aggie Theatre, Washington's"),
        ("Englewood",       "CO", "US", "Fiddler's Green Amphitheatre"),
    ],
    "Seattle": [
        ("Tacoma",          "WA", "US", "Tacoma Dome, Pantages"),
        ("George",          "WA", "US", "The Gorge Amphitheatre — dedicated fetch already planned"),
        ("Bellevue",        "WA", "US", "Meydenbauer Center"),
        ("Woodinville",     "WA", "US", "Chateau Ste. Michelle Winery concerts"),
    ],
    "Minneapolis": [
        ("Saint Paul",      "MN", "US", "Xcel Energy Center, Ordway"),
        ("Shakopee",        "MN", "US", "Canterbury Park outdoor shows"),
        ("Bloomington",     "MN", "US", "MOA amphitheatre area"),
    ],
    "Atlanta": [
        ("Alpharetta",      "GA", "US", "Ameris Bank Amphitheatre"),
        ("Duluth",          "GA", "US", "Gas South Arena"),
        ("Macon",           "GA", "US", "Capricorn Sound Studios history, Cox Capitol"),
    ],
    "Nashville": [
        ("Murfreesboro",    "TN", "US", "Murphy Center, MTSU"),
        ("Franklin",        "TN", "US", "FirstBank Amphitheater"),
        ("Antioch",         "TN", "US", "Geodis Park area"),
    ],
    "Austin": [
        ("San Marcos",      "TX", "US", "Stubb's satellite shows, Texas State"),
        ("Cedar Park",      "TX", "US", "Moody Center spillover"),
    ],
    "Portland": [
        ("Hillsboro",       "OR", "US", "Hillsboro Civic Center"),
        ("Beaverton",       "OR", "US", "Smaller venues"),
        ("Vancouver",       "WA", "US", "Clark County, Washington side of metro"),
    ],
    "Philadelphia": [
        ("Camden",          "NJ", "US", "BB&T Pavilion (now Freedom Mortgage)"),
        ("Upper Darby",     "PA", "US", "Tower Theater"),
        ("Bethlehem",       "PA", "US", "Musikfest, Wind Creek Steel Stage"),
    ],
    "Washington, D.C.": [
        ("Bristow",         "VA", "US", "Jiffy Lube Live amphitheatre"),
        ("Columbia",        "MD", "US", "Merriweather Post Pavilion"),
        ("Baltimore",       "MD", "US", "Already in R2 — check for overlap"),
    ],
    "Houston": [
        ("The Woodlands",   "TX", "US", "Cynthia Woods Mitchell Pavilion"),
        ("Sugar Land",      "TX", "US", "Smart Financial Centre"),
        ("Corpus Christi",  "TX", "US", "American Bank Center — distinct market"),
    ],
    "Miami": [
        ("Fort Lauderdale", "FL", "US", "Broward Center, Revolution Live"),
        ("Hollywood",       "FL", "US", "Hard Rock Live (largest in FL)"),
        ("West Palm Beach", "FL", "US", "iTHINK Financial Amphitheatre"),
        ("Boca Raton",      "FL", "US", "Mizner Park Amphitheatre"),
    ],
    "Las Vegas": [
        ("Henderson",       "NV", "US", "Dollar Loan Center arena"),
        ("Paradise",        "NV", "US", "Many Strip venues logged as Paradise, NV — verify vs Las Vegas fetch"),
    ],
    "Phoenix": [
        ("Tempe",           "AZ", "US", "Marquee Theatre, Concrete Street"),
        ("Scottsdale",      "AZ", "US", "Talking Stick Resort Arena area"),
        ("Mesa",            "AZ", "US", "Compton Terrace, i wireless Center"),
        ("Glendale",        "AZ", "US", "State Farm Stadium shows"),
    ],
    "Cleveland": [
        ("Berea",           "OH", "US", "BW campus shows"),
        ("Cuyahoga Falls",  "OH", "US", "Blossom Music Center (major amphitheatre)"),
        ("Akron",           "OH", "US", "Distinct Rust Belt market"),
    ],
    "Pittsburgh": [
        ("Burgettstown",    "PA", "US", "The Pavilion at Star Lake amphitheatre"),
    ],
    "Salt Lake City": [
        ("Sandy",           "UT", "US", "USANA Amphitheatre"),
        ("West Valley City","UT", "US", "Delta Center spillover"),
        ("Provo",           "UT", "US", "Distinct university market"),
    ],
    "New Orleans": [
        ("Metairie",        "LA", "US", "Lakefront Arena"),
        ("Baton Rouge",     "LA", "US", "Distinct market, LSU"),
    ],
    "Detroit": [
        ("Auburn Hills",    "MI", "US", "Pine Knob Music Theatre, Little Caesars area"),
        ("Clarkston",       "MI", "US", "DTE Energy Music Theatre (Pine Knob)"),
        ("Ann Arbor",       "MI", "US", "University market, Hill Auditorium"),
        ("Grand Rapids",    "MI", "US", "Distinct western Michigan market"),
    ],
    "Indianapolis": [
        ("Noblesville",     "IN", "US", "Ruoff Music Center amphitheatre"),
        ("Fishers",         "IN", "US", "Smaller suburban venues"),
    ],
    "Kansas City": [
        ("Bonner Springs",  "KS", "US", "Azura Amphitheater"),
        ("Independence",    "MO", "US", "Silverstein Eye Centers Arena"),
    ],
    "Charlotte": [
        ("Concord",         "NC", "US", "PNC Music Pavilion (outside Charlotte)"),
        ("Greensboro",      "NC", "US", "Distinct Piedmont market, Greensboro Coliseum"),
    ],
    "Orlando": [
        ("Kissimmee",       "FL", "US", "Theme park area venues"),
        ("Daytona Beach",   "FL", "US", "Distinct coastal market"),
    ],
    "Tampa": [
        ("St. Petersburg",  "FL", "US", "Jannus Live, Mahaffey Theater"),
        ("Clearwater",      "FL", "US", "Ruth Eckerd Hall"),
        ("Sarasota",        "FL", "US", "Van Wezel Performing Arts"),
    ],

    # ── Canadian cities ───────────────────────────────────────────────────────
    # Note: Hamilton is a primary city in the expansion plan — standalone fetch,
    # not a Toronto secondary. It is not listed here.
    "Toronto": [
        ("Mississauga", "ON", "CA", "Larger suburban venues, Living Arts Centre"),
        ("Brampton",    "ON", "CA", "Rose Theatre, growing market"),
        ("Markham",     "ON", "CA", "Markham Theatre"),
        ("Oakville",    "ON", "CA", "Oakville Centre"),
        ("Vaughan",     "ON", "CA", "Canada's Wonderland amphitheatre"),
    ],
    "Montreal": [
        ("Laval",       "QC", "CA", "Place Bell — major arena, distinct city on setlist.fm"),
        ("Longueuil",   "QC", "CA", "South Shore venues"),
        ("Brossard",    "QC", "CA", "Place Bell spillover area"),
    ],
    "Vancouver": [
        # Note: verify which shows setlist.fm logs under Vancouver vs suburb
        # given existing YVR scrape already covers some of this area
        ("Burnaby",     "BC", "CA", "Deer Lake Park, Swangard Stadium"),
        ("Surrey",      "BC", "CA", "Hard Rock Casino Vancouver"),
        ("Richmond",    "BC", "CA", "River Rock Casino"),
        ("Abbotsford",  "BC", "CA", "Abbotsford Centre arena"),
        ("Langley",     "BC", "CA", "Cascades Casino, Willowbrook"),
        ("Coquitlam",   "BC", "CA", "Place des Arts, Town Centre"),
    ],
    "Calgary": [
        ("Red Deer",    "AB", "CA", "Distinct mid-Alberta market"),
        ("Airdrie",     "AB", "CA", "Smaller suburban, probably low count"),
    ],
    "Ottawa": [
        ("Gatineau",    "QC", "CA", "Quebec side of NCR — separate city on setlist.fm"),
    ],
    "Edmonton": [
        ("St. Albert",    "AB", "CA", "Arden Theatre, probably low count"),
        ("Sherwood Park", "AB", "CA", "Jubilee Auditorium area"),
    ],
    "Winnipeg":    [],  # Metro is compact — city fetch captures most shows
    "Victoria":    [],  # Island geography, minimal secondary activity
    "Quebec City": [
        ("Levis",       "QC", "CA", "South shore, probably low count"),
    ],
    "Halifax": [
        ("Dartmouth",   "NS", "CA", "Probably minimal but worth checking"),
    ],
}

# ---------------------------------------------------------------------------
# Shared daily counter (same file as fetch_setlist_api.py)
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


# ---------------------------------------------------------------------------
# API: get total show count for a city (single page-1 request)
# ---------------------------------------------------------------------------

def get_city_show_count(
    city_name: str,
    state_code: str,
    country_code: str,
    counter: dict,
    delay: float = 0.6,
) -> int | None:
    """
    Returns total show count for a city from the setlist.fm API.
    Uses only one request (page 1) — the total is in the response root.
    Returns None on error.
    """
    params: dict = {
        "cityName":    city_name,
        "countryCode": country_code,
        "p":           1,
    }
    if state_code:
        params["stateCode"] = state_code

    try:
        resp = requests.get(
            f"{BASE_URL}/search/setlists",
            headers={"x-api-key": API_KEY, "Accept": "application/json"},
            params=params,
            timeout=15,
        )
        counter["count"] += 1
        save_counter(counter)
        time.sleep(delay)

        if resp.status_code == 404:
            return 0
        if resp.status_code == 429:
            wait = int(resp.headers.get("Retry-After", 60))
            print(f"  ⚠️  Rate limited — waiting {wait}s …")
            time.sleep(wait)
            return get_city_show_count(city_name, state_code, country_code, counter, delay)
        resp.raise_for_status()
        data = resp.json()
        return int(data.get("total") or 0)

    except Exception as e:
        print(f"  ⚠️  Error fetching {city_name}: {e}")
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Discover secondary fetch cities for each primary expansion city.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument(
        "--threshold", type=int, default=1000,
        help="Minimum total shows to flag a city as worth fetching (default: 1000)",
    )
    ap.add_argument(
        "--output", default="exports/secondary_cities.csv",
        help="Output CSV path (default: exports/secondary_cities.csv)",
    )
    ap.add_argument(
        "--city", action="append", dest="cities", metavar="CITY",
        help="Limit to specific primary city/cities (can repeat). Default: all.",
    )
    ap.add_argument(
        "--delay", type=float, default=0.6,
        help="Seconds between API requests (default: 0.6)",
    )
    args = ap.parse_args()

    if not API_KEY:
        print("ERROR: SETLIST_API_KEY not set in .env")
        sys.exit(1)

    targets = args.cities or list(METRO_AREAS.keys())
    missing = [c for c in targets if c not in METRO_AREAS]
    if missing:
        print(f"ERROR: No metro definition for: {missing}")
        print(f"Available: {list(METRO_AREAS.keys())}")
        sys.exit(1)

    total_candidates = sum(len(METRO_AREAS[c]) for c in targets)
    counter = load_counter()

    print("=" * 64)
    print("Grooveprint — Secondary City Discovery")
    print(f"Primary cities:     {len(targets)}")
    print(f"Total candidates:   {total_candidates}")
    print(f"Fetch threshold:    {args.threshold:,} total shows")
    print(f"API budget:         {1440 - counter['count']} / 1440 remaining today")
    print(f"Output:             {args.output}")
    print("=" * 64)

    if 1440 - counter["count"] < total_candidates:
        print(
            f"\n⚠️  Only {1440 - counter['count']} requests remaining today "
            f"but need {total_candidates}. Some cities may be skipped."
        )

    results: list[dict] = []

    for primary in targets:
        candidates = METRO_AREAS[primary]
        if not candidates:
            print(f"\n── {primary} — no secondary candidates defined, skipping")
            continue
        print(f"\n── {primary} ({len(candidates)} candidates) " + "─" * max(0, 40 - len(primary)))

        for city, state, country, note in candidates:
            if 1440 - counter["count"] <= 0:
                print(f"  ⚠️  Daily cap reached — skipping remaining")
                break

            total = get_city_show_count(city, state, country, counter, args.delay)
            recommended = (total is not None) and (total >= args.threshold)
            flag = "✅  FETCH" if recommended else ("❓  no data" if total is None else "—  below threshold")

            print(f"  {city:<22} {str(total or '?'):>8} shows   {flag}")

            results.append({
                "primary_city":      primary,
                "secondary_city":    city,
                "state":             state,
                "country_code":      country,
                "total_shows":       total if total is not None else "",
                "fetch_recommended": "yes" if recommended else "no",
                "note":              note,
            })

    # Write CSV
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=[
            "primary_city", "secondary_city", "state", "country_code",
            "total_shows", "fetch_recommended", "note",
        ])
        writer.writeheader()
        writer.writerows(results)

    # Summary
    recommended = [r for r in results if r["fetch_recommended"] == "yes"]
    print(f"\n{'=' * 64}")
    print(f"Results: {len(results)} candidates checked")
    print(f"Flagged for fetching: {len(recommended)}")
    print(f"\nRecommended secondary fetches:")
    for r in recommended:
        total_str = f"{r['total_shows']:,}" if isinstance(r["total_shows"], int) else str(r["total_shows"])
        print(f"  {r['primary_city']:<20} → {r['secondary_city']}, {r['state']}  ({total_str} shows)")
    print(f"\nFull results: {output_path}")
    print(f"API requests used today: {counter['count']} / 1440")
    print("=" * 64)

    print("\nNext step — fetch flagged secondary cities:")
    print("  python scripts/fetch_setlist_api.py \\")
    print("      --city <secondary_city> --state <state> --country <US|CA> \\")
    print("      --years <range> \\")
    print("      --output exports/<parent>-<secondary>/<secondary>_<years>_api.csv")


if __name__ == "__main__":
    main()
