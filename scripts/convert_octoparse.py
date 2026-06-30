#!/usr/bin/env python3
"""
Grooveprint — Convert Octoparse 2026 Excel exports to refresh_shows.py-compatible CSV
scripts/convert_octoparse.py

Octoparse scrapes upcoming shows from setlist.fm and stores venue/tour info
in a conditional column layout. This script normalises that into the same CSV
schema that refresh_shows.py expects from fetch_setlist_api.py.

Column mapping:
  Octoparse:  Field1 (title) | Field (url) | month | day | Year | details (artist)
              | details2 (Venue:/Tour: prefix) | details4 (venue or tour) | details6 (venue when tour)
  Output:     Field (url) | month | day | Year | details (artist)
              | details2 | details4 (venue) | tour_name

Usage:
    # Single file
    python scripts/convert_octoparse.py "exports/octoparse/Toronto - 2026.xlsx"

    # All xlsx files in a folder
    python scripts/convert_octoparse.py exports/octoparse/

    # Explicit output path
    python scripts/convert_octoparse.py "exports/octoparse/Toronto - 2026.xlsx" --output exports/_CA/ON/toronto/toronto_2026_api.csv

    # Preview without writing
    python scripts/convert_octoparse.py exports/octoparse/ --dry-run

Requires: openpyxl
    pip install openpyxl --break-system-packages
"""

import argparse
import csv
import sys
from pathlib import Path

try:
    import openpyxl
except ImportError:
    print("ERROR: openpyxl not installed. Run: pip install openpyxl --break-system-packages")
    sys.exit(1)

# ── City → (state, country, exports path) mapping ─────────────────────────────
# Add new cities here as Octoparse scrapes are done.
CITY_MAP = {
    # Canada — BC
    "vancouver":      ("BC", "CA", "exports/_CA/BC/vancouver"),
    "victoria":       ("BC", "CA", "exports/_CA/BC/victoria"),
    "kelowna":        ("BC", "CA", "exports/_CA/BC/kelowna"),
    # Canada — AB
    "calgary":        ("AB", "CA", "exports/_CA/AB/calgary"),
    "edmonton":       ("AB", "CA", "exports/_CA/AB/edmonton"),
    # Canada — MB
    "winnipeg":       ("MB", "CA", "exports/_CA/MB/winnipeg"),
    # Canada — ON
    "toronto":        ("ON", "CA", "exports/_CA/ON/toronto"),
    "ottawa":         ("ON", "CA", "exports/_CA/ON/ottawa"),
    # Canada — QC
    "montreal":       ("QC", "CA", "exports/_CA/QC/montreal"),
    "quebec city":    ("QC", "CA", "exports/_CA/QC/quebec_city"),
    # Canada — NS
    "halifax":        ("NS", "CA", "exports/_CA/NS/halifax"),
    # United States — WA
    "seattle":        ("WA", "US", "exports/_US/WA/seattle"),
    # United States — NY
    "new york city":  ("NY", "US", "exports/_US/NY/new_york_city"),
    "brooklyn":       ("NY", "US", "exports/_US/NY/brooklyn"),
    # United States — IL
    "chicago":        ("IL", "US", "exports/_US/IL/chicago"),
    # United States — CA
    "los angeles":    ("CA", "US", "exports/_US/CA/los_angeles"),
    "san francisco":  ("CA", "US", "exports/_US/CA/san_francisco"),
    "west hollywood": ("CA", "US", "exports/_US/CA/west_hollywood"),
    # United States — TX
    "dallas":         ("TX", "US", "exports/_US/TX/dallas"),
    "austin":         ("TX", "US", "exports/_US/TX/austin"),
    # United States — NV
    "las vegas":      ("NV", "US", "exports/_US/NV/las_vegas"),
    # United States — PA
    "philadelphia":   ("PA", "US", "exports/_US/PA/philadelphia"),
    # United States — GA
    "atlanta":        ("GA", "US", "exports/_US/GA/atlanta"),
    # United States — KY
    "louisville":     ("KY", "US", "exports/_US/KY/louisville"),
    # United States — CO
    "denver":         ("CO", "US", "exports/_US/CO/denver"),
    # United States — OK
    "oklahoma city":  ("OK", "US", "exports/_US/OK/oklahoma_city"),
    # United States — AZ
    "phoenix":        ("AZ", "US", "exports/_US/AZ/phoenix"),
    # TODO: add further cities as expansion pipeline is finalized
}

OUTPUT_FIELDNAMES = ["Field", "month", "day", "Year", "details", "details2", "details4", "tour_name"]


def detect_city(filename: str) -> str | None:
    """Infer city name from filename like 'Toronto - 2026.xlsx'."""
    stem = Path(filename).stem.lower()
    # Strip year and separators
    for sep in [" - ", "_", "-"]:
        stem = stem.split(sep)[0].strip()
    return stem if stem in CITY_MAP else None


