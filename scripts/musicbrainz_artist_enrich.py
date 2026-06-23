#!/usr/bin/env python3
"""
scripts/musicbrainz_artist_enrich.py
SCRUM-83 — Enrich dim_artist with MBIDs, official website URLs,
           artist_type, begin_year, and end_year via MusicBrainz.

Renamed from musicbrainz_enrich.py. Artist enrichment only.
For venue enrichment see scripts/musicbrainz_venue_enrich.py (GP-129).

MusicBrainz data is CC0 licensed — no attribution required.
Rate limit: 1 req/sec max (enforced internally).

Two requests per matched artist:
  1. Search  /ws/2/artist/?query=artist:"name"  — accept top result if score >= 85
  2. Lookup  /ws/2/artist/{mbid}?inc=url-rels   — extract type, life-span, official homepage

Artists with no confident match, no URL rel, or an ambiguous disambiguation are
logged to exports/musicbrainz_review_YYYY-MM-DD.csv for manual review.

Usage:
    # Preflight — no DB writes (default):
    python scripts/musicbrainz_artist_enrich.py --limit 20

    # Live run — commits to DB:
    python scripts/musicbrainz_artist_enrich.py --live

    # Full overnight run (~8 hrs for ~12k artists):
    python scripts/musicbrainz_artist_enrich.py --live --verbose

    # New artists only (post-ingestion):
    python scripts/musicbrainz_artist_enrich.py --new-only --live

    # Backfill artist_type / begin_year / end_year for already-enriched artists:
    python scripts/musicbrainz_artist_enrich.py --meta-only --live

    # Re-process artists that already have a URL set:
    python scripts/musicbrainz_artist_enrich.py --live --force

Prerequisites:
    pip install requests supabase python-dotenv --break-system-packages

    Schema migration (run once in Supabase SQL editor before first --live run):
        ALTER TABLE dim_artist ADD COLUMN IF NOT EXISTS official_website_url text;
        ALTER TABLE dim_artist ADD COLUMN IF NOT EXISTS artist_type  text;
        ALTER TABLE dim_artist ADD COLUMN IF NOT EXISTS begin_year   smallint;
        ALTER TABLE dim_artist ADD COLUMN IF NOT EXISTS end_year     smallint;
        -- musicbrainz_artist_id column present after GP-129 rename migration

Env vars (resolved from .env.local if present, else from environment):
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

# Load .env.local if python-dotenv is available
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
    "Accept": "application/json",
}

MIN_SCORE = 85          # minimum MusicBrainz search confidence to accept a result
REQUEST_INTERVAL = 1.1  # seconds between API calls (MusicBrainz allows 1/sec)

# Disambiguation keywords that indicate a tribute, cover, or otherwise wrong match.
REJECT_DISAMBIGUATIONS = ("tribute", "cover", "fictional", "mock", "parody", "karaoke")

# MusicBrainz artist type → Grooveprint artist_type value
TYPE_MAP: dict[str, str] = {
    "Person":     "Solo",
    "Group":      "Group",
    "Orchestra":  "Orchestra",
    "Choir":      "Choir",
    "Character":  "Character",
    "Other":      "Other",
}

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
                wait = 5 * (attempt + 1)
                log.warning("503 from MusicBrainz — waiting %ds before retry %d/%d", wait, attempt + 1, retries)
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


def mb_search(artist_name: str) -> Optional[dict]:
    """
    Search MusicBrainz for an artist by name.

    Returns the top result dict if:
      - score >= MIN_SCORE, AND
      - disambiguation doesn't indicate a tribute/cover act.

    Returns None otherwise.
    """
    data = mb_get(
        "artist/",
        {"query": f'artist:"{artist_name}"', "fmt": "json", "limit": 5},
    )
    artists = data.get("artists", [])
    if not artists:
        return None

    top = artists[0]
    score = int(top.get("score", 0))
    if score < MIN_SCORE:
        return None

    disambiguation = (top.get("disambiguation") or "").lower()
    if any(term in disambiguation for term in REJECT_DISAMBIGUATIONS):
        log.debug("Rejected (suspect disambiguation %r): %s", disambiguation, artist_name)
        return None

    return top


def mb_get_artist_details(mbid: str) -> dict:
    """
    Look up an artist MBID with url-rels included.

    Returns a dict with:
        official_url  str | None    — 'official homepage' URL relation
        artist_type   str | None    — mapped via TYPE_MAP (Solo/Group/Orchestra/…)
        begin_year    int | None    — birth year (Solo) or formation year (Group)
        end_year      int | None    — death year (Solo) or disbandment year (Group)
    """
    data = mb_get(f"artist/{mbid}", {"inc": "url-rels", "fmt": "json"})

    # Official homepage URL
    official_url: Optional[str] = None
    for rel in data.get("relations", []):
        if rel.get("type") == "official homepage":
            url = rel.get("url", {}).get("resource")
            if url:
                official_url = url
                break

    # Artist type
    raw_type    = (data.get("type") or "").strip()
    artist_type = TYPE_MAP.get(raw_type)

    # Life-span years — MB returns partial dates (YYYY, YYYY-MM, YYYY-MM-DD)
    life_span  = data.get("life-span") or {}
    begin_raw  = (life_span.get("begin") or "").strip()
    end_raw    = (life_span.get("end")   or "").strip()
    begin_year = int(begin_raw[:4]) if len(begin_raw) >= 4 and begin_raw[:4].isdigit() else None
    end_year   = int(end_raw[:4])   if len(end_raw)   >= 4 and end_raw[:4].isdigit()   else None

    return {
        "official_url": official_url,
        "artist_type":  artist_type,
        "begin_year":   begin_year,
        "end_year":     end_year,
    }


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:   bool,
    limit:     Optional[int],
    force:     bool,
    new_only:  bool = False,
    meta_only: bool = False,
) -> None:
    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(supabase_url, supabase_key)

    # ── Meta-only mode: backfill type/years for already-enriched artists ──────
    if meta_only:
        log.info(
            "Mode: %s | Meta-only: backfilling artist_type/begin_year/end_year",
            "DRY-RUN" if dry_run else "LIVE",
        )
        q = (
            db.from_("dim_artist")
            .select("artist_id, artist_name, musicbrainz_artist_id")
            .not_.is_("musicbrainz_artist_id", "null")
            .is_("artist_type", "null")
        )
        if limit:
            q = q.limit(limit)
        artists = (q.execute()).data or []
        total = len(artists)
        log.info("  %d artists with MBID but no artist_type", total)
        if dry_run:
            log.info("  No DB writes — pass --live to commit.")

        stats = {"enriched": 0, "no_data": 0, "error": 0}

        for i, artist in enumerate(artists, 1):
            artist_id   = artist["artist_id"]
            artist_name = (artist.get("artist_name") or "").strip()
            mbid        = artist["musicbrainz_artist_id"]

            try:
                details = mb_get_artist_details(mbid)
                update: dict = {}
                if details["artist_type"]:
                    update["artist_type"] = details["artist_type"]
                if details["begin_year"]:
                    update["begin_year"]  = details["begin_year"]
                if details["end_year"]:
                    update["end_year"]    = details["end_year"]

                if not update:
                    log.debug("[%d/%d] No metadata in MB: %s", i, total, artist_name)
                    stats["no_data"] += 1
                    continue

                action = "[DRY-RUN]" if dry_run else "[WRITE]  "
                log.info(
                    "%s [%d/%d] %-40s  type=%-12s  %s–%s",
                    action, i, total, artist_name[:40],
                    details["artist_type"] or "?",
                    details["begin_year"] or "?",
                    details["end_year"]   or "ongoing",
                )

                if not dry_run:
                    db.from_("dim_artist").update(update).eq("artist_id", artist_id).execute()

                stats["enriched"] += 1

                if i % 100 == 0:
                    log.info("── Progress %d/%d  enriched=%d  no_data=%d  errors=%d",
                             i, total, stats["enriched"], stats["no_data"], stats["error"])

            except requests.HTTPError as exc:
                log.warning("HTTP error for %s (id=%d): %s", artist_name, artist_id, exc)
                stats["error"] += 1
            except Exception as exc:
                log.error("Unexpected error for %s (id=%d): %s", artist_name, artist_id, exc)
                stats["error"] += 1

        log.info(
            "Done — enriched: %d | no_data: %d | error: %d | total: %d",
            stats["enriched"], stats["no_data"], stats["error"], total,
        )
        if dry_run and stats["enriched"] > 0:
            log.info("Re-run with --live to commit %d updates.", stats["enriched"])
        return

    # ── Standard enrichment mode ──────────────────────────────────────────────
    q = db.from_("dim_artist").select("artist_id, artist_name, official_website_url")
    if not force:
        q = q.is_("official_website_url", None)
    if new_only:
        q = q.is_("musicbrainz_artist_id", None)
    if limit:
        q = q.limit(limit)
    artists = (q.execute()).data or []

    total = len(artists)
    log.info(
        "Mode: %s | Artists to process: %d%s",
        "DRY-RUN" if dry_run else "LIVE",
        total,
        f" (capped at --limit {limit})" if limit else "",
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")

    csv_path = Path("exports") / "pipeline_reviews" / f"musicbrainz_review_{date.today().isoformat()}.csv"
    review_rows: list[dict] = []

    stats = {"enriched": 0, "no_url": 0, "no_match": 0, "error": 0}

    for i, artist in enumerate(artists, 1):
        artist_id   = artist["artist_id"]
        artist_name = artist["artist_name"]

        log.debug("[%d/%d] %s (id=%d)", i, total, artist_name, artist_id)

        try:
            # ── Step 1: Search ─────────────────────────────────────────────────
            top = mb_search(artist_name)

            if top is None:
                log.debug("No confident match: %s", artist_name)
                stats["no_match"] += 1
                review_rows.append({
                    "artist_id":      artist_id,
                    "artist_name":    artist_name,
                    "reason":         "no_match_or_low_score",
                    "mbid":           "",
                    "mb_score":       "",
                    "disambiguation": "",
                    "found_url":      "",
                    "artist_type":    "",
                    "begin_year":     "",
                    "end_year":       "",
                })
                continue

            mbid           = top["id"]
            mb_score       = top.get("score", 0)
            disambiguation = top.get("disambiguation") or ""

            # ── Step 2: Lookup details (URL, type, life-span) ─────────────────
            details      = mb_get_artist_details(mbid)
            official_url = details["official_url"]
            artist_type  = details["artist_type"]
            begin_year   = details["begin_year"]
            end_year     = details["end_year"]

            # Build update — always write MBID and any metadata found
            update: dict = {"musicbrainz_artist_id": mbid}
            if official_url:
                update["official_website_url"] = official_url
            if artist_type:
                update["artist_type"] = artist_type
            if begin_year:
                update["begin_year"] = begin_year
            if end_year:
                update["end_year"]   = end_year

            # No official URL — still write the other fields, but flag for review
            if official_url is None:
                stats["no_url"] += 1
                review_rows.append({
                    "artist_id":      artist_id,
                    "artist_name":    artist_name,
                    "reason":         "no_official_homepage_rel",
                    "mbid":           mbid,
                    "mb_score":       mb_score,
                    "disambiguation": disambiguation,
                    "found_url":      "",
                    "artist_type":    artist_type or "",
                    "begin_year":     begin_year  or "",
                    "end_year":       end_year    or "",
                })

            # Ambiguous match — flag for review, still write
            if disambiguation:
                review_rows.append({
                    "artist_id":      artist_id,
                    "artist_name":    artist_name,
                    "reason":         "ambiguous_verify",
                    "mbid":           mbid,
                    "mb_score":       mb_score,
                    "disambiguation": disambiguation,
                    "found_url":      official_url or "",
                    "artist_type":    artist_type  or "",
                    "begin_year":     begin_year   or "",
                    "end_year":       end_year     or "",
                })

            log.info(
                "%s [%d/%d] %-38s  type=%-12s  %s",
                "[DRY-RUN]" if dry_run else "[WRITE]  ",
                i, total,
                artist_name[:38],
                artist_type or "?",
                official_url or "(no URL)",
            )

            if not dry_run:
                db.from_("dim_artist").update(update).eq("artist_id", artist_id).execute()

            stats["enriched"] += 1

        except requests.HTTPError as exc:
            log.warning("HTTP error for %s (id=%d): %s", artist_name, artist_id, exc)
            stats["error"] += 1
        except Exception as exc:
            log.error("Unexpected error for %s (id=%d): %s", artist_name, artist_id, exc)
            stats["error"] += 1

    # ── Write review CSV ───────────────────────────────────────────────────────
    if review_rows:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=[
                    "artist_id", "artist_name", "reason",
                    "mbid", "mb_score", "disambiguation",
                    "found_url", "artist_type", "begin_year", "end_year",
                ],
            )
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", csv_path, len(review_rows))

    # ── Summary ────────────────────────────────────────────────────────────────
    log.info(
        "Done — enriched: %d | no_url: %d | no_match: %d | error: %d",
        stats["enriched"], stats["no_url"], stats["no_match"], stats["error"],
    )
    if dry_run and stats["enriched"] > 0:
        log.info("Re-run with --live to commit %d updates.", stats["enriched"])


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich dim_artist with MBID, URL, artist_type, and life-span years.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live", action="store_true", default=False,
        help="Commit updates to dim_artist (default: dry-run, no writes)",
    )
    parser.add_argument(
        "--limit", type=int, default=None, metavar="N",
        help="Process at most N artists (useful for test batches)",
    )
    parser.add_argument(
        "--force", action="store_true", default=False,
        help="Re-process artists that already have official_website_url set",
    )
    parser.add_argument(
        "--new-only", action="store_true", default=False,
        help="Only process artists with no musicbrainz_artist_id (post-ingestion catch-up)",
    )
    parser.add_argument(
        "--meta-only", action="store_true", default=False,
        help=(
            "Backfill artist_type/begin_year/end_year for artists that already have "
            "musicbrainz_artist_id but are missing the new metadata columns"
        ),
    )
    parser.add_argument(
        "--verbose", action="store_true", default=False,
        help="Show DEBUG-level logs (per-artist detail)",
    )
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    run(
        dry_run=not args.live,
        limit=args.limit,
        force=args.force,
        new_only=args.new_only,
        meta_only=args.meta_only,
    )


if __name__ == "__main__":
    main()
