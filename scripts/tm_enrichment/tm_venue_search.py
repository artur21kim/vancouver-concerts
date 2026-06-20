#!/usr/bin/env python3
"""
Grooveprint — Ticketmaster Venue ID Discovery
scripts/tm_enrichment/tm_venue_search.py

Searches the TM Discovery API to find and write tm_venue_id for dim_venue rows
that don't have one yet. Also writes latitude/longitude from TM (which returns
coords in the search response), so a separate tm_enrichment Pass 1 run is not
needed for newly discovered venues.

Follows the same pattern as nominatim_enrich.py:
  - Dry-run by default; --live to commit
  - Auto-writes high-confidence matches
  - Review CSV for anything below threshold (ambiguous name matches)
  - --city filter for per-city runs
  - --threshold tunable (default 0.85)

TM rate limit: 5 req/sec (enforced via REQUEST_DELAY).

Pipeline position:
  run BEFORE nominatim_enrich.py so Nominatim only covers venues TM doesn't know

Usage:
    # Dry run (default — no writes):
    python scripts/tm_enrichment/tm_venue_search.py --city Seattle

    # Live run:
    python scripts/tm_enrichment/tm_venue_search.py --city Seattle --live
    python scripts/tm_enrichment/tm_venue_search.py --city Toronto --live

    # Tune confidence threshold (default 0.85):
    python scripts/tm_enrichment/tm_venue_search.py --city Seattle --live --threshold 0.80

    # Re-process venues already mapped (for coord refresh):
    python scripts/tm_enrichment/tm_venue_search.py --city Seattle --live --force

Required .env (same folder as tm_enrichment.py):
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key
    TM_API_KEY=your-ticketmaster-consumer-key
"""

import argparse
import csv
import logging
import os
import re
import time
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
TM_API_KEY   = os.environ["TM_API_KEY"]

TM_VENUES_URL   = "https://app.ticketmaster.com/discovery/v2/venues.json"
REQUEST_DELAY   = 0.25   # 4 req/sec — safely under the 5/sec TM limit
PAGE_SIZE       = 20     # TM venues search max per page
DEFAULT_THRESHOLD = 0.85

EXPORTS_DIR = Path("exports")

# Map Grooveprint country names → TM ISO codes
COUNTRY_CODE_MAP = {
    "canada":        "CA",
    "united states": "US",
    "usa":           "US",
    "us":            "US",
    "ca":            "CA",
}

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
    "Prefer":        "return=minimal",
}


def sb_get_all(table: str, params: dict, page_size: int = 1000) -> list:
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    all_rows: list = []
    offset = 0
    while True:
        resp = requests.get(
            url, headers=_BASE_HEADERS,
            params={**params, "limit": page_size, "offset": offset},
        )
        resp.raise_for_status()
        batch = resp.json()
        all_rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return all_rows


