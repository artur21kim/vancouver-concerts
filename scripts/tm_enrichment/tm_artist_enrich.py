#!/usr/bin/env python3
"""
Grooveprint — Ticketmaster Artist Attraction ID Enrichment
scripts/tm_enrichment/tm_artist_enrich.py

Searches the TM Discovery API /v2/attractions endpoint to find and write
tm_attraction_id for dim_artist rows. Also backfills spotify_artist_id and
musicbrainz_artist_id from TM externalLinks when not already set — never
overwrites existing values; conflicts logged to review CSV for investigation.

Follows the same pattern as tm_venue_search.py:
  - Dry-run by default; --live to commit
  - Auto-writes high-confidence matches (default threshold: 0.85)
  - Review CSV for anything below threshold, near-threshold, or with conflicts
  - --city filter scopes to artists who played that city (via fact_shows join)
  - --force to re-process already-enriched artists

TM rate limit: 5 req/sec (enforced via _tm_throttle).
classificationName=Music filter reduces false positives (avoids matching
"Interpol" the band against "Interpol" the law enforcement organisation, etc.)

Pipeline position:
  Run AFTER musicbrainz_artist_enrich.py (fills gaps MB missed).
  Run BEFORE tm_enrichment.py — attraction IDs enable precise event URL matching.

Schema migration (run once in Supabase SQL editor before first use):
    ALTER TABLE dim_artist ADD COLUMN IF NOT EXISTS tm_attraction_id text;
    CREATE INDEX IF NOT EXISTS idx_dim_artist_tm_attraction_id
      ON dim_artist(tm_attraction_id);

Usage:
    # Dry run — preflight, no writes:
    python scripts/tm_enrichment/tm_artist_enrich.py --limit 20

    # Live run — post-ingestion for a new city:
    python scripts/tm_enrichment/tm_artist_enrich.py --city Austin --live

    # Full overnight backfill (all artists without tm_attraction_id):
    python scripts/tm_enrichment/tm_artist_enrich.py --live

    # Re-process already-enriched artists:
    python scripts/tm_enrichment/tm_artist_enrich.py --city Austin --live --force

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

TM_ATTRACTIONS_URL  = "https://app.ticketmaster.com/discovery/v2/attractions.json"
REQUEST_DELAY       = 0.5    # 2 req/sec — conservative for sustained runs
PAGE_SIZE           = 20     # TM attractions search results per page
RATE_LIMIT_BACKOFF  = 60     # Base wait on 429 (seconds); multiplied per attempt
CIRCUIT_BREAKER_N   = 5      # Consecutive rate-limited artists before long pause
CIRCUIT_BREAKER_WAIT = 300   # How long to pause when circuit breaker fires (seconds)
DEFAULT_THRESHOLD  = 0.85

EXPORTS_DIR = Path("exports")

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
    """Paginated GET — returns all rows regardless of PostgREST row cap."""
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


def sb_patch_artist(artist_id: int, data: dict) -> None:
    url = f"{SUPABASE_URL}/rest/v1/dim_artist"
    resp = requests.patch(
        url, headers=_BASE_HEADERS,
        params={"artist_id": f"eq.{artist_id}"},
        json=data,
    )
    resp.raise_for_status()


# ── Name normalisation ────────────────────────────────────────────────────────

_STRIP_WORDS = re.compile(r"\b(the|a|an|and|&)\b", re.IGNORECASE)
_PUNCT       = re.compile(r"[^a-z0-9\s]")
_SPACES      = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Lowercase, strip punctuation and common articles for fuzzy comparison."""
    s = name.lower().strip()
    s = _PUNCT.sub(" ", s)
    s = _STRIP_WORDS.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    return s


def name_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


# ── Spotify URL parsing ───────────────────────────────────────────────────────

_SPOTIFY_ARTIST_RE = re.compile(
    r"open\.spotify\.com/artist/([A-Za-z0-9]+)", re.IGNORECASE
)


def extract_spotify_artist_id(url: str) -> Optional[str]:
    """Extract Spotify artist ID from a spotify.com/artist/... URL."""
    m = _SPOTIFY_ARTIST_RE.search(url or "")
    return m.group(1) if m else None


