#!/usr/bin/env python3
"""
kexp_enrich.py — Enrich dim_artist with KEXP Full Performance YouTube URLs.

Reads a KEXP Full Performance YouTube playlist exported from Octoparse.
For artists with multiple sessions, stores the most recent URL (playlist
is newest-first, so the first occurrence per artist is the latest video).
Also writes kexp_session_count — number of distinct Full Performance sessions.

Individual song-level videos (e.g. 'HAM - Partýbær (Live on KEXP)') are
automatically skipped; they don't match the Full Performance title pattern.

Usage:
  python scripts/kexp_enrich.py                               # dry run
  python scripts/kexp_enrich.py --live                        # write to DB
  python scripts/kexp_enrich.py --input exports/kexp.xlsx     # custom path
  python scripts/kexp_enrich.py --threshold 0.90 --live       # lower bar

Env vars (scripts/.env or environment):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY   (or SUPABASE_SERVICE_KEY)

Prerequisites:
  pip install rapidfuzz openpyxl supabase python-dotenv --break-system-packages

Output:
  exports/pipeline_reviews/kexp_review_YYYY-MM-DD.csv
    Borderline matches in [0.85, threshold) — verify against MusicBrainz/Spotify
    before accepting. For each: run the standard diagnostic SELECT on artist_id
    then accept via UPDATE.
"""

import argparse
import csv
import os
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from rapidfuzz import fuzz, process
from supabase import create_client

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ACCEPT_THRESHOLD = 0.92   # fuzzy score >= this → auto accept
REVIEW_THRESHOLD = 0.85   # fuzzy score in [REVIEW, ACCEPT) → manual review CSV
DEFAULT_INPUT    = "exports/kexp_full_performance.xlsx"

# Matches ' - Full Performance', ' - Full performance', ' - FullPerformance' (typo),
# ' - Performance & Interview', ' - Interview & Performance'
# The \s* between Full and Performance handles the occasional 'FullPerformance' typo.
_SUFFIX_RE = re.compile(
    r"\s*-\s+(?:Full\s*[Pp]erformance|[Pp]erformance|Interview)",
    re.IGNORECASE,
)

# Catches 'Shout Out Louds   Full Performance...' (spaces instead of dash)
_SPACE_SUFFIX_RE = re.compile(
    r"\s{2,}Full\s*[Pp]erformance",
    re.IGNORECASE,
)

# YouTube clean URL: strip playlist/index params
_WATCH_URL_RE = re.compile(r"(https://www\.youtube\.com/watch\?v=[^&\s]+)")

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("ERROR: Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in environment.")


def get_client():
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def parse_artist_name(title: str) -> str | None:
    """
    Extract artist name from a KEXP playlist title string.

    Handles formats:
      'Courtney Barnett - Full Performance (Live on KEXP)'
      'L'Eclair - Performance & Interview (Live on KEXP at Home)'
      'Hatchie - FullPerformance (Live on KEXP)'  ← typo, no space
      'Shout Out Louds   Full Performance Live on KEXP)'  ← spaces not dash

    Returns None for individual song-level titles:
      'HAM - Partýbær (Live on KEXP)'
      'Mudhoney - Touch Me I'm Sick (Live on KEXP)'
    """
    if not title or pd.isna(title):
        return None
    title = str(title).strip()

    # Primary: 'Artist - Full Performance...'
    parts = _SUFFIX_RE.split(title, maxsplit=1)
    if len(parts) > 1:
        return parts[0].strip()

    # Fallback: 'Artist   Full Performance...' (multiple spaces, no dash)
    parts = _SPACE_SUFFIX_RE.split(title, maxsplit=1)
    if len(parts) > 1:
        return parts[0].strip()

    return None  # individual song video or unrecognised format — skip


