#!/usr/bin/env python3
"""
scripts/comedian_enrich.py
Enrich dim_artist with comedian flag, birth/death years, and artist type.

Fuzzy-matches comedian names from the Dead Frog database against
dim_artist.artist_name and writes:
  - is_comedian = true for matched artists
  - begin_year / end_year from the dead comedians list (birth–death years)

Review CSV written to exports/comedian_review_YYYY-MM-DD.csv for:
  - Matches between --threshold and 0.95 (auto-written but worth verifying)
  - Low-confidence matches (0.70–threshold) for manual SQL

Usage:
    # Preflight — no DB writes (default):
    python scripts/comedian_enrich.py \
        --all   exports/dead_frog_all_comedians.xlsx \
        --dead  exports/dead_frog_dead_comedians.xlsx

    # Live run:
    python scripts/comedian_enrich.py \
        --all   exports/dead_frog_all_comedians.xlsx \
        --dead  exports/dead_frog_dead_comedians.xlsx \
        --live

    # Adjust threshold (default 0.85):
    python scripts/comedian_enrich.py ... --threshold 0.90 --live

Prerequisites:
    pip install openpyxl supabase python-dotenv --break-system-packages

Env vars (resolved from .env.local if present, else environment):
    NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL)
    SUPABASE_SERVICE_ROLE_KEY

XLSX column expectations:
  --all  file:  Title | Title_URL | Image
  --dead file:  Title | Title_URL | Image | Field   (Field = "YYYY - YYYY")
"""

import argparse
import csv
import logging
import os
import re
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

try:
    import openpyxl
except ImportError:
    raise SystemExit(
        "openpyxl required: pip install openpyxl --break-system-packages"
    )

from supabase import create_client

# ── Constants ─────────────────────────────────────────────────────────────────

EXPORTS_DIR       = Path("exports")
DEFAULT_THRESHOLD = 0.85   # >= this → auto-write
MIN_THRESHOLD     = 0.70   # >= this but < DEFAULT → review CSV only

# False positives — comedian name matched a wrong DB artist at >= threshold.
# Confirmed via dry-run inspection. Add new entries here as needed.
EXCLUDED_MATCHES: frozenset[str] = frozenset({
    "Ant",                    # matched 'cant'
    "Amy Miller",             # matched 'Adam Miller' (musician)
    "Chris Porter",           # matched 'Chris Potter' (jazz musician)
    "Christopher Titus",      # matched 'Christopher Atkins' (actor)
    "Deon Cole",              # matched 'Devon Cole' (pop artist)
    "Jamie Foxx",             # matched 'Jamie xx' (UK producer)
    "Jimmie JJ Walker",       # matched 'Jimmie Walker' (uncertain)
    "Lucas Brothers",         # matched 'Blues Brothers'
    "Paul Rodriguez",         # matched 'Raquel Rodriguez'
    "Rosie O'Donnell",        # matched 'Roger O'Donnell' (The Cure)
    "Sean Donnelly",          # matched 'Stella Donnelly' (musician)
    "Tony Baker",             # matched 'Troy Baker' (voice actor)
})

# Music-comedy acts — excluded from standup tagging; set comedy_type manually via SQL:
#   UPDATE dim_artist SET comedy_type = 'music-comedy'
#   WHERE artist_name IN ('Flight of the Conchords', 'Tim Minchin', 'Stephen Lynch', 'Bridget Everett');
MUSIC_COMEDY_ACTS: frozenset[str] = frozenset({
    "Flight of the Conchords",
    "Tim Minchin",
    "Stephen Lynch",
    "Bridget Everett",
})

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-8s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ── Name normalisation ────────────────────────────────────────────────────────

_PUNCT  = re.compile(r"[^a-z0-9\s]")
_SPACES = re.compile(r"\s+")