# ── TM API helpers ────────────────────────────────────────────────────────────

_last_tm_call: float = 0.0


def _tm_throttle() -> None:
    global _last_tm_call
    elapsed = time.time() - _last_tm_call
    if elapsed < REQUEST_DELAY:
        time.sleep(REQUEST_DELAY - elapsed)
    _last_tm_call = time.time()


def tm_search_attractions(artist_name: str, retries: int = 3) -> Optional[list[dict]]:
    """
    Search TM Discovery API /v2/attractions for a given artist name.
    Filtered to Music classification to reduce cross-domain false positives.

    Returns:
        list[dict]  — TM results (empty list if artist not found in TM)
        None        — all retries exhausted on 429; caller should activate circuit breaker
    """
    params = {
        "apikey":             TM_API_KEY,
        "keyword":            artist_name,
        "classificationName": "Music",
        "size":               PAGE_SIZE,
    }

    for attempt in range(retries):
        _tm_throttle()
        try:
            resp = requests.get(TM_ATTRACTIONS_URL, params=params, timeout=10)

            if resp.status_code == 429:
                # Linear backoff: 60s, 120s, 180s — TM's Retry-After is unreliable at low values
                wait = RATE_LIMIT_BACKOFF * (attempt + 1)
                log.warning(
                    "429 from TM (attempt %d/%d) — waiting %ds",
                    attempt + 1, retries, wait,
                )
                time.sleep(wait)
                continue

            if resp.status_code == 404:
                return []

            resp.raise_for_status()
            data = resp.json()
            embedded = data.get("_embedded", {})
            return embedded.get("attractions", [])

        except requests.RequestException as exc:
            if attempt == retries - 1:
                log.error("TM request failed after %d attempts: %s", retries, exc)
                return []
            log.warning(
                "TM request error (attempt %d/%d): %s", attempt + 1, retries, exc,
            )
            time.sleep(1)

    # All retries exhausted on 429 — signal caller to activate circuit breaker
    log.warning("Rate limit not resolved after %d attempts — signalling circuit breaker", retries)
    return None


def parse_tm_attraction(tm_attr: dict) -> dict:
    """
    Extract the fields we care about from a TM attraction result.
    Returns: tm_id, tm_name, spotify_id (or None), mbid (or None).
    """
    tm_id   = tm_attr.get("id", "")
    tm_name = tm_attr.get("name", "")

    ext = tm_attr.get("externalLinks") or {}

    # Spotify: [{url: "https://open.spotify.com/artist/..."}]
    spotify_id: Optional[str] = None
    for link in ext.get("spotify", []):
        spotify_id = extract_spotify_artist_id(link.get("url", ""))
        if spotify_id:
            break

    # MusicBrainz: [{id: "uuid"}]
    mbid: Optional[str] = None
    for link in ext.get("musicbrainz", []):
        mbid = link.get("id") or None
        if mbid:
            break

    return {
        "tm_id":      tm_id,
        "tm_name":    tm_name,
        "spotify_id": spotify_id,
        "mbid":       mbid,
    }


# ── Artist loading ────────────────────────────────────────────────────────────

_ARTIST_SELECT = (
    "artist_id,artist_name,tm_attraction_id,"
    "spotify_artist_id,musicbrainz_artist_id"
)
_ARTIST_BATCH_SIZE = 200   # safe URL length for PostgREST .in() filters