def clean_kexp_url(url: str) -> str | None:
    """Strip playlist params, keeping only 'https://www.youtube.com/watch?v=XXXXXXXXXXX'."""
    if not url or pd.isna(url):
        return None
    m = _WATCH_URL_RE.match(str(url).strip())
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------
def load_kexp_data(path: str) -> tuple[pd.DataFrame, list[dict]]:
    """
    Load and normalise KEXP Octoparse export.

    Supports two column layouts:
      New raw format:    Title, Title_URL
      Old parsed format: artist_name, kexp_url

    Returns:
      df         — deduplicated DataFrame (one row per artist, newest-first)
      skipped    — list of parse-failure rows for reporting
    """
    raw = pd.read_excel(path)
    raw.columns = raw.columns.str.strip()

    if "artist_name" in raw.columns and "kexp_url" in raw.columns:
        # Old pre-parsed Octoparse format
        df = pd.DataFrame({
            "artist_name": raw["artist_name"].str.strip(),
            "kexp_url":    raw["kexp_url"],
        })
    elif "Title" in raw.columns and "Title_URL" in raw.columns:
        # New raw Octoparse format
        df = pd.DataFrame({
            "artist_name": raw["Title"].apply(parse_artist_name),
            "kexp_url":    raw["Title_URL"].apply(clean_kexp_url),
            "_raw_title":  raw["Title"],
        })
    else:
        sys.exit(
            f"ERROR: Unrecognised column layout. "
            f"Expected 'Title'+'Title_URL' or 'artist_name'+'kexp_url'. "
            f"Got: {list(raw.columns)}"
        )

    # Separate parse failures (individual songs / unrecognised formats)
    failed_mask = df["artist_name"].isna() | (df["artist_name"].str.strip() == "")
    skipped = []
    if "_raw_title" in df.columns:
        skipped = df[failed_mask & df["_raw_title"].notna()]["_raw_title"].tolist()

    df = df[~failed_mask].copy()
    df = df.drop(columns=["_raw_title"], errors="ignore")
    df = df.dropna(subset=["artist_name", "kexp_url"])

    # Session count (before dedup, so counts all sessions per artist)
    counts = df.groupby("artist_name").size().rename("session_count")
    df = df.join(counts, on="artist_name")

    # Deduplicate: keep first occurrence = most recently posted (playlist is newest-first)
    df = df.drop_duplicates(subset=["artist_name"], keep="first").reset_index(drop=True)

    multi = (df["session_count"] > 1).sum()
    print(
        f"Loaded {len(df)} unique KEXP artists from '{path}' "
        f"({multi} with multiple full-performance sessions, "
        f"{len(skipped)} skipped parse failures)"
    )
    return df, skipped


def load_dim_artist(client) -> list[dict]:
    """Paginate through all dim_artist rows (PostgREST 50K cap)."""
    all_rows, lo, batch = [], 0, 1000
    while True:
        rows = (
            client.table("dim_artist")
            .select("artist_id, artist_name")
            .order("artist_id")
            .range(lo, lo + batch - 1)
            .execute()
            .data
        )
        if not rows:
            break
        all_rows.extend(rows)
        if len(rows) < batch:
            break
        lo += batch
    print(f"Loaded {len(all_rows)} artists from dim_artist")
    return all_rows


# ---------------------------------------------------------------------------
# Fuzzy matching
# ---------------------------------------------------------------------------
def match_artists(
    kexp_df: pd.DataFrame,
    db_artists: list[dict],
    threshold: float,
) -> tuple[list[dict], list[dict], list[dict]]:
    """
    Fuzzy-match each KEXP artist name against dim_artist using WRatio.

    Returns:
      accepts   — score >= threshold           → write to DB
      review    — [REVIEW_THRESHOLD, threshold) → export to review CSV
      no_match  — score < REVIEW_THRESHOLD     → log only
    """
    db_names  = [r["artist_name"] for r in db_artists]
    db_id_map = {r["artist_name"]: r["artist_id"] for r in db_artists}

    accepts, review, no_match = [], [], []

    for _, row in kexp_df.iterrows():
        kexp_name = row["artist_name"]
        kexp_url  = row["kexp_url"]
        sessions  = int(row["session_count"])

        result = process.extractOne(
            kexp_name,
            db_names,
            scorer=fuzz.WRatio,
            score_cutoff=REVIEW_THRESHOLD * 100,
        )

        base = dict(
            kexp_artist_name=kexp_name,
            kexp_url=kexp_url,
            session_count=sessions,
        )

        if result is None:
            no_match.append({**base, "best_score": None, "matched_db_name": None, "artist_id": None})
            continue

        matched_name, score_100, _ = result
        score = round(score_100 / 100, 4)
        record = {
            **base,
            "best_score":      score,
            "matched_db_name": matched_name,
            "artist_id":       db_id_map[matched_name],
        }

        if score >= threshold:
            accepts.append(record)
        else:
            review.append(record)

    return accepts, review, no_match


