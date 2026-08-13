#!/usr/bin/env python3
"""
mbid_backfill_from_csvs.py

One-time backfill: reads artist_mbid values from all historical fetch CSVs
and updates dim_artist.musicbrainz_artist_id where it is currently NULL.

Much faster than musicbrainz_artist_enrich.py for this purpose — no API calls,
no rate limits. Completes in minutes by reading local files and doing bulk DB
updates.

Usage:
    python scripts/mbid_backfill_from_csvs.py --dry-run   # preview only
    python scripts/mbid_backfill_from_csvs.py --live      # commit updates
"""

import argparse
import csv
import logging
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
EXPORTS_DIR  = Path("exports")
BATCH_SIZE   = 500   # artists per Supabase page fetch
UPDATE_BATCH = 50    # updates per request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _headers() -> dict:
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "return=minimal",
    }


def sb_get_all(table: str, params: dict) -> list[dict]:
    rows, offset = [], 0
    while True:
        r = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            headers={**_headers(), "Range-Unit": "items",
                     "Range": f"{offset}-{offset + BATCH_SIZE - 1}"},
            params={**params, "limit": BATCH_SIZE, "offset": offset},
            timeout=30,
        )
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < BATCH_SIZE:
            break
        offset += BATCH_SIZE
    return rows


def sb_patch(table: str, filters: dict, payload: dict) -> None:
    r = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_headers(),
        params=filters,
        json=payload,
        timeout=30,
    )
    r.raise_for_status()


# ── Step 1: scan all fetch CSVs ───────────────────────────────────────────────

def scan_csvs() -> tuple[dict[str, str], list[tuple]]:
    """
    Returns:
        clean_map   — {name_lower: mbid}  for names with exactly one MBID
        conflicts   — [(name, {mbid: count, ...})] for names with >1 MBID
    """
    name_mbids: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    files_scanned = 0
    rows_with_mbid = 0

    for csv_file in sorted(EXPORTS_DIR.rglob("*.csv")):
        # Skip pipeline review files — they don't contain raw show data
        if "pipeline_reviews" in str(csv_file):
            continue
        try:
            with open(csv_file, encoding="utf-8", newline="") as fh:
                reader = csv.DictReader(fh)
                if "artist_mbid" not in (reader.fieldnames or []):
                    continue
                for row in reader:
                    mbid = (row.get("artist_mbid") or "").strip()
                    name = (row.get("details") or "").strip()
                    if mbid and name:
                        name_mbids[name.lower()][mbid] += 1
                        rows_with_mbid += 1
            files_scanned += 1
        except Exception as exc:
            log.warning("Skipped %s: %s", csv_file, exc)

    log.info("Scanned %d CSV files | %d rows with MBID | %d unique artist names",
             files_scanned, rows_with_mbid, len(name_mbids))

    clean_map: dict[str, str] = {}
    conflicts: list[tuple]    = []

    for name, mbid_counts in name_mbids.items():
        if len(mbid_counts) == 1:
            clean_map[name] = next(iter(mbid_counts))
        else:
            conflicts.append((name, dict(mbid_counts)))

    log.info("Unambiguous name→MBID pairs: %d", len(clean_map))
    if conflicts:
        log.info("Conflicted names (multiple MBIDs, skipped): %d", len(conflicts))
        for name, counts in conflicts[:10]:
            log.info("  CONFLICT: %r → %s", name, counts)
        if len(conflicts) > 10:
            log.info("  … and %d more (see --verbose for full list)", len(conflicts) - 10)

    return clean_map, conflicts


# ── Step 2: load dim_artist rows missing MBID ─────────────────────────────────

def load_artists_without_mbid() -> dict[str, int]:
    """Returns {name_lower: artist_id} for artists where musicbrainz_artist_id IS NULL."""
    log.info("Loading dim_artist rows where musicbrainz_artist_id IS NULL …")
    rows = sb_get_all("dim_artist", {
        "select":                 "artist_id,artist_name",
        "musicbrainz_artist_id":  "is.null",
    })
    result = {r["artist_name"].lower(): r["artist_id"] for r in rows if r.get("artist_name")}
    log.info("Found %d artists without MBID in DB", len(result))
    return result


# ── Step 3: match and update ──────────────────────────────────────────────────

def run_backfill(dry_run: bool) -> None:
    clean_map, _ = scan_csvs()

    missing = load_artists_without_mbid()

    # Intersect: names that are in both the CSV map and the null-MBID artists
    to_update: list[tuple[int, str]] = []  # [(artist_id, mbid), ...]
    for name_lower, mbid in clean_map.items():
        if name_lower in missing:
            to_update.append((missing[name_lower], mbid))

    log.info("Matched %d artists to update (out of %d with null MBID)",
             len(to_update), len(missing))

    if not to_update:
        log.info("Nothing to update — all done.")
        return

    if dry_run:
        log.info("DRY RUN — no writes. First 20 matches:")
        artists_rev = {aid: name for name, aid in missing.items()}
        for artist_id, mbid in to_update[:20]:
            log.info("  artist_id=%-8d  mbid=%s  name=%r",
                     artist_id, mbid, artists_rev.get(artist_id, "?"))
        log.info("… %d total would be updated", len(to_update))
        return

    # Batch update — one artist at a time (PostgREST filters by PK)
    written = 0
    errors  = 0
    t0 = time.time()

    for i, (artist_id, mbid) in enumerate(to_update, 1):
        try:
            sb_patch(
                "dim_artist",
                {"artist_id": f"eq.{artist_id}"},
                {"musicbrainz_artist_id": mbid},
            )
            written += 1
            if i % 100 == 0 or i == len(to_update):
                elapsed = time.time() - t0
                log.info("[%d/%d] written=%d errors=%d (%.1fs)",
                         i, len(to_update), written, errors, elapsed)
        except Exception as exc:
            log.error("Failed artist_id=%d: %s", artist_id, exc)
            errors += 1

    log.info("Done — written: %d | errors: %d | total candidates: %d",
             written, errors, len(to_update))
    if written:
        log.info("These artists will be skipped by musicbrainz_artist_enrich.py --new-only")
        log.info("Run: SELECT COUNT(*) FROM dim_artist WHERE musicbrainz_artist_id IS NULL")
        log.info("to see the remaining MB enrichment queue size.")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true",
                      help="Preview matches without writing to DB")
    mode.add_argument("--live",    action="store_true",
                      help="Write updates to dim_artist")
    args = parser.parse_args()

    run_backfill(dry_run=args.dry_run)