def load_artists_for_city(city: str, force: bool) -> list[dict]:
    """
    Load dim_artist rows for artists who have at least one show in `city`.
    Path: dim_venue (city filter) → fact_shows (venue_id, batched) → dim_artist.
    fact_shows has no city_id column — city is stored on dim_venue.
    """
    # Step 1: get venue_ids for this city from dim_venue
    log.info("Fetching venue_ids for city '%s' from dim_venue…", city)
    venue_rows = sb_get_all("dim_venue", {
        "select": "venue_id",
        "city":   f"eq.{city}",
    })
    venue_ids = [r["venue_id"] for r in venue_rows if r.get("venue_id")]
    if not venue_ids:
        log.error("No venues found for city '%s' in dim_venue.", city)
        return []
    log.info("  Found %d venues in %s", len(venue_ids), city)

    # Step 2: get distinct artist_ids from fact_shows for those venue_ids (batched)
    _VENUE_BATCH = 100
    artist_ids_set: set = set()
    for i in range(0, len(venue_ids), _VENUE_BATCH):
        batch = venue_ids[i : i + _VENUE_BATCH]
        rows = sb_get_all("fact_shows", {
            "select":   "artist_id",
            "venue_id": f"in.({','.join(str(v) for v in batch)})",
        })
        artist_ids_set.update(r["artist_id"] for r in rows if r.get("artist_id"))

    artist_ids = list(artist_ids_set)
    log.info("Found %d unique artists with shows in %s", len(artist_ids), city)

    if not artist_ids:
        return []

    all_artists: list[dict] = []
    for i in range(0, len(artist_ids), _ARTIST_BATCH_SIZE):
        batch = artist_ids[i : i + _ARTIST_BATCH_SIZE]
        id_filter = f"in.({','.join(str(x) for x in batch)})"
        params: dict = {
            "select":    _ARTIST_SELECT,
            "artist_id": id_filter,
        }
        if not force:
            params["tm_attraction_id"] = "is.null"
        all_artists.extend(sb_get_all("dim_artist", params))

    return all_artists


def load_all_artists(force: bool) -> list[dict]:
    """Load all dim_artist rows lacking tm_attraction_id (or all if --force)."""
    params: dict = {"select": _ARTIST_SELECT}
    if not force:
        params["tm_attraction_id"] = "is.null"
    return sb_get_all("dim_artist", params)


# ── Review CSV helpers ────────────────────────────────────────────────────────

_REVIEW_FIELDS = [
    "artist_id", "artist_name", "reason",
    "tm_id", "tm_name", "similarity",
    "tm_spotify", "db_spotify",
    "tm_mbid",    "db_mbid",
]


