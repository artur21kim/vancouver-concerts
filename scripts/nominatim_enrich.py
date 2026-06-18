#!/usr/bin/env python3
"""
Grooveprint — Venue lat/long enrichment via OpenStreetMap Nominatim
scripts/nominatim_enrich.py

Geocodes dim_venue rows that are missing latitude/longitude, using the
OpenStreetMap Nominatim search API as a fallback after TM enrichment.

Two modes:
  Auto-write  — importance score >= threshold → write lat/long to dim_venue
  Review CSV  — importance score <  threshold → log for manual verification

Rate limit: Nominatim ToS requires max 1 request/sec and a valid User-Agent.
This script enforces a 1.1s inter-request delay automatically.

Usage:
    # Preflight — no DB writes (default):
    python scripts/nominatim_enrich.py --limit 20

    # Live run — commits high-confidence matches to DB:
    python scripts/nominatim_enrich.py --live

    # Limit to a specific city (useful post-ingestion per city):
    python scripts/nominatim_enrich.py --live --city Seattle

    # Lower the confidence threshold (default 0.3 — use 0.4+ for stricter matching):
    python scripts/nominatim_enrich.py --live --threshold 0.4

    # Re-process venues that already have coordinates:
    python scripts/nominatim_enrich.py --live --force

Required .env:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key
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
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

NOMINATIM_URL      = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS  = {"User-Agent": "Grooveprint/1.0 (grooveprint.app)"}
REQUEST_INTERVAL   = 1.1   # Nominatim ToS: max 1 req/sec
DEFAULT_THRESHOLD  = 0.3   # importance score below this → review CSV, not auto-write
EXPORTS_DIR        = Path("exports")

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Supabase REST helpers ─────────────────────────────────────────────────────

_BASE_HEADERS = {
    "apikey":        SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type":  "application/json",
}


def _headers(prefer: str = "return=minimal") -> dict:
    return {**_BASE_HEADERS, "Prefer": prefer}


def sb_get_all(table: str, params: dict, page_size: int = 1000) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    all_rows: list = []
    offset = 0
    while True:
        resp = requests.get(
            url, headers=_headers(),
            params={**params, "limit": page_size, "offset": offset},
        )
        resp.raise_for_status()
        batch = resp.json()
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return all_rows


def sb_update_venue_coords(venue_id: int, lat: float, lon: float) -> None:
    url = f"{SUPABASE_URL}/rest/v1/dim_venue"
    resp = requests.patch(
        url,
        headers=_headers("return=minimal"),
        params={"venue_id": f"eq.{venue_id}"},
        json={"latitude": lat, "longitude": lon},
    )
    resp.raise_for_status()


# ── Nominatim geocoding ───────────────────────────────────────────────────────

_last_request_at: float = 0.0


def _throttle() -> None:
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if elapsed < REQUEST_INTERVAL:
        time.sleep(REQUEST_INTERVAL - elapsed)
    _last_request_at = time.time()


def geocode_venue(
    venue_name: str,
    city: str,
    state: str,
    country: str,
    retries: int = 3,
) -> Optional[dict]:
    """
    Query Nominatim for a venue. Returns a result dict or None on failure.

    Result keys: lat, lon, importance, display_name, confidence_tier
    """
    # Build query: specific first, then broader fallback
    queries = []
    if venue_name and city:
        queries.append(f"{venue_name}, {city}, {state}, {country}".strip(", "))
    if venue_name and city:
        queries.append(f"{venue_name}, {city}")   # fallback without state/country

    for query in queries:
        for attempt in range(retries):
            _throttle()
            try:
                resp = requests.get(
                    NOMINATIM_URL,
                    headers=NOMINATIM_HEADERS,
                    params={
                        "q":              query,
                        "format":         "json",
                        "limit":          1,
                        "addressdetails": 1,
                    },
                    timeout=10,
                )
                resp.raise_for_status()
                results = resp.json()

                if results:
                    r = results[0]
                    return {
                        "lat":          float(r["lat"]),
                        "lon":          float(r["lon"]),
                        "importance":   float(r.get("importance") or 0),
                        "display_name": r.get("display_name", ""),
                        "query_used":   query,
                    }

            except requests.RequestException as exc:
                if attempt < retries - 1:
                    log.warning("Nominatim error (attempt %d/%d): %s", attempt + 1, retries, exc)
                    time.sleep(2)
                else:
                    log.error("Nominatim failed after %d attempts for '%s': %s", retries, query, exc)

    return None


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:   bool,
    limit:     Optional[int],
    city:      Optional[str],
    threshold: float,
    force:     bool,
    verbose:   bool,
) -> None:
    if verbose:
        log.setLevel(logging.DEBUG)

    # ── Load venues ───────────────────────────────────────────────────────────
    params: dict = {
        "select": "venue_id,venue_name,city,state,country,latitude,longitude,other_names",
    }
    if not force:
        params["latitude"] = "is.null"
    if city:
        params["city"] = f"eq.{city}"

    log.info("Loading venues from Supabase…")
    venues = sb_get_all("dim_venue", params)

    if limit:
        venues = venues[:limit]

    total = len(venues)
    log.info(
        "Mode: %s | Venues to geocode: %d%s%s",
        "DRY-RUN" if dry_run else "LIVE",
        total,
        f" (capped at --limit {limit})" if limit else "",
        f" (city={city})" if city else "",
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")
    log.info("Confidence threshold: %.2f (below = review CSV, not auto-write)", threshold)

    # ── Output paths ──────────────────────────────────────────────────────────
    EXPORTS_DIR.mkdir(exist_ok=True)
    today = date.today().isoformat()
    review_csv_path = EXPORTS_DIR / f"nominatim_review_{today}.csv"
    review_rows: list[dict] = []

    # ── Stats ─────────────────────────────────────────────────────────────────
    stats = {
        "written":       0,
        "review":        0,
        "no_result":     0,
        "skipped":       0,
        "error":         0,
    }

    for i, venue in enumerate(venues, 1):
        venue_id   = venue["venue_id"]
        venue_name = (venue.get("venue_name") or "").strip()
        city_val   = (venue.get("city")       or "").strip()
        state_val  = (venue.get("state")      or "").strip()
        country_val= (venue.get("country")    or "").strip()

        if not venue_name:
            log.debug("[%d/%d] Skipping venue_id=%d — no name", i, total, venue_id)
            stats["skipped"] += 1
            continue

        # Parse other_names for fallback queries (e.g. "The Plaza Club, Venue" for The Pearl)
        other_names_raw = (venue.get("other_names") or "")
        alt_names = [n.strip() for n in other_names_raw.split(",") if n.strip() and n.strip() != venue_name]

        log.debug("[%d/%d] %s, %s", i, total, venue_name, city_val)

        result = geocode_venue(venue_name, city_val, state_val, country_val)

        # Fallback: try other_names if primary name got no result
        matched_via = venue_name
        if result is None and alt_names:
            for alt in alt_names[:3]:  # try up to 3 alt names
                result = geocode_venue(alt, city_val, state_val, country_val)
                if result is not None:
                    matched_via = alt
                    log.debug("Matched via other_name '%s'", alt)
                    break

        if result is None:
            log.info(
                "[%d/%d] NO RESULT  %s, %s",
                i, total, venue_name, city_val,
            )
            stats["no_result"] += 1
            review_rows.append({
                "venue_id":    venue_id,
                "venue_name":  venue_name,
                "city":        city_val,
                "state":       state_val,
                "country":     country_val,
                "reason":      "no_result",
                "lat":         "",
                "lon":         "",
                "importance":  "",
                "display_name":"",
                "query_used":  "",
            })
            continue

        lat        = result["lat"]
        lon        = result["lon"]
        importance = result["importance"]
        display    = result["display_name"]
        query_used = result["query_used"]

        if importance >= threshold:
            # High confidence — auto-write
            action = "[DRY-RUN]" if dry_run else "[WRITE]  "
            alt_note = f" (via '{matched_via}')" if matched_via != venue_name else ""
            log.info(
                "%s [%d/%d] %-40s → %.5f, %.5f  (importance=%.3f)%s",
                action, i, total, venue_name[:40], lat, lon, importance, alt_note,
            )
            if not dry_run:
                try:
                    sb_update_venue_coords(venue_id, lat, lon)
                    stats["written"] += 1
                except Exception as exc:
                    log.error("DB write failed for venue_id=%d: %s", venue_id, exc)
                    stats["error"] += 1
            else:
                stats["written"] += 1
        else:
            # Low confidence — flag for manual review
            alt_note = f" (via '{matched_via}')" if matched_via != venue_name else ""
            log.info(
                "[REVIEW] [%d/%d] %-40s → %.5f, %.5f  (importance=%.3f — below threshold)%s",
                i, total, venue_name[:40], lat, lon, importance, alt_note,
            )
            stats["review"] += 1
            review_rows.append({
                "venue_id":    venue_id,
                "venue_name":  venue_name,
                "city":        city_val,
                "state":       state_val,
                "country":     country_val,
                "reason":      "low_confidence",
                "lat":         lat,
                "lon":         lon,
                "importance":  f"{importance:.4f}",
                "display_name":display[:120],
                "query_used":  query_used,
            })

    # ── Write review CSV ──────────────────────────────────────────────────────
    if review_rows:
        with open(review_csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "venue_id", "venue_name", "city", "state", "country",
                "reason", "lat", "lon", "importance", "display_name", "query_used",
            ])
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", review_csv_path, len(review_rows))

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info(
        "Done — written: %d | review: %d | no_result: %d | skipped: %d | error: %d",
        stats["written"], stats["review"], stats["no_result"],
        stats["skipped"], stats["error"],
    )
    if dry_run and stats["written"] > 0:
        log.info("Re-run with --live to commit %d coordinate updates.", stats["written"])

    if review_rows:
        log.info("")
        log.info("Manual review workflow for low-confidence rows:")
        log.info("  1. Open %s", review_csv_path)
        log.info("  2. Verify lat/lon in Google Maps for each row")
        log.info("  3. Run SQL for confirmed rows:")
        log.info("     UPDATE dim_venue SET latitude = <lat>, longitude = <lon>")
        log.info("     WHERE venue_id = <id>;")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Geocode dim_venue lat/long via OpenStreetMap Nominatim.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live",
        action="store_true",
        default=False,
        help="Commit coordinate updates to dim_venue (default: dry-run, no writes)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        metavar="N",
        help="Process at most N venues (useful for test batches)",
    )
    parser.add_argument(
        "--city",
        default=None,
        help="Only geocode venues in this city (e.g. Seattle, Toronto)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        metavar="SCORE",
        help=f"Minimum Nominatim importance score for auto-write (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=False,
        help="Re-process venues that already have lat/long set",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        default=False,
        help="Show DEBUG-level logs (per-venue detail)",
    )
    args = parser.parse_args()

    run(
        dry_run=not args.live,
        limit=args.limit,
        city=args.city,
        threshold=args.threshold,
        force=args.force,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
