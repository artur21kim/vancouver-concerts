"""
Combine all Canadian province secondary_cities_XX.csv files into one
sorted by total_shows descending.

Run from project root:
    python combine_canada_provinces.py
"""
import csv
import glob
import os

files = sorted(
    glob.glob("exports/reviews/secondary_cities_??.csv")
    + glob.glob("exports/reviews/secondary_cities_???.csv")
)

rows = []
for f in files:
    province = (
        os.path.basename(f)
        .replace("secondary_cities_", "")
        .replace(".csv", "")
        .upper()
    )
    with open(f, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            row["province"] = province
            rows.append(row)

rows.sort(
    key=lambda r: int(r["total_shows"]) if str(r["total_shows"]).isdigit() else -1,
    reverse=True,
)

out_path = "exports/reviews/secondary_cities_canada_all.csv"
with open(out_path, "w", newline="", encoding="utf-8") as out:
    fields = ["province", "secondary_city", "state", "country_code",
              "total_shows", "fetch_recommended", "note"]
    w = csv.DictWriter(out, fieldnames=fields, extrasaction="ignore")
    w.writeheader()
    w.writerows(rows)

print(f"Done — {len(rows)} cities written to {out_path}")