def _review_row(
    artist_id: int,
    artist_name: str,
    reason: str,
    best: dict,
    best_score: float,
    existing_spotify: Optional[str],
    existing_mbid: Optional[str],
) -> dict:
    return {
        "artist_id":   artist_id,
        "artist_name": artist_name,
        "reason":      reason,
        "tm_id":       best["tm_id"],
        "tm_name":     best["tm_name"],
        "similarity":  f"{best_score:.3f}",
        "tm_spotify":  best["spotify_id"] or "",
        "db_spotify":  existing_spotify or "",
        "tm_mbid":     best["mbid"] or "",
        "db_mbid":     existing_mbid or "",
    }


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    dry_run:   bool,
    city:      Optional[str],
    threshold: float,
    force:     bool,
    verbose:   bool,
    limit:     Optional[int],
) -> None:
    if verbose:
        log.setLevel(logging.DEBUG)

    # ── Load artists ──────────────────────────────────────────────────────────
    log.info("Loading artists from Supabase…")
    artists = load_artists_for_city(city, force) if city else load_all_artists(force)

    if limit:
        artists = artists[:limit]

    total = len(artists)
    log.info(
        "Mode: %s | Artists to search: %d%s%s",
        "DRY-RUN" if dry_run else "LIVE",
        total,
        f" (city={city})" if city else "",
        f" (capped at {limit})" if limit else "",
    )
    if dry_run:
        log.info("No DB writes will occur — pass --live to commit.")
    log.info("Confidence threshold: %.2f", threshold)

    # ── Review CSV setup ──────────────────────────────────────────────────────
    today     = date.today().isoformat()
    city_slug = city.lower().replace(" ", "_") if city else "all"
    review_path = (
        EXPORTS_DIR / "pipeline_reviews"
        / f"tm_artist_review_{city_slug}_{today}.csv"
    )
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_rows: list[dict] = []

    stats = {
        "written":          0,   # tm_attraction_id written
        "spotify_backfill": 0,   # spotify_artist_id written from TM
        "mbid_backfill":    0,   # musicbrainz_artist_id written from TM
        "spotify_conflict": 0,   # TM Spotify differs from existing — logged only
        "review":           0,   # below threshold — logged for manual check
        "no_result":        0,   # TM returned nothing for this artist
        "rate_limited":     0,   # all retries exhausted on 429 — will retry on next run
        "skipped":          0,   # blank artist name
        "error":            0,
    }
    consecutive_rate_limited = 0

    for i, artist in enumerate(artists, 1):
        artist_id        = int(artist["artist_id"])
        artist_name      = (artist.get("artist_name") or "").strip()
        existing_spotify = artist.get("spotify_artist_id")
        existing_mbid    = artist.get("musicbrainz_artist_id")

        if not artist_name:
            stats["skipped"] += 1
            continue

        log.debug("[%d/%d] %s", i, total, artist_name)

        try:
            results = tm_search_attractions(artist_name)

            # None = rate-limited (all retries exhausted) — distinct from no results
            if results is None:
                stats["rate_limited"] += 1
                consecutive_rate_limited += 1
                if consecutive_rate_limited >= CIRCUIT_BREAKER_N:
                    log.warning(
                        "%d consecutive rate-limit failures — pausing %ds before continuing. "
                        "Progress is safe; re-run will skip already-written artists.",
                        CIRCUIT_BREAKER_N, CIRCUIT_BREAKER_WAIT,
                    )
                    time.sleep(CIRCUIT_BREAKER_WAIT)
                    consecutive_rate_limited = 0
                continue

            consecutive_rate_limited = 0  # reset on any successful API response

            if not results:
                log.debug("No TM results: %s", artist_name)
                stats["no_result"] += 1
                continue

            # Score all results and pick the best name match
            best       = None
            best_score = 0.0
            for tm_attr in results:
                parsed = parse_tm_attraction(tm_attr)
                score  = name_similarity(artist_name, parsed["tm_name"])
                if score > best_score:
                    best_score = score
                    best = parsed

            if best is None:
                stats["no_result"] += 1
                continue

            label = artist_name[:50]

            if best_score >= threshold:
                # ── High confidence match ─────────────────────────────────────
                update: dict = {"tm_attraction_id": best["tm_id"]}
                spotify_note = ""
                mbid_note    = ""

                # Spotify backfill — null-safe, never overwrite
                if best["spotify_id"]:
                    if not existing_spotify:
                        update["spotify_artist_id"] = best["spotify_id"]
                        stats["spotify_backfill"] += 1
                        spotify_note = f"  Spotify✓ ({best['spotify_id'][:8]}…)"
                    elif existing_spotify != best["spotify_id"]:
                        stats["spotify_conflict"] += 1
                        spotify_note = "  Spotify⚠ conflict"
                        review_rows.append(_review_row(
                            artist_id, artist_name, "spotify_conflict",
                            best, best_score, existing_spotify, existing_mbid,
                        ))

                # MBID backfill — null-safe, never overwrite
                if best["mbid"] and not existing_mbid:
                    update["musicbrainz_artist_id"] = best["mbid"]
                    stats["mbid_backfill"] += 1
                    mbid_note = "  MBID✓"

                action = "[DRY-RUN]" if dry_run else "[WRITE]  "
                log.info(
                    "%s [%d/%d] %-50s → %-40s score=%.2f%s%s",
                    action, i, total, label,
                    best["tm_name"][:40], best_score,
                    spotify_note, mbid_note,
                )

                if not dry_run:
                    sb_patch_artist(artist_id, update)

                stats["written"] += 1

                # Flag near-threshold matches for spot-check (written but worth verifying)
                if best_score < 0.95:
                    review_rows.append(_review_row(
                        artist_id, artist_name, "verify_match",
                        best, best_score, existing_spotify, existing_mbid,
                    ))

            else:
                # ── Below threshold — review only, no write ───────────────────
                log.info(
                    "[REVIEW] [%d/%d] %-50s → %-40s score=%.2f  (below threshold)",
                    i, total, label, best["tm_name"][:40], best_score,
                )
                stats["review"] += 1
                review_rows.append(_review_row(
                    artist_id, artist_name, "low_confidence",
                    best, best_score, existing_spotify, existing_mbid,
                ))

        except Exception as exc:
            log.error("Error for %s (id=%d): %s", artist_name, artist_id, exc)
            stats["error"] += 1

        # Progress heartbeat every 200 artists
        if i % 200 == 0:
            log.info(
                "── Progress %d/%d  written=%d  spotify✓=%d  review=%d  "
                "no_result=%d  errors=%d",
                i, total,
                stats["written"], stats["spotify_backfill"],
                stats["review"], stats["no_result"], stats["error"],
            )

    # ── Write review CSV ──────────────────────────────────────────────────────
    if review_rows:
        with open(review_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=_REVIEW_FIELDS)
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", review_path, len(review_rows))

        low_conf = [r for r in review_rows if r["reason"] == "low_confidence"]
        if low_conf:
            log.info("")
            log.info(
                "Manual accept SQL for low_confidence rows (verify tm_name vs "
                "artist_name first):"
            )
            for r in low_conf[:10]:
                log.info(
                    "  UPDATE dim_artist SET tm_attraction_id = '%s'"
                    " WHERE artist_id = %s;  -- %s → %s (%.3f)",
                    r["tm_id"], r["artist_id"],
                    r["artist_name"], r["tm_name"], float(r["similarity"]),
                )
            if len(low_conf) > 10:
                log.info("  … and %d more in the review CSV", len(low_conf) - 10)

        conflicts = [r for r in review_rows if r["reason"] == "spotify_conflict"]
        if conflicts:
            log.info("")
            log.info(
                "Spotify ID conflicts (%d): TM returned a different Spotify ID "
                "than the existing DB value. Investigate before accepting:",
                len(conflicts),
            )
            for r in conflicts[:5]:
                log.info(
                    "  artist_id=%s  %s | DB: %s | TM: %s",
                    r["artist_id"], r["artist_name"],
                    r["db_spotify"], r["tm_spotify"],
                )
            if len(conflicts) > 5:
                log.info("  … and %d more in the review CSV", len(conflicts) - 5)

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info("")
    log.info(
        "Done — written: %d | spotify_backfill: %d | mbid_backfill: %d | "
        "spotify_conflicts: %d | review: %d | no_result: %d | "
        "rate_limited: %d | skipped: %d | error: %d | total: %d",
        stats["written"],       stats["spotify_backfill"], stats["mbid_backfill"],
        stats["spotify_conflict"], stats["review"],        stats["no_result"],
        stats["rate_limited"],  stats["skipped"],          stats["error"], total,
    )
    if stats["rate_limited"]:
        log.info(
            "%d artist(s) skipped due to sustained rate limiting — "
            "they have no tm_attraction_id and will be retried on next run.",
            stats["rate_limited"],
        )
    if dry_run and stats["written"] > 0:
        log.info(
            "Re-run with --live to commit %d tm_attraction_id writes.",
            stats["written"],
        )


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Discover and write tm_attraction_id for dim_artist rows via TM "
            "Discovery API. Also backfills spotify_artist_id and "
            "musicbrainz_artist_id from TM externalLinks when not already set."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--live",
        action="store_true", default=False,
        help="Commit tm_attraction_id (and backfills) to dim_artist (default: dry-run)",
    )
    parser.add_argument(
        "--city",
        default=None, metavar="CITY",
        help=(
            "Only process artists who played in this city, e.g. Austin, Seattle, "
            "Vancouver. Requires a fact_shows join — omit for a full run."
        ),
    )
    parser.add_argument(
        "--threshold",
        type=float, default=DEFAULT_THRESHOLD, metavar="SCORE",
        help=f"Minimum name similarity to auto-write (default: {DEFAULT_THRESHOLD})",
    )
    parser.add_argument(
        "--force",
        action="store_true", default=False,
        help="Re-process artists that already have tm_attraction_id set",
    )
    parser.add_argument(
        "--limit",
        type=int, default=None, metavar="N",
        help="Process at most N artists (for test batches)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true", default=False,
        help="Show DEBUG-level logs (per-artist detail)",
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