# ---------------------------------------------------------------------------
# DB writes
# ---------------------------------------------------------------------------
def apply_updates(client, accepts: list[dict], dry_run: bool) -> None:
    if not accepts:
        print("No accepted matches to write.")
        return

    label = "DRY RUN — " if dry_run else ""
    print(f"\n{label}Writing {len(accepts)} kexp_url + kexp_session_count updates:\n")

    updated = 0
    for rec in accepts:
        if not dry_run:
            client.table("dim_artist").update({
                "kexp_url":           rec["kexp_url"],
                "kexp_session_count": rec["session_count"],
            }).eq("artist_id", rec["artist_id"]).execute()
            updated += 1

        tag = "[DRY]" if dry_run else "[OK] "
        sessions_tag = f"  ×{rec['session_count']} sessions" if rec["session_count"] > 1 else ""
        print(
            f"  {tag} {rec['kexp_artist_name']!r:40s}"
            f"  →  artist_id={rec['artist_id']:<8}"
            f"  ({rec['matched_db_name']!r}, score={rec['best_score']:.3f})"
            f"{sessions_tag}"
        )

    if not dry_run:
        print(f"\nUpdated {updated} dim_artist rows.")


# ---------------------------------------------------------------------------
# Review CSV
# ---------------------------------------------------------------------------
def write_review_csv(review: list[dict]) -> str | None:
    if not review:
        print("No borderline matches — review CSV not needed.")
        return None

    out_dir = Path("exports/pipeline_reviews")
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"kexp_review_{date.today().isoformat()}.csv"

    fields = [
        "kexp_artist_name", "matched_db_name", "artist_id",
        "best_score", "session_count", "kexp_url",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(sorted(review, key=lambda r: r["best_score"], reverse=True))

    print(f"\nReview CSV ({len(review)} borderline matches): {path}")
    print(
        "  For each row: run standard diagnostic SELECT on artist_id, "
        "then accept via UPDATE dim_artist SET kexp_url = ..., kexp_session_count = ... "
        "WHERE artist_id = ..."
    )
    return str(path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    parser = argparse.ArgumentParser(
        description="Enrich dim_artist with KEXP Full Performance YouTube URLs"
    )
    parser.add_argument(
        "--input", default=DEFAULT_INPUT,
        help=f"Path to KEXP Octoparse Excel export (default: {DEFAULT_INPUT})",
    )
    parser.add_argument(
        "--threshold", type=float, default=ACCEPT_THRESHOLD,
        help=f"Accept threshold 0–1 (default: {ACCEPT_THRESHOLD})",
    )
    parser.add_argument(
        "--live", action="store_true",
        help="Write matches to DB (default: dry run, no writes)",
    )
    args = parser.parse_args()

    dry_run = not args.live

    print("=" * 64)
    print(f"kexp_enrich.py  —  {'DRY RUN (no DB writes)' if dry_run else 'LIVE'}")
    print(f"  Input:     {args.input}")
    print(f"  Threshold: {args.threshold}  (review: {REVIEW_THRESHOLD} – {args.threshold})")
    print("=" * 64 + "\n")

    kexp_df, skipped = load_kexp_data(args.input)
    client           = get_client()
    db_artists       = load_dim_artist(client)

    accepts, review, no_match = match_artists(kexp_df, db_artists, threshold=args.threshold)

    print(f"\nMatch summary:")
    print(f"  Accepted   (>= {args.threshold:.2f}):                {len(accepts)}")
    print(f"  Review     ({REVIEW_THRESHOLD:.2f} – {args.threshold:.2f}):              {len(review)}")
    print(f"  No match   (<  {REVIEW_THRESHOLD:.2f}):                {len(no_match)}")
    print(f"  Skipped    (parse failures — individual songs etc.): {len(skipped)}")

    apply_updates(client, accepts, dry_run=dry_run)
    write_review_csv(review)

    if no_match:
        print(f"\nNo-match artists ({len(no_match)}, score < {REVIEW_THRESHOLD:.2f}):")
        for rec in sorted(no_match, key=lambda r: r["kexp_artist_name"]):
            multi = f"  ×{rec['session_count']}" if rec["session_count"] > 1 else ""
            print(f"  {rec['kexp_artist_name']!r}{multi}")

    if skipped:
        print(f"\nSkipped parse failures ({len(skipped)} — mostly individual song videos):")
        for title in sorted(skipped):
            print(f"  {title!r}")

    print("\nDone.")


if __name__ == "__main__":
    main()