def normalize(name: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    s = name.lower().strip()
    s = _PUNCT.sub(" ", s)
    s = _SPACES.sub(" ", s).strip()
    return s


# ── XLSX loading ──────────────────────────────────────────────────────────────

def load_xlsx(path: Path) -> list[dict]:
    """Return sheet rows as dicts keyed by header row values."""
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not rows:
        return []
    headers = [str(h).strip() if h is not None else f"col_{i}"
               for i, h in enumerate(rows[0])]
    return [
        {headers[i]: (str(v).strip() if v is not None else "")
         for i, v in enumerate(row) if i < len(headers)}
        for row in rows[1:]
        if any(v is not None for v in row)
    ]


# ── Year parsing ──────────────────────────────────────────────────────────────

_YEAR_RANGE = re.compile(r"(\d{4})\s*[-–]\s*(\d{4})")


def parse_year_range(field: str) -> tuple[Optional[int], Optional[int]]:
    """Parse 'YYYY - YYYY' or 'YYYY – YYYY' → (begin_year, end_year)."""
    m = _YEAR_RANGE.search(field or "")
    if m:
        return int(m.group(1)), int(m.group(2))
    return None, None


# ── Build comedian lookup ─────────────────────────────────────────────────────

def build_comedian_list(
    all_path:  Path,
    dead_path: Path,
) -> dict[str, dict]:
    """
    Returns {comedian_name: {is_dead, begin_year, end_year}}.
    Dead comedians override all-comedians entries for the same name.
    """
    comedians: dict[str, dict] = {}

    for row in load_xlsx(all_path):
        name = row.get("Title", "").strip()
        if name:
            comedians[name] = {"is_dead": False, "begin_year": None, "end_year": None}

    for row in load_xlsx(dead_path):
        name = row.get("Title", "").strip()
        if not name:
            continue
        begin, end = parse_year_range(row.get("Field", ""))
        comedians[name] = {"is_dead": True, "begin_year": begin, "end_year": end}

    return comedians


# ── Core run ──────────────────────────────────────────────────────────────────

def run(
    all_path:  Path,
    dead_path: Path,
    threshold: float,
    dry_run:   bool,
    verbose:   bool,
    limit:     Optional[int],
) -> None:
    if verbose:
        logging.getLogger().setLevel(logging.DEBUG)

    supabase_url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ["SUPABASE_URL"]
    supabase_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    db = create_client(supabase_url, supabase_key)

    # ── Load comedian list ────────────────────────────────────────────────────
    log.info("Loading comedian lists…")
    comedians = build_comedian_list(all_path, dead_path)
    dead_count = sum(1 for v in comedians.values() if v["is_dead"])
    log.info(
        "  %d total (%d living, %d dead)",
        len(comedians), len(comedians) - dead_count, dead_count,
    )

    # ── Load dim_artist ───────────────────────────────────────────────────────
    log.info("Loading dim_artist from Supabase…")
    q = db.from_("dim_artist").select("artist_id, artist_name, comedy_type")
    if limit:
        q = q.limit(limit)
    artists = (q.execute()).data or []
    log.info("  %d artists loaded", len(artists))

    artist_lookup: list[dict] = [
        {
            "artist_id":   a["artist_id"],
            "artist_name": a["artist_name"],
            "norm":        normalize(a["artist_name"]),
            "comedy_type": a.get("comedy_type"),
        }
        for a in artists
        if a.get("artist_name")
    ]

    # ── Match ─────────────────────────────────────────────────────────────────
    log.info(
        "Matching %d comedians against %d artists (threshold=%.2f)…",
        len(comedians), len(artist_lookup), threshold,
    )

    review_path = EXPORTS_DIR / "pipeline_reviews" / f"comedian_review_{date.today().isoformat()}.csv"
    review_path.parent.mkdir(parents=True, exist_ok=True)
    review_rows: list[dict] = []

    stats = {"written": 0, "already_tagged": 0, "review": 0, "no_match": 0}

    for comedian_name, meta in comedians.items():
        # Skip known false positives and music-comedy acts
        if comedian_name in EXCLUDED_MATCHES or comedian_name in MUSIC_COMEDY_ACTS:
            log.debug("Skipped (exclusion list): %s", comedian_name)
            continue

        norm_c = normalize(comedian_name)
        best_score  = 0.0
        best_artist = None

        for a in artist_lookup:
            if a["norm"] == norm_c:          # exact normalised hit — stop early
                best_score  = 1.0
                best_artist = a
                break
            s = SequenceMatcher(None, norm_c, a["norm"]).ratio()
            if s > best_score:
                best_score  = s
                best_artist = a

        if best_score < MIN_THRESHOLD or best_artist is None:
            log.debug("No match:  %-40s  best=%.2f", comedian_name, best_score)
            stats["no_match"] += 1
            continue

        artist_id   = best_artist["artist_id"]
        artist_name = best_artist["artist_name"]

        if best_score >= threshold:
            if best_artist["comedy_type"] is not None:
                log.debug("Already:   %-40s → %s", comedian_name, artist_name)
                stats["already_tagged"] += 1
                continue

            # Build update
            update: dict = {"comedy_type": "standup"}
            if meta["begin_year"]:
                update["begin_year"] = meta["begin_year"]
            if meta["end_year"]:
                update["end_year"] = meta["end_year"]

            action   = "[DRY-RUN]" if dry_run else "[WRITE]  "
            dead_str = (f"  ({meta['begin_year']}–{meta['end_year']})"
                        if meta["is_dead"] else "")
            log.info(
                "%s %-40s → %-40s  %.2f%s",
                action, comedian_name[:40], artist_name[:40], best_score, dead_str,
            )

            if not dry_run:
                db.from_("dim_artist").update(update).eq("artist_id", artist_id).execute()

            stats["written"] += 1

            # Flag for verification if not a near-exact match
            if best_score < 0.95:
                review_rows.append({
                    "artist_id":     artist_id,
                    "artist_name":   artist_name,
                    "comedian_name": comedian_name,
                    "similarity":    f"{best_score:.3f}",
                    "reason":        "verify_match",
                    "is_dead":       meta["is_dead"],
                    "begin_year":    meta["begin_year"] or "",
                    "end_year":      meta["end_year"]   or "",
                })

        else:
            # 0.70–threshold: candidate but below confidence bar
            log.info(
                "[REVIEW]  %-40s → %-40s  %.2f  (below threshold)",
                comedian_name[:40], artist_name[:40], best_score,
            )
            stats["review"] += 1
            review_rows.append({
                "artist_id":     artist_id,
                "artist_name":   artist_name,
                "comedian_name": comedian_name,
                "similarity":    f"{best_score:.3f}",
                "reason":        "low_confidence",
                "is_dead":       meta["is_dead"],
                "begin_year":    meta["begin_year"] or "",
                "end_year":      meta["end_year"]   or "",
            })

    # ── Review CSV ────────────────────────────────────────────────────────────
    if review_rows:
        with open(review_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=[
                "artist_id", "artist_name", "comedian_name",
                "similarity", "reason", "is_dead", "begin_year", "end_year",
            ])
            writer.writeheader()
            writer.writerows(review_rows)
        log.info("Review CSV → %s (%d rows)", review_path, len(review_rows))

    # ── Summary ───────────────────────────────────────────────────────────────
    log.info(
        "Done — written: %d | already_tagged: %d | review: %d | no_match: %d",
        stats["written"], stats["already_tagged"], stats["review"], stats["no_match"],
    )
    if dry_run and stats["written"] > 0:
        log.info("Re-run with --live to commit %d updates.", stats["written"])
    if stats["written"] > 0 and not dry_run:
        log.info("")
        log.info("Next step — backfill show_type:")
        log.info("  UPDATE fact_shows")
        log.info("  SET show_type = 'comedy'")
        log.info("  WHERE show_type = 'music'")
        log.info("    AND artist_id IN (")
        log.info("      SELECT artist_id FROM dim_artist WHERE is_comedian = true")
        log.info("    );")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich dim_artist with comedian flag and birth/death years.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--all",  required=True, dest="all_path",
                        help="Dead Frog 'all comedians' XLSX path")
    parser.add_argument("--dead", required=True, dest="dead_path",
                        help="Dead Frog 'dead comedians' XLSX path")
    parser.add_argument("--live", action="store_true", default=False,
                        help="Commit updates to dim_artist (default: dry-run)")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD,
                        metavar="SCORE",
                        help=f"Min similarity to auto-write (default: {DEFAULT_THRESHOLD})")
    parser.add_argument("--limit", type=int, default=None, metavar="N",
                        help="Cap artists loaded from DB (for testing)")
    parser.add_argument("--verbose", action="store_true", default=False,
                        help="Show DEBUG-level logs")
    args = parser.parse_args()

    run(
        all_path=Path(args.all_path),
        dead_path=Path(args.dead_path),
        threshold=args.threshold,
        dry_run=not args.live,
        verbose=args.verbose,
        limit=args.limit,
    )


if __name__ == "__main__":
    main()
