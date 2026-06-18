"""
Ticketmaster URL Enrichment Script
Grooveprint / Vancouver Concert History

Queries TM Discovery API by venue ID, matches events to fact_shows by artist name,
and writes ticketmaster_url back to Supabase via REST API.

Uses only `requests` and `python-dotenv` — no supabase client needed.

Usage:
    pip install requests python-dotenv
    python tm_enrichment.py

Environment variables required (.env):
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key
    TM_API_KEY=your-ticketmaster-consumer-key
"""

import os
import re
import time
import requests
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TM_API_KEY = os.environ["TM_API_KEY"]

TM_EVENTS_URL  = "https://app.ticketmaster.com/discovery/v2/events.json"
TM_VENUES_URL  = "https://app.ticketmaster.com/discovery/v2/venues/{}.json"
TM_RATE_LIMIT_DELAY = 0.25  # 4 requests/sec, well under 5/sec limit

# Supabase REST API headers
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal",
}


# ---------------------------------------------------------------------------
# Name normalisation
# ---------------------------------------------------------------------------

def normalize_name(name: str) -> str:
    """
    Lowercase, strip punctuation, move leading 'the' to end.
    e.g. "The Lumineers" -> "lumineers the"
         "Lumineers, The" -> "lumineers the"
         "AC/DC"          -> "acdc"
    """
    if not name:
        return ""
    name = name.lower().strip()
    name = name.replace(",", "")
    name = re.sub(r"[^a-z0-9\s]", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    if name.startswith("the "):
        name = name[4:] + " the"
    return name


def names_match(tm_name: str, db_name: str) -> bool:
    return normalize_name(tm_name) == normalize_name(db_name)


# ---------------------------------------------------------------------------
# Supabase REST helpers
# ---------------------------------------------------------------------------

def sb_get(table: str, params: dict) -> list:
    """GET rows from a Supabase table."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.get(url, headers=SUPABASE_HEADERS, params=params)
    resp.raise_for_status()
    return resp.json()


def sb_patch(table: str, match_params: dict, data: dict) -> None:
    """PATCH (update) rows in a Supabase table."""
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    resp = requests.patch(
        url,
        headers=SUPABASE_HEADERS,
        params=match_params,
        json=data,
    )
    resp.raise_for_status()


# ---------------------------------------------------------------------------
# TM venue coordinate enrichment (GP-98)
# ---------------------------------------------------------------------------

def get_venues_needing_coords() -> list:
    """Venues with a TM mapping but no lat/long yet."""
    url = f"{SUPABASE_URL}/rest/v1/dim_venue"
    resp = requests.get(url, headers=SUPABASE_HEADERS, params={
        "select":      "venue_id,venue_name,tm_venue_id",
        "tm_venue_id": "not.is.null",
        "latitude":    "is.null",
    })
    resp.raise_for_status()
    return resp.json()


def fetch_tm_venue_coords(tm_venue_id: str) -> tuple[float, float] | None:
    """
    Call the TM venue details endpoint and return (latitude, longitude).
    Returns None if the venue has no location data.
    """
    url = TM_VENUES_URL.format(tm_venue_id)
    try:
        resp = requests.get(
            url,
            params={"apikey": TM_API_KEY},
            timeout=10,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        loc = data.get("location") or {}
        lat_s = loc.get("latitude")
        lon_s = loc.get("longitude")
        if lat_s and lon_s:
            return float(lat_s), float(lon_s)
    except Exception as e:
        print(f"    ⚠️  TM venue coords error for tm_id={tm_venue_id}: {e}")
    return None


def write_venue_coords(venue_id: int, lat: float, lon: float) -> None:
    sb_patch(
        "dim_venue",
        {"venue_id": f"eq.{venue_id}"},
        {"latitude": lat, "longitude": lon},
    )


def enrich_venue_coords() -> None:
    """
    Pass 1 (GP-98): populate lat/long for all TM-mapped venues that are
    missing coordinates. Runs before the events loop so every future
    Ticketmaster URL enrichment run also keeps coordinates up to date.
    """
    venues = get_venues_needing_coords()
    if not venues:
        print("  Venue coords: all TM-mapped venues already have lat/long — skipping.\n")
        return

    print(f"  Fetching coordinates for {len(venues)} TM-mapped venue(s)…")
    written = 0
    skipped = 0

    for v in venues:
        venue_id    = v["venue_id"]
        venue_name  = v["venue_name"]
        tm_venue_id = v["tm_venue_id"]

        coords = fetch_tm_venue_coords(tm_venue_id)
        time.sleep(TM_RATE_LIMIT_DELAY)

        if coords:
            lat, lon = coords
            write_venue_coords(venue_id, lat, lon)
            print(f"    ✅ {venue_name:<40} → {lat:.5f}, {lon:.5f}")
            written += 1
        else:
            print(f"    —  {venue_name:<40}  (no location in TM)")
            skipped += 1

    print(f"\n  Venue coords: {written} written, {skipped} skipped (no TM location data)\n")


# ---------------------------------------------------------------------------
# Fetch mapped venues from Supabase
# ---------------------------------------------------------------------------

def get_mapped_venues() -> list:
    return sb_get("dim_venue", {
        "select": "venue_id,venue_name,tm_venue_id",
        "tm_venue_id": "not.is.null",
    })


# ---------------------------------------------------------------------------
# Fetch upcoming shows from Supabase for a venue
# ---------------------------------------------------------------------------

def get_upcoming_shows(venue_id: int) -> list:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = sb_get("fact_shows", {
        "select": "show_id,date,artist_id,dim_artist(artist_name)",
        "venue_id": f"eq.{venue_id}",
        "date": f"gte.{today}",
        "ticketmaster_url": "is.null",
    })
    return rows


# ---------------------------------------------------------------------------
# Write TM URL back to fact_shows
# ---------------------------------------------------------------------------

def write_tm_url(show_id: int, url: str) -> None:
    sb_patch(
        "fact_shows",
        {"show_id": f"eq.{show_id}"},
        {"ticketmaster_url": url},
    )


# ---------------------------------------------------------------------------
# Fetch upcoming events from TM for a single venue
# ---------------------------------------------------------------------------

def fetch_tm_events(tm_venue_id: str) -> list:
    events = []
    page = 0
    start_dt = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    while True:
        params = {
            "apikey": TM_API_KEY,
            "venueId": tm_venue_id,
            "classificationName": "music",
            "startDateTime": start_dt,
            "size": 50,
            "page": page,
            "sort": "date,asc",
        }

        try:
            resp = requests.get(TM_EVENTS_URL, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            print(f"    ⚠️  TM API error for venue {tm_venue_id}: {e}")
            break

        embedded = data.get("_embedded", {})
        page_events = embedded.get("events", [])
        events.extend(page_events)

        page_info = data.get("page", {})
        total_pages = page_info.get("totalPages", 1)

        if page >= total_pages - 1:
            break

        page += 1
        time.sleep(TM_RATE_LIMIT_DELAY)

    return events


# ---------------------------------------------------------------------------
# Extract artist names and event date from a TM event
# ---------------------------------------------------------------------------

def parse_tm_event(event: dict) -> dict:
    dates = event.get("dates", {})
    start = dates.get("start", {})
    date_str = start.get("localDate")

    url = event.get("url", "")

    embedded = event.get("_embedded", {})
    attractions = embedded.get("attractions", [])
    artist_names = [a.get("name", "") for a in attractions if a.get("name")]

    return {
        "date": date_str,
        "url": url,
        "artist_names": artist_names,
    }


# ---------------------------------------------------------------------------
# Match TM events to DB shows
# ---------------------------------------------------------------------------

def match_and_enrich(tm_events: list, db_shows: list) -> dict:
    stats = {"matched": 0, "unmatched": 0, "skipped": 0}

    # Build lookup: date -> list of parsed TM events
    tm_by_date = {}
    for event in tm_events:
        parsed = parse_tm_event(event)
        if parsed["date"]:
            tm_by_date.setdefault(parsed["date"], []).append(parsed)

    for show in db_shows:
        show_date = (show.get("date") or "")[:10]

        dim_artist = show.get("dim_artist")
        artist_name = ""
        if isinstance(dim_artist, dict):
            artist_name = dim_artist.get("artist_name", "")
        elif isinstance(dim_artist, list) and dim_artist:
            artist_name = dim_artist[0].get("artist_name", "")

        if not artist_name or not show_date:
            stats["skipped"] += 1
            continue

        candidates = tm_by_date.get(show_date, [])
        matched_url = None

        for candidate in candidates:
            for tm_artist in candidate["artist_names"]:
                if names_match(tm_artist, artist_name):
                    matched_url = candidate["url"]
                    break
            if matched_url:
                break

        if matched_url:
            write_tm_url(show["show_id"], matched_url)
            print(f"      ✅ Matched: {artist_name} on {show_date}")
            stats["matched"] += 1
        else:
            print(f"      ❌ No match: {artist_name} on {show_date}")
            stats["unmatched"] += 1

    return stats


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    script_start = time.time()

    print("=" * 60)
    print("Ticketmaster URL Enrichment — Grooveprint")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    venues = get_mapped_venues()
    print(f"\nFound {len(venues)} venues with TM mapping\n")

    # ── Pass 1: Populate missing lat/long from TM venue details (GP-98) ──────
    enrich_venue_coords()

    # ── Pass 2: Match upcoming events → ticketmaster_url ─────────────────────

    total_matched = 0
    total_unmatched = 0
    total_skipped = 0
    total_tm_calls = 0

    for venue in venues:
        venue_start = time.time()
        venue_id = venue["venue_id"]
        venue_name = venue["venue_name"]
        tm_venue_id = venue["tm_venue_id"]

        print(f"📍 {venue_name} (venue_id={venue_id}, tm_id={tm_venue_id})")

        db_shows = get_upcoming_shows(venue_id)
        if not db_shows:
            print(f"   No upcoming shows needing enrichment — skipping\n")
            continue

        print(f"   {len(db_shows)} upcoming shows to enrich")

        tm_events = fetch_tm_events(tm_venue_id)
        total_tm_calls += 1
        print(f"   {len(tm_events)} TM events found")

        if not tm_events:
            print(f"   No TM events — skipping\n")
            continue

        stats = match_and_enrich(tm_events, db_shows)
        total_matched += stats["matched"]
        total_unmatched += stats["unmatched"]
        total_skipped += stats["skipped"]

        venue_elapsed = time.time() - venue_start
        match_rate = (
            round(stats["matched"] / (stats["matched"] + stats["unmatched"]) * 100)
            if (stats["matched"] + stats["unmatched"]) > 0 else 0
        )

        print(
            f"   → Matched: {stats['matched']} | "
            f"Unmatched: {stats['unmatched']} | "
            f"Skipped: {stats['skipped']} | "
            f"Match rate: {match_rate}% | "
            f"Time: {venue_elapsed:.1f}s\n"
        )

        time.sleep(TM_RATE_LIMIT_DELAY)

    total_elapsed = time.time() - script_start
    total_shows = total_matched + total_unmatched + total_skipped
    overall_match_rate = (
        round(total_matched / (total_matched + total_unmatched) * 100)
        if (total_matched + total_unmatched) > 0 else 0
    )

    print("=" * 60)
    print("Summary")
    print(f"  Total matched:      {total_matched}")
    print(f"  Total unmatched:    {total_unmatched}")
    print(f"  Total skipped:      {total_skipped}")
    print(f"  Total shows:        {total_shows}")
    print(f"  Overall match rate: {overall_match_rate}%")
    print(f"  TM API calls made:  {total_tm_calls}")
    print(f"  Total runtime:      {total_elapsed:.1f}s")
    print(f"  Finished:           {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)


if __name__ == "__main__":
    main()
