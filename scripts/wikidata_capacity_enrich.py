#!/usr/bin/env python3
"""
scripts/wikidata_capacity_enrich.py
GP-131 — Populate dim_venue.capacity via Wikidata P1083 (maximum capacity).

Requires musicbrainz_place_id to be populated first (GP-129 / musicbrainz_venue_enrich.py).

Pipeline:
  1. Load venues with musicbrainz_place_id IS NOT NULL AND capacity IS NULL
  2. Batch MBIDs into SPARQL VALUES clauses (50 per request)
  3. Query Wikidata SPARQL for P1083 (capacity) via P6366 (MB place ID)
  4. Write confirmed values to dim_venue.capacity
  5. Flag outliers (< 100 or > 200,000) to a review CSV for manual verification

No API key needed — Wikidata SPARQL is free and CC0.
Rate limit: script enforces 1.5s between SPARQL requests (Wikidata asks for ≤1/sec).
Total requests: very low — 50 venues per request means ~8 requests for 400 venues.

Usage:
    # Preflight — no DB writes (default):
    python scripts/wikidata_capacity_enrich.py --limit 200

    # Live run — all venues with MBID but no capacity:
    python scripts/wikidata_capacity_enrich.py --live

    # Limit to a single city:
    python scripts/wikidata_capacity_enrich.py --live --city Vancouver
    python scripts/wikidata_capacity_enrich.py --live --city Seattle
    python scripts/wikidata_capacity_enrich.py --live --city Toronto

    # Re-process venues that already have a capacity value:
    python scripts/wikidata_capacity_enrich.py --live --force

Prerequisites:
    pip install requests supabase python-dotenv --break-system-packages

    musicbrainz_place_id must be populated — run musicbrainz_venue_enrich.py first.
    dim_venue.capacity is an existing int4 column — no schema migration needed.

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

SPARQL_URL     = "https://query.wikidata.org/sparql"
SPARQL_HEADERS = {
    "User-Agent": "Grooveprint/1.0 (artur@grooveprint.app)",
    "Accept":     "application/sparql-results+json",
}

BATCH_SIZE    = 50        # MBIDs per SPARQL request — keeps queries fast and URL short
REQUEST_DELAY = 1.5       # seconds between batches (Wikidata ToS: ≤1 req/sec)

# Capacity values outside these bounds go to the review CSV, not auto-written.
# Rogers Arena seats ~19k; BC Place 54k; Sturgis Rally outlier ~1M.
# These limits catch typos, Wikidata data errors, and festival headcounts.
CAPACITY_MIN = 100
CAPACITY_MAX = 200_000

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── SPARQL helpers ────────────────────────────────────────────────────────────

_QUERY_TEMPLATE = """
SELECT ?place ?mbid ?capacity WHERE {{
  VALUES ?mbid {{ {values} }}
  ?place wdt:P1004 ?mbid .
  OPTIONAL {{ ?place wdt:P1083 ?capacity . }}
}}
"""
# Wikidata property reference:
#   P1004 = MusicBrainz place ID  (venues, arenas, clubs — confirmed via Commodore Ballroom)
#   P966  = MusicBrainz area ID   (cities/regions — NOT for venues)
#   P1083 = maximum capacity
#   P434  = MusicBrainz artist ID (different entity type — not used here)


def _build_query(mbids: list[str]) -> str:
    """Build a SPARQL VALUES query for a batch of MusicBrainz place IDs."""
    values = " ".join(f'"{mbid}"' for mbid in mbids)
    return _QUERY_TEMPLATE.format(values=values)


def query_wikidata_batch(mbids: list[str], retries: int = 3) -> dict[str, Optional[int]]:
    """
    Query Wikidata SPARQL for P1083 capacity for a batch of MusicBrainz place IDs.

    Uses P6366 (MusicBrainz place ID) to look up each Wikidata item, then
    optionally retrieves P1083 (maximum capacity).

    Returns:
        {mbid: int}   — capacity found and valid
        {mbid: None}  — MBID matched in Wikidata but no P1083 present
        missing key   — MBID not found in Wikidata at all

    When a venue has multiple P1083 values (e.g. after a renovation), the first
    binding returned is used. Outlier detection catches anything suspicious.
    """
    query = _build_query(mbids)

    for attempt in range(retries):
        try:
            resp = requests.get(
                SPARQL_URL,
                headers=SPARQL_HEADERS,
                params={"query": query, "format": "json"},
                timeout=30,
            )

            if resp.status_code == 429:
                wait = int(resp.headers.get("Retry-After", 60))
                log.warning(
                    "429 from Wikidata — waiting %ds before retry %d/%d",
                    wait, attempt + 1, retries,
                )
                time.sleep(wait)
                continue

            if resp.status_code == 500:
                # Wikidata occasionally 500s on large VALUES clauses — reduce batch size
                # if this becomes frequent (default 50 should be fine in practice)
                wait = 5 * (attempt + 1)
                log.warning(
                    "500 from Wikidata — waiting %ds before retry %d/%d",
                    wait, attempt + 1, retries,
                )
                time.sleep(wait)
                continue

            resp.raise_for_status()
            data = resp.json()
            log.debug("SPARQL raw response: %s", data)
            break

        except requests.RequestException as exc:
            if attempt == retries - 1:
                log.error("SPARQL request failed after %d attempts: %s", retries, exc)
                return {}
            log.warning("Request error (attempt %d/%d): %s", attempt + 1, retries, exc)
            time.sleep(3)
    else:
        return {}

    results: dict[str, Optional[int]] = {}
    for binding in data.get("results", {}).get("bindings", []):
        mbid = binding.get("mbid", {}).get("value")
        if not mbid or mbid in results:
            continue  # skip missing or already-seen (take first capacity per MBID)
        cap_raw = binding.get("capacity", {}).get("value")
        if cap_raw is not None:
            try:
                results[mbid] = int(float(cap_raw))
            except (ValueError, TypeError):
                results[mbid] = None
        else:
            results[mbid] = None  # MBID in Wikidata but no capacity property

    return results


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:     bool,
    limit:       Optional[int],
    force:       bool,
    city_filter: Optional[str],
    verbose:     bool,
) -> None:
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(supabase_url, supabase_key)

    # ── Load venues ───────────────────────────────────────────────────────────
    q = db.from_("dim_venue").select(
        "venue_id, venue_name, city, state, musicbrainz_place_id, capacity"
    ).not_.is_("musicbrainz_place_id", "null")

    if not force:
        q = q.is_("capacity", "null")
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

    if total == 0:
        log.info("Nothing to process.")
        log.info("  → All venues with MBIDs already have capacity values.")
        log.info("  → Use --force to re-process, or run musicbrainz_venue_enrich.py first.")
        return

    # ── Batch SPARQL queries ──────────────────────────────────────────────────
    venue_by_mbid: dict[str, dict] = {
        v["musicbrainz_place_id"]: v
        for v in venues
        if v.get("musicbrainz_place_id")
    }
    mbid_list     = list(venue_by_mbid.keys())
    total_batches = (len(mbid_list) + BATCH_SIZE - 1) // BATCH_SIZE

    log.info(
        "Querying Wikidata: %d venue(s) → %d SPARQL request(s) of up to %d MBIDs each",
        total, total_batches, BATCH_SIZE,
    )

    all_results: dict[str, Optional[int]] = {}

    for i in range(0, len(mbid_list), BATCH_SIZE):
        batch   = mbid_list[i: i + BATCH_SIZE]
        batch_n = i // BATCH_SIZE + 1
        log.info("  Batch %d/%d (%d MBIDs)…", batch_n, total_batches, len(batch))
        log.debug("  First MBID in batch: %s", batch[0] if batch else "n/a")
        log.debug("  SPARQL query:\n%s", _build_query(batch[:2]))  # show query with first 2 MBIDs
        results = query_wikidata_batch(batch)
        all_results.update(results)
        log.info(
            "  Batch %d/%d → %d matched, %d with capacity",
            batch_n, total_batches,
            len(results),
            sum(1 for v in results.values() if v is not None),
        )
        if i + BATCH_SIZE < len(mbid_list):
            time.sleep(REQUEST_DELAY)

    # ── Process results ───────────────────────────────────────────────────────
    csv_path    = Path("exports") / "pipeline_reviews" / f"wikidata_capacity_review_{date.today().isoformat()}.csv"
    review_rows: list[dict] = []

    stats = {
        "written":   0,   # capacity written to DB (or would-be in dry-run)
        "no_value":  0,   # MBID found in Wikidata but no P1083
        "not_found": 0,   # MBID not found in Wikidata at all
        "outlier":   0,   # outside CAPACITY_MIN–CAPACITY_MAX → review CSV
        "error":     0,
    }

    for mbid, venue in venue_by_mbid.items():
        venue_id   = venue["venue_id"]
        venue_name = (venue.get("venue_name") or "").strip()
        city       = (venue.get("city")       or "").strip()
        label      = f"{venue_name[:30]}, {city}"[:44]

        if mbid not in all_results:
            log.debug("Not in Wikidata: %s (id=%d)", label, venue_id)
            stats["not_found"] += 1
            review_rows.append({
                "venue_id":   venue_id,
                "venue_name": venue_name,
                "city":       city,
                "mbid":       mbid,
                "reason":     "not_in_wikidata",
                "capacity":   "",
                "action":     "",
            })
            continue

        capacity = all_results[mbid]

        if capacity is None:
            log.debug("No P1083 in Wikidata: %s (id=%d)", label, venue_id)
            stats["no_value"] += 1
            review_rows.append({
                "venue_id":   venue_id,
                "venue_name": venue_name,
                "city":       city,
                "mbid":       mbid,
                "reason":     "no_p1083",
                "capacity":   "",
                "action":     "",
            })
            continue

        if not (CAPACITY_MIN <= capacity <= CAPACITY_MAX):
            log.info("[OUTLIER] %-44s  capacity=%d  (outside %d–%d)",
                     label, capacity, CAPACITY_MIN, CAPACITY_MAX)
            stats["outlier"] += 1
            review_rows.append({
                "venue_id":   venue_id,
                "venue_name": venue_name,
                "city":       city,
                "mbid":       mbid,
                "reason":     "outlier",
                "capacity":   capacity,
                "action":     "verify_then_update",
            })
            continue

        action = "[DRY-RUN]" if dry_run else "[WRITE]  "
        log.info("%s %-44s  capacity=%d", action, label, capacity)

        if not dry_run:
            try:
                db.from_("dim_venue").update({"capacity": capacity}).eq("venue_id", venue_id).execute()
                stats["written"] += 1
            except Exception as exc:
                log.error("DB write failed for venue_id=%d: %s", venue_id, exc)
                stats["error"] += 1
        else:
            stats["written"] += 1

    # ── Write review CSV ───────────────────────────────────────────────────────
    if review_rows:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "venue_id", "venue_name", "city", "mbid",
                "reason", "capacity", "action",
            ])
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", csv_path, len(review_rows))

        outlier_rows = [r for r in review_rows if r["reason"] == "outlier"]
        if outlier_rows:
            log.info("")
            log.info("Outlier SQL — verify capacity in Wikidata first, then run:")
            for r in outlier_rows:
                log.info(
                    "  UPDATE dim_venue SET capacity = %s WHERE venue_id = %s;  -- %s",
                    r["capacity"], r["venue_id"], r["venue_name"],
                )

    # ── Summary ───────────────────────────────────────────────────────────────
    found_in_wikidata = stats["written"] + stats["outlier"] + stats["no_value"]
    wikidata_pct      = round(found_in_wikidata / total * 100) if total else 0
    capacity_pct      = round(stats["written"] / total * 100) if total else 0

    log.info(
        "Done — written: %d (%d%%) | outlier: %d | no_p1083: %d | "
        "not_in_wikidata: %d | error: %d | total: %d",
        stats["written"], capacity_pct,
        stats["outlier"],
        stats["no_value"],
        stats["not_found"],
        stats["error"],
        total,
    )
    log.info(
        "Wikidata MBID hit rate: %d/%d (%d%%)",
        found_in_wikidata, total, wikidata_pct,
    )
    if dry_run and stats["written"] > 0:
        log.info("Re-run with --live to commit %d capacity value(s).", stats["written"])


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Populate dim_venue.capacity via Wikidata P1083 (maximum capacity), "
            "using musicbrainz_place_id as the lookup key."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live",
        action="store_true", default=False,
        help="Commit capacity values to dim_venue (default: dry-run, no writes)",
    )
    parser.add_argument(
        "--limit",
        type=int, default=None, metavar="N",
        help="Process at most N venues (useful for test batches)",
    )
    parser.add_argument(
        "--force",
        action="store_true", default=False,
        help="Re-process venues that already have a capacity value",
    )
    parser.add_argument(
        "--city",
        default=None, dest="city_filter", metavar="CITY",
        help="Only process venues in this city, e.g. Vancouver, Toronto, Seattle",
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
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
