#!/usr/bin/env python3
"""
Grooveprint — Combine fragmented city CSV files
scripts/combine_city_csvs.py

Merges multiple per-year-range CSVs in a city folder into a single
combined file ready for refresh_shows.py.

Usage:
    # Combine all CSVs in a folder (auto-detects city name for output):
    python scripts/combine_city_csvs.py exports/seattle
    python scripts/combine_city_csvs.py exports/seattle-tacoma

    # Explicit output path:
    python scripts/combine_city_csvs.py exports/seattle --output exports/seattle/seattle_1900-2025_api.csv

    # Preview only (no write):
    python scripts/combine_city_csvs.py exports/seattle --dry-run
"""

import argparse
import csv
import glob
import os
import sys
from pathlib import Path


def combine_csvs(folder: Path, output_path: Path, dry_run: bool) -> None:
    # Find all CSVs in the folder, sorted by name (chronological by filename convention)
    all_files = sorted(folder.glob("*.csv"))

    # Exclude the output file itself if it already exists in the same folder
    input_files = [f for f in all_files if f.resolve() != output_path.resolve()]

    if not input_files:
        print(f"ERROR: No CSV files found in {folder}")
        sys.exit(1)

    print(f"Folder:  {folder}")
    print(f"Output:  {output_path}")
    print(f"Mode:    {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"Files ({len(input_files)}):")

    total_rows = 0
    fieldnames = None

    # First pass: validate headers are consistent and count rows
    for filepath in input_files:
        try:
            # Try common encodings
            for enc in ("utf-8-sig", "utf-8", "latin-1"):
                try:
                    with open(filepath, newline="", encoding=enc) as f:
                        reader = csv.DictReader(f)
                        if fieldnames is None:
                            fieldnames = reader.fieldnames
                        elif reader.fieldnames != fieldnames:
                            print(f"  ⚠️  Header mismatch in {filepath.name} — using first file's headers")
                        rows = sum(1 for _ in reader)
                    total_rows += rows
                    print(f"  + {filepath.name:<60} {rows:>6,} rows")
                    break
                except UnicodeDecodeError:
                    continue
        except Exception as e:
            print(f"  ⚠️  Could not read {filepath.name}: {e}")

    print(f"\n  Total: {total_rows:,} rows across {len(input_files)} files")

    if dry_run:
        print(f"\n  Dry run — no file written. Remove --dry-run to combine.")
        return

    # Second pass: write combined file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0

    with open(output_path, "w", newline="", encoding="utf-8") as outfile:
        writer = None
        for filepath in input_files:
            for enc in ("utf-8-sig", "utf-8", "latin-1"):
                try:
                    with open(filepath, newline="", encoding=enc) as infile:
                        reader = csv.DictReader(infile)
                        if writer is None:
                            writer = csv.DictWriter(outfile, fieldnames=reader.fieldnames,
                                                    extrasaction="ignore")
                            writer.writeheader()
                        for row in reader:
                            writer.writerow(row)
                            written += 1
                    break
                except UnicodeDecodeError:
                    continue

    print(f"\n  ✅  Written: {written:,} rows → {output_path}")
    print(f"\nNext step:")
    city_arg = folder.name.replace("seattle-", "")  # crude guess — override with --output
    print(f"  python scripts/refresh_shows.py --input {output_path} --dry-run")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Combine fragmented city CSVs into a single file for refresh_shows.py",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    ap.add_argument("folder", help="Path to the city export folder, e.g. exports/seattle")
    ap.add_argument("--output", default="",
                    help="Output CSV path (default: {folder}/{foldername}_1900-2025_api.csv)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Preview files and row counts without writing")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.exists():
        print(f"ERROR: Folder not found: {folder}")
        sys.exit(1)

    if args.output:
        output_path = Path(args.output)
    else:
        # Default: {folder}/{foldername}_1900-2025_api.csv
        output_path = folder / f"{folder.name}_1900-2025_api.csv"

    combine_csvs(folder, output_path, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