def convert_file(input_path: Path, output_path: Path, dry_run: bool) -> int:
    """Convert a single Octoparse xlsx to API-compatible CSV. Returns row count."""
    wb = openpyxl.load_workbook(input_path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print(f"  WARNING: {input_path.name} is empty — skipping")
        return 0

    # Build header index from first row
    raw_headers = [str(h).strip() if h is not None else "" for h in rows[0]]
    header_idx = {h: i for i, h in enumerate(raw_headers)}

    def get(row, col):
        idx = header_idx.get(col)
        if idx is None:
            return ""
        v = row[idx]
        return str(v).strip() if v is not None else ""

    converted = []
    skipped = 0

    for row in rows[1:]:
        url      = get(row, "Field")
        month    = get(row, "month")
        day      = get(row, "day")
        year     = get(row, "Year")
        artist   = get(row, "details")
        details2 = get(row, "details2")
        details4 = get(row, "details4")
        details6 = get(row, "details6")

        # Skip rows missing URL or artist
        if not url or "setlist.fm" not in url or not artist:
            skipped += 1
            continue

        # Extract tour_name: when details2 starts with "Tour:", details4 holds the tour name
        # and details6 holds the venue. GP-168: previously fell back to details4 (the tour
        # name) when details6 was blank — that string has no commas, so extract_venue_info()
        # in refresh_shows.py would treat the whole tour name as a venue name with no city/
        # state/country, silently defaulting those to the --city/--state/--country CLI args
        # and creating a garbage dim_venue row named after the tour. Skip instead.
        if "Tour:" in details2:
            tour_name = details4
            if not details6:
                skipped += 1
                continue
            venue = details6
        else:
            tour_name = ""
            venue     = details4  # details4 always has venue when no tour

        # Normalise country variants in venue string to match setlist.fm API canonical forms
        # Octoparse scrapes use "USA" / "UK" while the API returns full names
        venue = (venue
                 .replace(", USA", ", United States")
                 .replace(", UK", ", United Kingdom")
                 .replace(", UAE", ", United Arab Emirates"))

        converted.append({
            "Field":    url,
            "month":    month,
            "day":      day,
            "Year":     year,
            "details":  artist,
            "details2": "Venue:",   # normalise to API format
            "details4": venue,
            "tour_name": tour_name,
        })

    wb.close()

    print(f"  {input_path.name}")
    print(f"    Rows parsed:  {len(rows) - 1:,}")
    print(f"    Skipped:      {skipped:,}  (missing URL or artist)")
    print(f"    Ready:        {len(converted):,}")
    print(f"    Output:       {output_path}")

    if dry_run:
        print(f"    [DRY RUN — no file written]")
        return len(converted)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDNAMES)
        writer.writeheader()
        writer.writerows(converted)

    print(f"    ✅  Written")
    return len(converted)


def resolve_output(input_path: Path, explicit_output: str | None) -> Path:
    """Determine output CSV path for a given input file."""
    if explicit_output:
        return Path(explicit_output)

    city_key = detect_city(input_path.name)
    if city_key and city_key in CITY_MAP:
        state, country, folder = CITY_MAP[city_key]
        year = "2026"  # default; override with --year if needed
        city_slug = city_key.replace(" ", "_")
        return Path(folder) / f"{city_slug}_{year}_api.csv"

    # Fallback: same folder, .csv extension
    return input_path.with_suffix(".csv")


def main():
    ap = argparse.ArgumentParser(
        description="Convert Octoparse xlsx exports to refresh_shows.py-compatible CSV",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("input", help="Path to .xlsx file or folder of .xlsx files")
    ap.add_argument("--output", default="", help="Explicit output CSV path (single file only)")
    ap.add_argument("--dry-run", action="store_true", help="Preview without writing files")
    args = ap.parse_args()

    input_path = Path(args.input)

    if input_path.is_dir():
        files = sorted(input_path.glob("*.xlsx"))
        if not files:
            print(f"ERROR: No .xlsx files found in {input_path}")
            sys.exit(1)
        if args.output:
            print("ERROR: --output cannot be used with a folder input")
            sys.exit(1)
        print(f"Converting {len(files)} file(s) from {input_path}\n")
        total = 0
        for f in files:
            out = resolve_output(f, None)
            total += convert_file(f, out, args.dry_run)
            print()
        print(f"Total rows ready: {total:,}")

    elif input_path.is_file():
        out = resolve_output(input_path, args.output or None)
        convert_file(input_path, out, args.dry_run)
        if not args.dry_run:
            print(f"\nNext step:")
            city_key = detect_city(input_path.name)
            if city_key and city_key in CITY_MAP:
                state, country, _ = CITY_MAP[city_key]
                city_display = city_key.title()
                print(f'  python scripts/refresh_shows.py --input {out} --city "{city_display}" --state {state} --country {country} --dry-run')

    else:
        print(f"ERROR: {input_path} not found")
        sys.exit(1)


if __name__ == "__main__":
    main()
