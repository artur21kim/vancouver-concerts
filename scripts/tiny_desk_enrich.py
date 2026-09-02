#!/usr/bin/env python3
"""
tiny_desk_enrich.py
Fuzzy-match dim_artist against the NPR Tiny Desk Concert YouTube playlist
scraped via Octoparse. Writes tiny_desk_url and tiny_desk_session_count
to dim_artist.

Note: the artist_id grouping bug present in kexp_enrich.py is fixed here
from the start. All playlist rows are fuzzy-matched first, then grouped by
matched artist_id. This means name variants (capitalisation, '&' vs 'and',
etc.) that resolve to the same DB artist correctly sum their session counts
rather than last-write-wins.

Usage:
  python scripts/tiny_desk_enrich.py --input exports/Tiny_Desk.xlsx
  python scripts/tiny_desk_enrich.py --input exports/Tiny_Desk.xlsx --live
  python scripts/tiny_desk_enrich.py --input exports/Tiny_Desk.xlsx --threshold 0.90
"""

import argparse
import csv
import os
import sys
from collections import defaultdict
from datetime import date
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import openpyxl
from rapidfuzz import fuzz
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

SUFFIXES = [
    ": Tiny Desk Concert",
    ": Tiny Desk (Home) Concert",
]
DEFAULT_THRESHOLD = 0.92
REVIEW_MIN        = 0.85
SHORT_FRAGMENT_MAX = 5   # WRatio 0.90 on names <= this length → auto-reject


# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_artist_name(title: str) -> str | None:
    """Strip known Tiny Desk title suffixes, return artist name or None."""
    title = title.strip()
    for suffix in SUFFIXES:
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return None


def clean_url(raw_url: str) -> str:
    """Strip playlist tracking params; keep only watch?v=XXXX."""
    parsed = urlparse(raw_url)
    qs = parse_qs(parsed.query)
    clean_qs = {"v": qs["v"]} if "v" in qs else {}
    clean = parsed._replace(query=urlencode(clean_qs, doseq=True))
    return urlunparse(clean)


def load_playlist(path: str) -> list[dict]:
    """
    Load Octoparse xlsx export (Title / Title_URL columns).
    Returns list of {artist_name, url, index} in playlist order (0-based,
    lower index = closer to top = most recently added).
    """
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    headers = None
    rows    = []
    idx     = 0

    for row in ws.iter_rows(values_only=True):
        if headers is None:
            headers = [str(h).strip() if h else "" for h in row]
            continue
        record = dict(zip(headers, row))
        title  = str(record.get("Title", "") or "").strip()
        url    = str(record.get("Title_URL", "") or "").strip()
        if not title or not url:
            idx += 1
            continue
        artist_name = parse_artist_name(title)
        if not artist_name:
            idx += 1
            continue
        rows.append({"artist_name": artist_name, "url": clean_url(url), "index": idx})
        idx += 1

    wb.close()
    return rows