def sb_patch(venue_id: int, data: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/dim_venue"
    resp = requests.patch(
        url, headers=_BASE_HEADERS,
        params={"venue_id": f"eq.{venue_id}"},
        json=data,
    )
    resp.raise_for_status()


# ── Name normalisation ────────────────────────────────────────────────────────

_STRIP_WORDS = re.compile(
    r"\b(the|a|an|and|&|at|of|in)\b", re.IGNORECASE
)
_PUNCT = re.compile(r"[^a-z0-9\s]")
_SPACES = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Lowercase, strip punctuation and common articles for fuzzy comparison."""
    s = name.lower().strip()
    s = _PUNCT.sub(" ", s)
    s = _STRIP_WORDS.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    return s


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


# ── TM API helpers ────────────────────────────────────────────────────────────

_last_tm_call: float = 0.0


def _tm_throttle() -> None:
    global _last_tm_call
    elapsed = time.time() - _last_tm_call
    if elapsed < REQUEST_DELAY:
        time.sleep(REQUEST_DELAY - elapsed)
    _last_tm_call = time.time()


def tm_search_venues(
    venue_name: str,
    city:       str,
    state:      str,
    country:    str,
    retries:    int = 3,
) -> list[dict]:
    """
    Search TM Discovery API for venues matching name + city.

    Returns a list of TM venue dicts (may be empty). Each dict contains at
    minimum: id, name, city, state, country, location (lat/lon).
    """
    country_code = COUNTRY_CODE_MAP.get(country.lower(), country.upper()[:2])

    # State code: TM expects the abbreviation (WA, ON, BC etc.)
    # dim_venue.state is already stored as the abbreviation so use as-is.
    params: dict = {
        "apikey":      TM_API_KEY,
        "keyword":     venue_name,
        "city":        city,
        "countryCode": country_code,
        "size":        PAGE_SIZE,
    }
    if state:
        params["stateCode"] = state

    for attempt in range(retries):
        _tm_throttle()
        try:
            resp = requests.get(TM_VENUES_URL, params=params, timeout=10)

            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 5))
                log.warning("429 from TM — waiting %ds", wait)
                time.sleep(wait)
                continue

            if resp.status_code == 404:
                return []

            resp.raise_for_status()
            data = resp.json()
            embedded = data.get("_embedded", {})
            return embedded.get("venues", [])

        except requests.RequestException as exc:
            if attempt == retries - 1:
                log.error("TM request failed after %d attempts: %s", retries, exc)
                return []
            log.warning("TM request error (attempt %d/%d): %s", attempt + 1, retries, exc)
            time.sleep(1)

    return []


def parse_tm_venue(tm_venue: dict) -> dict:
    """Extract the fields we care about from a TM venue result."""
    loc      = tm_venue.get("location") or {}
    address  = tm_venue.get("address")  or {}
    city_obj = tm_venue.get("city")     or {}
    state_obj= tm_venue.get("state")    or {}
    country_obj = tm_venue.get("country") or {}

    lat_raw      = loc.get("latitude")
    lon_raw      = loc.get("longitude")
    country_code = country_obj.get("countryCode", "")

    lat = float(lat_raw) if lat_raw else None
    lon = float(lon_raw) if lon_raw else None

    # Guard: North American venues must have negative longitude.
    # TM occasionally stores positive longitudes for US/CA venues (data error).
    if country_code in ("US", "CA") and lon is not None and lon > 0:
        lat, lon = None, None

    return {
        "tm_id":      tm_venue.get("id", ""),
        "tm_name":    tm_venue.get("name", ""),
        "tm_city":    city_obj.get("name", ""),
        "tm_state":   state_obj.get("stateCode") or state_obj.get("name", ""),
        "tm_country": country_code,
        "tm_address": address.get("line1", ""),
        "lat":        lat,
        "lon":        lon,
    }


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:    bool,
    city:       Optional[str],
    threshold:  float,
    force:      bool,
    verbose:    bool,
    limit:      Optional[int],
) -> None:
    if verbose:
        log.setLevel(logging.DEBUG)

    # ── Load venues ───────────────────────────────────────────────────────────
    params: dict = {
        "select": "venue_id,venue_name,city,state,country,latitude,longitude,tm_venue_id",
    }
    if not force:
        params["tm_venue_id"] = "is.null"
    if city:
        params["city"] = f"eq.{city}"

    log.info("Loading venues from Supabase…")
    venues = sb_get_all("dim_venue", params)
    if limit:
        venues = venues[:limit]

    total = len(venues)
    log.info(
        "Mode: %s | Venues to search: %d%s%s",
        "DRY-RUN" if dry_run else "LIVE",
        total,
        f" (city={city})" if city else "",
        f" (capped at {limit})" if limit else "",
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")
    log.info("Confidence threshold: %.2f", threshold)

    # ── Review CSV ────────────────────────────────────────────────────────────
    EXPORTS_DIR.mkdir(exist_ok=True)
    today = date.today().isoformat()
    city_slug = city.lower().replace(" ", "_") if city else "all"
    review_path = EXPORTS_DIR / f"tm_venue_search_review_{city_slug}_{today}.csv"
    review_rows: list[dict] = []

    stats = {
        "written":    0,   # tm_venue_id + coords written
        "no_coords":  0,   # tm_venue_id written but TM had no coords
        "review":     0,   # below threshold — logged for manual check
        "no_result":  0,   # TM returned nothing
        "skipped":    0,   # no venue name
        "error":      0,
    }

    for i, venue in enumerate(venues, 1):
        venue_id   = int(venue["venue_id"])
        venue_name = (venue.get("venue_name") or "").strip()
        city_val   = (venue.get("city")       or "").strip()
        state_val  = (venue.get("state")      or "").strip()
        country_val= (venue.get("country")    or "").strip()

        if not venue_name:
            stats["skipped"] += 1
            continue

        log.debug("[%d/%d] %s, %s", i, total, venue_name, city_val)

        try:
            results = tm_search_venues(venue_name, city_val, state_val, country_val)

            if not results:
                log.debug("No TM results: %s, %s", venue_name, city_val)
                stats["no_result"] += 1
                review_rows.append({
                    "venue_id":    venue_id,
                    "venue_name":  venue_name,
                    "city":        city_val,
                    "state":       state_val,
                    "country":     country_val,
                    "reason":      "no_result",
                    "tm_id":       "",
                    "tm_name":     "",
                    "tm_city":     "",
                    "tm_address":  "",
                    "similarity":  "",
                    "lat":         "",
                    "lon":         "",
                })
                continue

            # Score all results and pick the best match
            best = None
            best_score = 0.0
            for tm_v in results:
                parsed = parse_tm_venue(tm_v)
                score  = name_similarity(venue_name, parsed["tm_name"])
                if score > best_score:
                    best_score = score
                    best = parsed

            if best is None:
                stats["no_result"] += 1
                continue

            label = f"{venue_name[:30]}, {city_val}"[:44]

            # State validation: if we queried with a stateCode and TM matched a
            # venue in a different state, move to review regardless of name score.
            # Catches cross-country matches (Blood Brothers Brewing → New Orleans,
            # Christ Episcopal Church → Tacoma WA, etc.)
            state_mismatch = (
                state_val
                and best["tm_state"]
                and best["tm_state"].upper() != state_val.upper()
            )
            if state_mismatch:
                log.info(
                    "[REVIEW] [%d/%d] %-44s → %-40s score=%.2f  "
                    "(state mismatch: queried %s, TM returned %s)",
                    i, total, label, best["tm_name"][:40], best_score,
                    state_val.upper(), best["tm_state"].upper(),
                )
                stats["review"] += 1
                review_rows.append({
                    "venue_id":    venue_id,
                    "venue_name":  venue_name,
                    "city":        city_val,
                    "state":       state_val,
                    "country":     country_val,
                    "reason":      "state_mismatch",
                    "tm_id":       best["tm_id"],
                    "tm_name":     best["tm_name"],
                    "tm_city":     best["tm_city"],
                    "tm_address":  best["tm_address"],
                    "similarity":  f"{best_score:.3f}",
                    "lat":         best["lat"] if best["lat"] else "",
                    "lon":         best["lon"] if best["lon"] else "",
                })
                continue

            if best_score >= threshold:
                # High confidence — write tm_venue_id + coords
                update: dict = {"tm_venue_id": best["tm_id"]}
                has_coords = (
                    best["lat"] is not None and best["lon"] is not None
                    and not (best["lat"] == 0.0 and best["lon"] == 0.0)
                )
                if has_coords:
                    update["latitude"]  = best["lat"]
                    update["longitude"] = best["lon"]

                action = "[DRY-RUN]" if dry_run else "[WRITE]  "
                coord_str = (
                    f"{best['lat']:.5f},{best['lon']:.5f}"
                    if has_coords else "no coords in TM"
                )
                log.info(
                    "%s [%d/%d] %-44s → %-40s score=%.2f  %s",
                    action, i, total, label,
                    best["tm_name"][:40], best_score, coord_str,
                )

                if not dry_run:
                    sb_patch(venue_id, update)

                if has_coords:
                    stats["written"] += 1
                else:
                    stats["no_coords"] += 1

                # Flag for review if score is close to threshold
                if best_score < 0.95:
                    review_rows.append({
                        "venue_id":    venue_id,
                        "venue_name":  venue_name,
                        "city":        city_val,
                        "state":       state_val,
                        "country":     country_val,
                        "reason":      "verify_match",
                        "tm_id":       best["tm_id"],
                        "tm_name":     best["tm_name"],
                        "tm_city":     best["tm_city"],
                        "tm_address":  best["tm_address"],
                        "similarity":  f"{best_score:.3f}",
                        "lat":         best["lat"] if best["lat"] else "",
                        "lon":         best["lon"] if best["lon"] else "",
                    })

            else:
                # Below threshold — log for manual review
                log.info(
                    "[REVIEW] [%d/%d] %-44s → %-40s score=%.2f  (below threshold)",
                    i, total, label, best["tm_name"][:40], best_score,
                )
                stats["review"] += 1
                review_rows.append({
                    "venue_id":    venue_id,
                    "venue_name":  venue_name,
                    "city":        city_val,
                    "state":       state_val,
                    "country":     country_val,
                    "reason":      "low_confidence",
                    "tm_id":       best["tm_id"],
                    "tm_name":     best["tm_name"],
                    "tm_city":     best["tm_city"],
                    "tm_address":  best["tm_address"],
                    "similarity":  f"{best_score:.3f}",
                    "lat":         best["lat"] if best["lat"] else "",
                    "lon":         best["lon"] if best["lon"] else "",
                })

        except Exception as exc:
            log.error("Error for %s (id=%d): %s", venue_name, venue_id, exc)
            stats["error"] += 1

        # Progress heartbeat every 100 venues
        if i % 100 == 0:
            log.info(
                "── Progress %d/%d  written=%d  review=%d  no_result=%d  errors=%d",
                i, total,
                stats["written"] + stats["no_coords"],
                stats["review"],
                stats["no_result"],
                stats["error"],
            )

    # ── Write review CSV ──────────────────────────────────────────────────────
    if review_rows:
        with open(review_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "venue_id", "venue_name", "city", "state", "country",
                "reason", "tm_id", "tm_name", "tm_city", "tm_address",
                "similarity", "lat", "lon",
            ])
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", review_path, len(review_rows))

        low_conf = [r for r in review_rows if r["reason"] == "low_confidence"]
        if low_conf:
            log.info("")
            log.info(
                "Manual review SQL for low_confidence rows — verify tm_name vs "
                "venue_name, then run:"
            )
            for r in low_conf[:10]:
                log.info(
                    "  UPDATE dim_venue SET tm_venue_id = '%s', latitude = %s, "
                    "longitude = %s WHERE venue_id = %s;  -- %s → %s (%.3f)",
                    r["tm_id"], r["lat"] or "NULL", r["lon"] or "NULL",
                    r["venue_id"], r["venue_name"], r["tm_name"],
                    float(r["similarity"]),
                )
            if len(low_conf) > 10:
                log.info("  … and %d more in the review CSV", len(low_conf) - 10)

    # ── Summary ───────────────────────────────────────────────────────────────
    matched = stats["written"] + stats["no_coords"]
    match_pct = round(matched / total * 100) if total else 0

    log.info("")
    log.info(
        "Done — written w/coords: %d | written no-coords: %d | "
        "review: %d | no_result: %d | skipped: %d | error: %d | total: %d",
        stats["written"], stats["no_coords"],
        stats["review"], stats["no_result"],
        stats["skipped"], stats["error"], total,
    )
    log.info("TM match rate: %d/%d (%d%%)", matched, total, match_pct)
    if dry_run and matched > 0:
        log.info("Re-run with --live to commit %d tm_venue_id writes.", matched)


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Discover and write tm_venue_id for dim_venue rows via TM Discovery API. "
            "Also writes lat/long from TM response (TM coords take priority over Nominatim)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live",
        action="store_true", default=False,
        help="Commit tm_venue_id and lat/long to dim_venue (default: dry-run)",
    )
    parser.add_argument(
        "--city",
        default=None, metavar="CITY",
        help="Only process venues in this city, e.g. Seattle, Toronto, Vancouver",
    )
    parser.add_argument(
        "--threshold",
        type=float, default=DEFAULT_THRESHOLD, metavar="SCORE",
        help=f"Minimum name similarity to auto-write (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--force",
        action="store_true", default=False,
        help="Re-process venues that already have tm_venue_id set",
    )
    parser.add_argument(
        "--limit",
        type=int, default=None, metavar="N",
        help="Process at most N venues (for test batches)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true", default=False,
        help="Show DEBUG-level logs (per-venue detail)",
    )
    args = parser.parse_args()

    run(
        dry_run=not args.live,
        city=args.city,
        threshold=args.threshold,
        force=args.force,
        verbose=args.verbose,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
