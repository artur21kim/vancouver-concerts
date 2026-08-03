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


def sb_update_city_coords(city_id: int, lat: float, lon: float) -> None:
    url = f"{SUPABASE_URL}/rest/v1/dim_city"
    resp = requests.patch(
        url,
        headers=_headers("return=minimal"),
        params={"city_id": f"eq.{city_id}"},
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
    # Build query: specific first, then broader fallback.
    # State is kept in both queries — dropping it risks resolving to a
    # same-named city in a different state (e.g. Englewood, NJ vs Englewood, CO).
    # Only country is dropped on fallback.
    queries = []
    if venue_name and city:
        queries.append(f"{venue_name}, {city}, {state}, {country}".strip(", "))
    if venue_name and city and state:
        queries.append(f"{venue_name}, {city}, {state}".strip(", "))   # fallback without country
    elif venue_name and city:
        queries.append(f"{venue_name}, {city}")   # only if no state on record at all

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


# ── City-dimension coordinate backfill (GP-153) ───────────────────────────────

# Same country bounding boxes used by the dim_city seed SQL (Step 3). A geocode
# that lands outside its country's box is rejected, never written — the city
# dimension must not absorb the kind of stray match that corrupted the venue AVGs.
def _within_country_box(lat: float, lon: float, country: str) -> bool:
    c = (country or "").lower()
    if "canada" in c:
        return 42.0 <= lat <= 60.0 and -141.0 <= lon <= -52.0
    if "united states" in c:
        return 24.0 <= lat <= 50.0 and -125.0 <= lon <= -66.0
    # Unknown country (e.g. future European data) — no box defined; allow but note it.
    log.debug("No bounding box for country '%s' — writing city coord unvalidated.", country)
    return True


def geocode_city(
    city: str,
    state: str,
    country: str,
    retries: int = 3,
) -> Optional[dict]:
    """Geocode a city *centre* (not a venue). Returns lat/lon/importance dict or None.

    Result keys: lat, lon, importance, display_name, query_used
    """
    if not city:
        return None
    queries = [f"{city}, {state}, {country}".strip(", ")]
    if state:
        queries.append(f"{city}, {state}".strip(", "))   # fallback without country, keep state
    else:
        queries.append(f"{city}, {country}".strip(", "))  # only if no state on record at all
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
                    log.warning("Nominatim city error (attempt %d/%d): %s", attempt + 1, retries, exc)
                    time.sleep(2)
                else:
                    log.error("Nominatim city geocode failed for '%s': %s", query, exc)
    return None


def backfill_dim_city_coords(
    dry_run:    bool,
    only_city:  Optional[str],
    only_state: Optional[str] = None,
    verbose:    bool = False,
) -> dict:
    """Fill dim_city.latitude/longitude for rows missing coords by geocoding the city name.

    Runs at the end of a venue pass (scoped to --city, optionally --state) and standalone
    via --cities-only. Geocodes the city itself for a proper centre point, validates against
    the country bounding box, and writes only on pass — out-of-box and no-result rows are
    logged and left NULL (no map bubble until resolved), never written with a bad coordinate.

    --state matters whenever a city name exists in more than one state/province (e.g.
    Lakewood, CO vs Lakewood, WA) — without it, dim_city would still resolve to the single
    correct row by city+state combination already in the table, but --state lets the caller
    be explicit and avoids ambiguity if a city name is ever duplicated within dim_city itself.
    """
    params: dict = {"select": "city_id,city,state,country,latitude", "latitude": "is.null"}
    if only_city:
        params["city"] = f"eq.{only_city}"
    if only_state:
        params["state"] = f"eq.{only_state}"
    cities = sb_get_all("dim_city", params)

    stats = {"written": 0, "out_of_box": 0, "no_result": 0}
    scope = ""
    if only_city:
        scope = f" (city={only_city}{f', state={only_state}' if only_state else ''})"
    elif only_state:
        scope = f" (state={only_state})"
    if not cities:
        log.info("dim_city backfill — no cities missing coordinates%s.", scope)
        return stats

    log.info("dim_city backfill — %d city/cities missing coordinates%s", len(cities), scope)
    for c in cities:
        city_id = c["city_id"]
        city    = (c.get("city")    or "").strip()
        state   = (c.get("state")   or "").strip()
        country = (c.get("country") or "").strip()
        if not city:
            continue

        result = geocode_city(city, state, country)
        if result is None:
            log.info("[CITY no_result] %s, %s, %s", city, state, country)
            stats["no_result"] += 1
            continue

        lat, lon = result["lat"], result["lon"]
        if not _within_country_box(lat, lon, country):
            log.warning(
                "[CITY out_of_box] %s, %s → %.5f, %.5f  (rejected — outside %s box)",
                city, state, lat, lon, country,
            )
            stats["out_of_box"] += 1
            continue

        action = "[DRY-RUN]" if dry_run else "[WRITE]  "
        log.info(
            "%s [CITY] %-28s → %.5f, %.5f  (importance=%.3f)",
            action, f"{city}, {state}", lat, lon, result["importance"],
        )
        if not dry_run:
            try:
                sb_update_city_coords(city_id, lat, lon)
                stats["written"] += 1
            except Exception as exc:
                log.error("dim_city write failed for city_id=%d: %s", city_id, exc)
        else:
            stats["written"] += 1

    log.info(
        "dim_city backfill done — written: %d | out_of_box: %d | no_result: %d",
        stats["written"], stats["out_of_box"], stats["no_result"],
    )
    return stats


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:    bool,
    limit:      Optional[int],
    city:       Optional[str],
    state:      Optional[str],
    threshold:  float,
    force:      bool,
    verbose:    bool,
    cities_only: bool = False,
) -> None:
    if verbose:
        log.setLevel(logging.DEBUG)

    scope_str = f" (city={city}{f', state={state}' if state else ''})" if city else (
        f" (state={state})" if state else ""
    )

    # ── dim_city-only mode (GP-153): skip the venue pass entirely ─────────────
    if cities_only:
        log.info(
            "Mode: %s | dim_city coordinate backfill only%s",
            "DRY-RUN" if dry_run else "LIVE",
            scope_str,
        )
        backfill_dim_city_coords(dry_run=dry_run, only_city=city, only_state=state, verbose=verbose)
        return

    # ── Load venues ───────────────────────────────────────────────────────────
    params: dict = {
        "select": "venue_id,venue_name,city,state,country,latitude,longitude,other_names",
    }
    if not force:
        params["latitude"] = "is.null"
    if city:
        params["city"] = f"eq.{city}"
    if state:
        params["state"] = f"eq.{state}"

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
        scope_str,
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")
    log.info("Confidence threshold: %.2f (below = review CSV, not auto-write)", threshold)

    # ── Output paths ──────────────────────────────────────────────────────────
    today = date.today().isoformat()
    city_slug = f"_{city.lower().replace(' ', '_')}" if city else ""
    review_csv_path = EXPORTS_DIR / "pipeline_reviews" / f"nominatim_review{city_slug}_{today}.csv"
    review_csv_path.parent.mkdir(parents=True, exist_ok=True)
    review_rows: list[dict] = []

    # ── Stats ─────────────────────────────────────────────────────────────────
    stats = {
        "written":       0,
        "review":        0,
        "no_result":     0,
        "skipped":       0,
        "out_of_box":    0,
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

        # Reject results outside the expected country's bounding box outright —
        # a high-importance match in the wrong country/region is worse than a
        # low-confidence one, since it would otherwise auto-write silently.
        # Same box used for the dim_city backfill (GP-153).
        if not _within_country_box(lat, lon, country_val):
            alt_note = f" (via '{matched_via}')" if matched_via != venue_name else ""
            log.warning(
                "[OUT_OF_BOX] [%d/%d] %-40s → %.5f, %.5f  (rejected — outside %s box)%s",
                i, total, venue_name[:40], lat, lon, country_val, alt_note,
            )
            stats["out_of_box"] += 1
            review_rows.append({
                "venue_id":    venue_id,
                "venue_name":  venue_name,
                "city":        city_val,
                "state":       state_val,
                "country":     country_val,
                "reason":      "out_of_box",
                "lat":         lat,
                "lon":         lon,
                "importance":  f"{importance:.4f}",
                "display_name":display[:120],
                "query_used":  query_used,
            })
            continue

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
        "Done — written: %d | review: %d | no_result: %d | skipped: %d | out_of_box: %d | error: %d",
        stats["written"], stats["review"], stats["no_result"],
        stats["skipped"], stats["out_of_box"], stats["error"],
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

    # ── dim_city coordinate backfill (GP-153) ─────────────────────────────────
    # After the venue pass, fill any dim_city rows still missing coords — scoped
    # to --city (and --state, when given) so `nominatim_enrich.py --live --city
    # Lakewood --state CO` also gives Lakewood, CO its city-centre point in the
    # same run, without touching the unrelated Lakewood, WA row.
    log.info("")
    backfill_dim_city_coords(dry_run=dry_run, only_city=city, only_state=state, verbose=verbose)


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
        "--state",
        default=None,
        help="Scope --city to a specific state/province (e.g. --city Lakewood --state CO). "
             "Required when a city name exists in more than one state — without it, venues "
             "sharing the same city name across different states are processed together.",
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
        "--cities-only",
        action="store_true",
        default=False,
        help="Skip the venue pass; only backfill dim_city coordinates (geocode city centres)",
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
        state=args.state,
        threshold=args.threshold,
        force=args.force,
        verbose=args.verbose,
        cities_only=args.cities_only,
    )


if __name__ == "__main__":
    main()