def fetch_db_artists(supabase: Client) -> list[dict]:
    """Paginate dim_artist; handles PostgREST 50k row cap."""
    all_artists = []
    lo, batch = 0, 1000
    while True:
        resp = (
            supabase.from_("dim_artist")
            .select("artist_id, artist_name")
            .order("artist_id")
            .range(lo, lo + batch - 1)
            .execute()
        )
        chunk = resp.data or []
        all_artists.extend(chunk)
        if len(chunk) < batch:
            break
        lo += batch
    return all_artists


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="NPR Tiny Desk Concert enrichment")
    parser.add_argument("--input",     required=True, help="Path to Octoparse xlsx export")
    parser.add_argument("--threshold", type=float,    default=DEFAULT_THRESHOLD,
                        help=f"Accept threshold (default {DEFAULT_THRESHOLD})")
    parser.add_argument("--live",      action="store_true",
                        help="Write to database (default: dry run)")
    args = parser.parse_args()

    supabase   = create_client(SUPABASE_URL, SUPABASE_KEY)
    playlist   = load_playlist(args.input)
    db_artists = fetch_db_artists(supabase)

    print(f"Playlist rows parsed : {len(playlist)}")
    print(f"DB artists           : {len(db_artists)}")
    print(f"Mode                 : {'LIVE' if args.live else 'DRY RUN'}")
    print(f"Threshold            : {args.threshold}")
    print()

    # ── Step 1: fuzzy match every playlist row ────────────────────────────────
    # Collect hits keyed by artist_id so all name variants accumulate correctly.
    # {artist_id -> [{index, url, score, playlist_name, db_name}]}
    hits_by_id: dict[int, list] = defaultdict(list)
    review_rows:   list[dict]   = []
    parse_failures:list[str]    = []

    for row in playlist:
        pname      = row["artist_name"]
        best_score = 0.0
        best_db    = None

        for db in db_artists:
            score = fuzz.WRatio(pname, db["artist_name"]) / 100.0
            if score > best_score:
                best_score = score
                best_db    = db

        if best_db is None:
            parse_failures.append(pname)
            continue

        # Short-fragment false-positive guard (mirrors kexp_enrich rule)
        if best_score == 0.90 and len(best_db["artist_name"]) <= SHORT_FRAGMENT_MAX:
            review_rows.append({
                "playlist_name":     pname,
                "matched_db_name":   best_db["artist_name"],
                "matched_artist_id": best_db["artist_id"],
                "score":             round(best_score, 4),
                "url":               row["url"],
                "note":              "auto-rejected: short-fragment",
            })
            continue

        if best_score >= args.threshold:
            hits_by_id[best_db["artist_id"]].append({
                "index":        row["index"],
                "url":          row["url"],
                "score":        best_score,
                "playlist_name":pname,
                "db_name":      best_db["artist_name"],
            })
        elif best_score >= REVIEW_MIN:
            review_rows.append({
                "playlist_name":     pname,
                "matched_db_name":   best_db["artist_name"],
                "matched_artist_id": best_db["artist_id"],
                "score":             round(best_score, 4),
                "url":               row["url"],
                "note":              "",
            })

    # ── Step 2: collapse hits per artist_id ───────────────────────────────────
    # Use lowest playlist index (= most recent upload) as the canonical URL;
    # sum all hits as session count.
    updates = []
    for artist_id, hits in hits_by_id.items():
        hits.sort(key=lambda h: h["index"])
        best        = hits[0]
        session_count = len(hits)
        updates.append({
            "artist_id":            artist_id,
            "tiny_desk_url":        best["url"],
            "tiny_desk_session_count": session_count,
            "playlist_name":        best["playlist_name"],
            "db_name":              best["db_name"],
            "score":                best["score"],
        })

    updates.sort(key=lambda u: u["db_name"])

    # ── Summary ───────────────────────────────────────────────────────────────
    print(f"Matched              : {len(updates)} artists")
    print(f"Review candidates    : {len(review_rows)}  (score {REVIEW_MIN}–{args.threshold})")
    print(f"Parse failures       : {len(parse_failures)}")
    print()

    for u in updates:
        tag = "[LIVE]" if args.live else "[DRY ]"
        sc  = u["tiny_desk_session_count"]
        print(f"  {tag} {u['db_name']} (id={u['artist_id']}) "
              f"← \"{u['playlist_name']}\" | sessions={sc} | score={u['score']:.3f}")

    # ── Step 3: write to DB ───────────────────────────────────────────────────
    if args.live:
        if not updates:
            print("\nNo updates to write.")
        else:
            print(f"\nWriting {len(updates)} updates...")
            errors = 0
            for u in updates:
                try:
                    supabase.from_("dim_artist").update({
                        "tiny_desk_url":          u["tiny_desk_url"],
                        "tiny_desk_session_count": u["tiny_desk_session_count"],
                    }).eq("artist_id", u["artist_id"]).execute()
                except Exception as e:
                    print(f"  ERROR artist_id={u['artist_id']}: {e}", file=sys.stderr)
                    errors += 1
            print(f"Done. {len(updates) - errors} written, {errors} errors.")
    else:
        print("\nDry run — re-run with --live to write.")

    # ── Step 4: review CSV ────────────────────────────────────────────────────
    if review_rows:
        review_path = f"exports/pipeline_reviews/tiny_desk_review_{date.today()}.csv"
        os.makedirs(os.path.dirname(review_path), exist_ok=True)
        with open(review_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["playlist_name", "matched_db_name",
                            "matched_artist_id", "score", "url", "note"],
            )
            writer.writeheader()
            writer.writerows(review_rows)
        print(f"\nReview CSV → {review_path}  ({len(review_rows)} rows)")

    if parse_failures:
        print(f"\nParse failures ({len(parse_failures)}):")
        for name in parse_failures[:20]:
            print(f"  {name}")
        if len(parse_failures) > 20:
            print(f"  ... and {len(parse_failures) - 20} more")


if __name__ == "__main__":
    main()
