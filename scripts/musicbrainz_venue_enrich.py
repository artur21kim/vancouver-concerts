#!/usr/bin/env python3
"""
scripts/musicbrainz_venue_enrich.py
GP-129 — Enrich dim_venue with MusicBrainz Place data: MBID, open/close dates,
          lat/long, and official website URL.

Modelled on musicbrainz_artist_enrich.py. For artist enrichment see that script.
For venue lat/long fallback after this script, see nominatim_enrich.py.

MusicBrainz data is CC0 licensed — no attribution required.
Rate limit: 1 req/sec max (enforced internally).

Two requests per matched venue:
  1. Search  /ws/2/place/?query=place:"{name}" AND area:"{city}"  — accept if score >= 85
  2. Lookup  /ws/2/place/{mbid}?inc=url-rels  — extract coords, dates, official homepage

Coordinate write policy:
  lat/long is only written if the venue's current latitude IS NULL (TM coords are preserved).
  Use --overwrite-coords to force-write MB coordinates even if already populated.

Pipeline order (post-ticket):
  1. tm_enrichment.py           — lat/long for TM-mapped venues
  2. musicbrainz_venue_enrich.py — lat/long + open/close dates + MBID  ← this script
  3. nominatim_enrich.py        — fallback for venues not matched in TM or MB

Usage:
    # Preflight — no DB writes (default):
    python scripts/musicbrainz_venue_enrich.py --limit 20

    # Live run (all unenriched venues):
    python scripts/musicbrainz_venue_enrich.py --live

    # Limit to a single city for testing:
    python scripts/musicbrainz_venue_enrich.py --live --city Vancouver --limit 50

    # Full overnight catch-up run:
    python scripts/musicbrainz_venue_enrich.py --live --verbose

    # Re-process already-enriched venues:
    python scripts/musicbrainz_venue_enrich.py --live --force

    # Overwrite existing lat/long with MB coordinates:
    python scripts/musicbrainz_venue_enrich.py --live --overwrite-coords

Prerequisites:
    pip install requests supabase python-dotenv --break-system-packages

    Schema migration — run in Supabase SQL editor before first --live run:
        ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS musicbrainz_place_id text;
        ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS begin_date date;
        ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS end_date date;
        ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS official_website_url text;

Env vars (resolved from .env.local if present, else environment):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

import argparse
import csv
import logging
import os
import time
from datetime import date
from pathlib import Path
from typing import Optional

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

from supabase import create_client

# ── Constants ─────────────────────────────────────────────────────────────────

MB_BASE = "https://musicbrainz.org/ws/2"
MB_HEADERS = {
    "User-Agent": "Grooveprint/1.0 (artur@grooveprint.app)",
    "Accept":     "application/json",
}

MIN_SCORE        = 85   # minimum MB search confidence score to accept a result
REQUEST_INTERVAL = 1.5  # seconds between API calls (MB enforces 1 req/sec; 1.5s gives headroom)

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── MusicBrainz helpers ───────────────────────────────────────────────────────

_last_request_at: float = 0.0


def _throttle() -> None:
    """Block until REQUEST_INTERVAL has elapsed since the last API call."""
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if elapsed < REQUEST_INTERVAL:
        time.sleep(REQUEST_INTERVAL - elapsed)
    _last_request_at = time.time()


def mb_get(path: str, params: dict, retries: int = 3) -> dict:
    """
    GET a MusicBrainz endpoint with rate limiting and retry on 503.
    MusicBrainz returns 503 (not 429) when the rate limit is hit.
    """
    url = f"{MB_BASE}/{path}"
    for attempt in range(retries):
        _throttle()
        try:
            resp = requests.get(url, params=params, headers=MB_HEADERS, timeout=15)
            if resp.status_code == 503:
                wait = 15 * (attempt + 1)
                log.warning(
                    "503 from MusicBrainz — waiting %ds before retry %d/%d",
                    wait, attempt + 1, retries,
                )
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            if attempt == retries - 1:
                raise
            log.warning("Request error (attempt %d/%d): %s", attempt + 1, retries, exc)
            time.sleep(3)
    return {}


def mb_search_place(venue_name: str, city: str) -> Optional[dict]:
    """
    Search MusicBrainz for a place (venue) by name, city-scoped only.

    Uses ONLY the city-scoped query: place:"{name}" AND area:"{city}"
    A name-only fallback was previously tried but removed — it caused dangerous
    cross-city false positives (e.g. "Beacon Theatre" matching NYC when searching
    for Vancouver venues, "Open Space" matching Michigan).

    Returns the top result dict if score >= MIN_SCORE, else None.
    """
    try:
        data = mb_get(
            "place/",
            {"query": f'place:"{venue_name}" AND area:"{city}"', "fmt": "json", "limit": 5},
        )
    except requests.HTTPError:
        return None

    places = data.get("places", [])
    if not places:
        return None

    top   = places[0]
    score = int(top.get("score", 0))
    return top if score >= MIN_SCORE else None


def mb_get_place_details(mbid: str) -> dict:
    """
    Look up a Place MBID with url-rels included.

    Returns a dict:
        lat          float | None
        lon          float | None
        begin_date   str | None   (raw MB partial date, e.g. "1977", "1977-03", "1977-03-15")
        end_date     str | None
        official_url str | None
    """
    data = mb_get(f"place/{mbid}", {"inc": "url-rels", "fmt": "json"})

    # Coordinates
    coords = data.get("coordinates") or {}
    lat_raw = coords.get("latitude")
    lon_raw = coords.get("longitude")

    # Life-span (open/close dates)
    life_span  = data.get("life-span") or {}
    begin_date = life_span.get("begin") or None
    end_date   = life_span.get("end")   or None

    # Official homepage URL (first match in URL relations)
    official_url: Optional[str] = None
    for rel in data.get("relations", []):
        if rel.get("type") == "official homepage":
            url = (rel.get("url") or {}).get("resource")
            if url:
                official_url = url
                break

    return {
        "lat":          float(lat_raw) if lat_raw is not None else None,
        "lon":          float(lon_raw) if lon_raw is not None else None,
        "begin_date":   begin_date,
        "end_date":     end_date,
        "official_url": official_url,
    }


def _mb_date_to_pg(mb_date: Optional[str]) -> Optional[str]:
    """
    Convert a MusicBrainz partial date string to a full ISO-8601 date that
    PostgreSQL's DATE type accepts.

    MB can return YYYY, YYYY-MM, or YYYY-MM-DD.
    Partials are padded to the first day of the month/year.
    Returns None if input is None or unparseable.
    """
    if not mb_date:
        return None
    parts = mb_date.strip().split("-")
    try:
        if len(parts) == 3:
            return mb_date                         # already YYYY-MM-DD
        elif len(parts) == 2:
            return f"{parts[0]}-{parts[1]:>02}-01"
        elif len(parts) == 1 and parts[0].isdigit():
            return f"{parts[0]}-01-01"
    except Exception:
        pass
    return None


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:          bool,
    limit:            Optional[int],
    force:            bool,
    city_filter:      Optional[str],
    overwrite_coords: bool,
    verbose:          bool,
) -> None:
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(supabase_url, supabase_key)

    # ── Load venues ───────────────────────────────────────────────────────────
    q = db.from_("dim_venue").select(
        "venue_id, venue_name, city, state, country, "
        "latitude, longitude, official_website_url, musicbrainz_place_id"
    )
    if not force:
        q = q.is_("musicbrainz_place_id", None)   # skip already-enriched venues
    if city_filter:
        q = q.eq("city", city_filter)
    if limit:
        q = q.limit(limit)

    venues = (q.execute()).data or []
    total  = len(venues)

    log.info(
        "Mode: %s | Venues to process: %d%s%s",
        "DRY-RUN" if dry_run else "LIVE",
        total,
        f" (capped at --limit {limit})" if limit else "",
        f" (city={city_filter})"        if city_filter else "",
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")

    # ── Review CSV ────────────────────────────────────────────────────────────
    csv_path   = Path("exports") / f"musicbrainz_venue_review_{date.today().isoformat()}.csv"
    review_rows: list[dict] = []

    stats = {
        "enriched":  0,   # MBID found + at least one field written
        "partial":   0,   # MBID found but no coords AND no URL (just dates/MBID)
        "no_match":  0,
        "error":     0,
    }

    for i, venue in enumerate(venues, 1):
        venue_id   = venue["venue_id"]
        venue_name = (venue.get("venue_name") or "").strip()
        city       = (venue.get("city")       or "").strip()

        if not venue_name:
            log.debug("Skipping venue_id=%d — no name", venue_id)
            continue

        log.debug("[%d/%d] %s, %s (id=%d)", i, total, venue_name, city, venue_id)

        try:
            # ── Step 1: Search ─────────────────────────────────────────────────
            top = mb_search_place(venue_name, city)

            if top is None:
                log.debug("No confident match: %s, %s", venue_name, city)
                stats["no_match"] += 1
                review_rows.append({
                    "venue_id":      venue_id,
                    "venue_name":    venue_name,
                    "city":          city,
                    "reason":        "no_match",
                    "mbid":          "",
                    "mb_score":      "",
                    "disambiguation":"",
                    "begin_date":    "",
                    "end_date":      "",
                    "lat":           "",
                    "lon":           "",
                    "official_url":  "",
                })
                continue

            mbid           = top["id"]
            mb_score       = int(top.get("score", 0))
            disambiguation = (top.get("disambiguation") or "").strip()

            # ── Step 2: Lookup details ─────────────────────────────────────────
            details      = mb_get_place_details(mbid)
            begin_date   = _mb_date_to_pg(details["begin_date"])
            end_date     = _mb_date_to_pg(details["end_date"])
            lat          = details["lat"]
            lon          = details["lon"]
            official_url = details["official_url"]

            # ── Build update dict ──────────────────────────────────────────────
            update: dict = {"musicbrainz_place_id": mbid}

            if begin_date:
                update["begin_date"] = begin_date
            if end_date:
                update["end_date"] = end_date

            # Coordinates: only write if venue has no coords OR --overwrite-coords
            write_coords = overwrite_coords or (venue.get("latitude") is None)
            if lat is not None and lon is not None and write_coords:
                update["latitude"]  = lat
                update["longitude"] = lon

            # Website URL: only write if not already set (or --force)
            if official_url and (force or not venue.get("official_website_url")):
                update["official_website_url"] = official_url

            # ── Log ────────────────────────────────────────────────────────────
            coord_str = f"{lat:.5f},{lon:.5f}" if lat is not None else "no coords"
            date_str  = f"{begin_date or '?'}→{end_date or '?'}"
            action    = "[DRY-RUN]" if dry_run else "[WRITE]  "
            log.info(
                "%s [%d/%d]  %-42s  score=%-3s  %s  %s%s",
                action, i, total,
                f"{venue_name[:30]}, {city}"[:42],
                mb_score,
                coord_str,
                date_str,
                f"  ⚠ disambig={disambiguation!r}" if disambiguation else "",
            )

            if not dry_run:
                db.from_("dim_venue").update(update).eq("venue_id", venue_id).execute()

            stats["enriched"] += 1
            if lat is None and official_url is None:
                stats["partial"] += 1

            # Flag for review: disambiguation present, or MB returned no coords/URL
            if disambiguation or (lat is None and official_url is None):
                review_rows.append({
                    "venue_id":       venue_id,
                    "venue_name":     venue_name,
                    "city":           city,
                    "reason":         "verify_disambiguation" if disambiguation else "partial_data",
                    "mbid":           mbid,
                    "mb_score":       mb_score,
                    "disambiguation": disambiguation,
                    "begin_date":     begin_date  or "",
                    "end_date":       end_date    or "",
                    "lat":            lat         if lat is not None else "",
                    "lon":            lon         if lon is not None else "",
                    "official_url":   official_url or "",
                })

        except requests.HTTPError as exc:
            log.warning("HTTP error for %s (id=%d): %s", venue_name, venue_id, exc)
            stats["error"] += 1
        except Exception as exc:
            log.error("Unexpected error for %s (id=%d): %s", venue_name, venue_id, exc)
            stats["error"] += 1

        # Progress heartbeat every 100 venues (useful for overnight runs)
        if i % 100 == 0:
            log.info(
                "── Progress %d/%d  enriched=%d  no_match=%d  errors=%d",
                i, total, stats["enriched"], stats["no_match"], stats["error"],
            )

    # ── Write review CSV ───────────────────────────────────────────────────────
    if review_rows:
        csv_path.parent.mkdir(exist_ok=True)
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "venue_id", "venue_name", "city", "reason",
                "mbid", "mb_score", "disambiguation",
                "begin_date", "end_date", "lat", "lon", "official_url",
            ])
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", csv_path, len(review_rows))

    # ── Summary ────────────────────────────────────────────────────────────────
    match_rate = (
        round(stats["enriched"] / total * 100)
        if total else 0
    )
    log.info(
        "Done — enriched: %d (%d%%) | partial (dates/MBID only): %d | "
        "no_match: %d | error: %d | total: %d",
        stats["enriched"], match_rate,
        stats["partial"],
        stats["no_match"],
        stats["error"],
        total,
    )
    if dry_run and stats["enriched"] > 0:
        log.info("Re-run with --live to commit %d venue updates.", stats["enriched"])


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Enrich dim_venue with MusicBrainz Place data: "
            "MBID, open/close dates, lat/long, and official website URL."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live",
        action="store_true", default=False,
        help="Commit updates to dim_venue (default: dry-run, no writes)",
    )
    parser.add_argument(
        "--limit",
        type=int, default=None, metavar="N",
        help="Process at most N venues (useful for test batches)",
    )
    parser.add_argument(
        "--force",
        action="store_true", default=False,
        help="Re-process venues that already have musicbrainz_place_id set",
    )
    parser.add_argument(
        "--city",
        default=None, dest="city_filter", metavar="CITY",
        help="Only process venues in this city, e.g. Vancouver, Toronto, Seattle",
    )
    parser.add_argument(
        "--overwrite-coords",
        action="store_true", default=False,
        help=(
            "Overwrite existing lat/long with MB coordinates "
            "(default: only write if latitude IS NULL)"
        ),
    )
    parser.add_argument(
        "--verbose",
        action="store_true", default=False,
        help="Show DEBUG-level logs (per-venue detail)",
    )
    args = parser.parse_args()

    run(
        dry_run=not args.live,
        limit=args.limit,
        force=args.force,
        city_filter=args.city_filter,
        overwrite_coords=args.overwrite_coords,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
