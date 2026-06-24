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
    "toronto":      ("ON", "CA", "exports/_CA/ON/toronto"),
    "vancouver":    ("BC", "CA", "exports/_CA/BC/vancouver"),
    "montreal":     ("QC", "CA", "exports/_CA/QC/montreal"),
    "calgary":      ("AB", "CA", "exports/_CA/AB/calgary"),
    "edmonton":     ("AB", "CA", "exports/_CA/AB/edmonton"),
    "winnipeg":     ("MB", "CA", "exports/_CA/MB/winnipeg"),
    "ottawa":       ("ON", "CA", "exports/_CA/ON/ottawa"),
    "halifax":      ("NS", "CA", "exports/_CA/NS/halifax"),
    "quebec city":  ("QC", "CA", "exports/_CA/QC/quebec_city"),
    "seattle":      ("WA", "US", "exports/_US/WA/seattle"),
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
        if "Tour:" in details2:
            tour_name = details4
            venue     = details6 or details4  # details6 has venue; fall back to details4
        else:
            tour_name = ""
            venue     = details4  # details4 always has venue when no tour

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
