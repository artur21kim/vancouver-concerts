# Grooveprint — Scripts Cheatsheet

All data pipeline and enrichment scripts live in `vancouver-concerts/scripts/`.

---

## Quick reference

| Script | Purpose | Trigger | Frequency | Env vars required |
|--------|---------|---------|-----------|-------------------|
| `refresh_shows.py` | Load fetched setlist data into Supabase after alias review | Manual | Per city import | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `fetch_setlist_api.py` | Pull show data from setlist.fm API for a city/year range | Manual (GitHub Actions planned — GP-95) | Daily delta + historical backfill | `SETLIST_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `find_secondary_cities.py` | Discover additional cities in a province/state by show volume | Manual | One-off per region | `SETLIST_API_KEY` |
| `musicbrainz_artist_enrich.py` | Enrich `dim_artist` with MBIDs and official website URLs | Manual (auto-trigger planned — GP-97) | Post-ingestion | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `musicbrainz_venue_enrich.py` | Enrich `dim_venue` with MBIDs, open/close dates, lat/long, and URLs | Manual | Post-ingestion, per city catch-up | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `wikidata_capacity_enrich.py` | Populate `dim_venue.capacity` via Wikidata P1083 (max capacity), using `musicbrainz_place_id` as lookup key | Manual | Post-MB-enrichment, per city catch-up | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `tm_enrichment/tm_enrichment.py` | Enrich `fact_shows` with Ticketmaster URLs; enrich `dim_venue` with lat/long for TM-mapped venues | Manual | Per city, after import | `TM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `nominatim_enrich.py` | Geocode `dim_venue` lat/long via OpenStreetMap Nominatim (fallback after TM + MB) | Manual | Post-ingestion | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `spotify_matching/spotify_matcher_fixed.py` | Match artists against Spotify library for initial data load | Manual | One-off / as needed | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `spotify_matching/merge_spotify_data.py` | Merge Spotify match output files | Manual | One-off | — |
| `combine_city_csvs.py` | Merge multiple per-year-range CSVs into a single combined file | Manual | Per city import | — |
| `backfill-albums-admin.ts` | One-off TypeScript admin script to backfill Spotify album data | Manual | One-off | Supabase service key |

---

## Detailed usage

### `refresh_shows.py`
Loads a city's fetched setlist data into Supabase. Always dry-run first.

```bash
# Dry run (preview only, no writes)
python scripts/refresh_shows.py --city Vancouver --state BC --country CA --dry-run

# Interactive alias review + live insert
python scripts/refresh_shows.py --city Vancouver --state BC --country CA

# Skip interactive alias prompts
python scripts/refresh_shows.py --city Vancouver --state BC --country CA --no-interactive
```

**Note:** `--city`, `--state`, `--country` are all required. `auto_update_venue_status()` runs automatically after each live insert.

---

### `fetch_setlist_api.py`
Fetches raw show data from the setlist.fm API. Supports resume across sessions.

```bash
# Full historical fetch for a new city
python scripts/fetch_setlist_api.py --city Toronto --state ON --country CA --year-range 1900 2025

# Resume an interrupted fetch
python scripts/fetch_setlist_api.py --city Toronto --state ON --country CA --year-range 1980 2021 --resume

# Daily delta (current year only)
python scripts/fetch_setlist_api.py --city Vancouver --state BC --country CA --year 2026
```

**Rate limit:** 2 req/sec, 1,440 req/day (basic tier). Resets ~11:19 AM PST.  
**Output:** Airport-code named CSV files (e.g. `yvr_2026-06-09.csv`).  
**GitHub Actions:** Planned at 19:30 UTC daily (GP-95), Vancouver-only until rate limit upgrade confirmed.

---

### `find_secondary_cities.py`
Discovers cities in a province/state that exceed a show volume threshold.

```bash
# Province-wide sweep (GP-96) — enumerates cities from setlist.fm API
python scripts/find_secondary_cities.py --state BC --country CA
python scripts/find_secondary_cities.py --state ON --country CA

# Resume interrupted sweep (re-run same command with same --output path)
python scripts/find_secondary_cities.py --state SK --country CA --output exports/secondary_cities_sk.csv
```

**Threshold:** >1,000 shows (default) = ingestion candidate; adjust with `--threshold 500` for smaller provinces.

---

### `musicbrainz_artist_enrich.py`
Looks up MBIDs and official website URLs for artists in `dim_artist`.

```bash
# Preflight — no DB writes
python scripts/musicbrainz_artist_enrich.py --limit 20

# Live run — new artists only (post-ingestion):
python scripts/musicbrainz_artist_enrich.py --new-only --live

# Full overnight run:
python scripts/musicbrainz_artist_enrich.py --live --verbose
```

**Note:** Renamed from `musicbrainz_enrich.py` (GP-129). Uses `musicbrainz_artist_id` column.

---

### `musicbrainz_venue_enrich.py`
Looks up MBIDs, open/close dates, coordinates, and official URLs for venues in `dim_venue`.

```bash
# Preflight — no DB writes
python scripts/musicbrainz_venue_enrich.py --limit 20

# Live run — all unenriched venues
python scripts/musicbrainz_venue_enrich.py --live

# Limit to a single city (useful for post-ingestion catch-up)
python scripts/musicbrainz_venue_enrich.py --live --city Toronto
python scripts/musicbrainz_venue_enrich.py --live --city Vancouver
python scripts/musicbrainz_venue_enrich.py --live --city Seattle

# Overnight catch-up run
python scripts/musicbrainz_venue_enrich.py --live --verbose

# Re-process already-enriched venues
python scripts/musicbrainz_venue_enrich.py --live --force
```

**Coordinate write policy:** lat/long is only written if the venue has no existing coordinates (TM coords are preserved). Use `--overwrite-coords` to override.  
**Output:** `exports/musicbrainz_venue_review_YYYY-MM-DD.csv` — venues with disambiguation notes or partial data.

**Prerequisites — schema migration (run once in Supabase SQL editor):**
```sql
ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS musicbrainz_place_id text;
ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS begin_date date;
ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE dim_venue ADD COLUMN IF NOT EXISTS official_website_url text;
```

---

### `wikidata_capacity_enrich.py`
Populates `dim_venue.capacity` via Wikidata SPARQL. Uses `musicbrainz_place_id` (Wikidata property P1004) to look up each venue's Wikidata item, then extracts P1083 (maximum capacity). No API key required — Wikidata SPARQL is free and CC0.

Run **after** `musicbrainz_venue_enrich.py` — requires `musicbrainz_place_id` to be populated first.

```bash
# Preflight — no DB writes
python scripts/wikidata_capacity_enrich.py --limit 200

# Live run — all venues with MBID but no capacity
python scripts/wikidata_capacity_enrich.py --live

# Limit to a single city
python scripts/wikidata_capacity_enrich.py --live --city Vancouver
python scripts/wikidata_capacity_enrich.py --live --city Seattle
python scripts/wikidata_capacity_enrich.py --live --city Toronto

# Re-process venues that already have a capacity value
python scripts/wikidata_capacity_enrich.py --live --force
```

**Important:** `dim_venue.capacity_category` is a `GENERATED ALWAYS` computed column — it auto-derives from `capacity` and cannot be written to directly. Only write to `capacity`.  
**Output:** `exports/wikidata_capacity_review_YYYY-MM-DD.csv` — outlier values (< 100 or > 200,000) flagged for manual verification.  
**Prerequisites:** `musicbrainz_place_id` must be populated. Run `musicbrainz_venue_enrich.py` first.

---

### `tm_enrichment/tm_enrichment.py`
Matches upcoming shows to Ticketmaster events and writes `ticketmaster_url` to `fact_shows`.  
Also populates `latitude`/`longitude` for TM-mapped venues (Pass 1, GP-98).

```bash
cd scripts/tm_enrichment
python tm_enrichment.py
```

Requires `dim_venue.tm_venue_id` to be populated for each venue first.

---

### `nominatim_enrich.py`
Geocodes `dim_venue` rows missing lat/long via OpenStreetMap Nominatim.  
**Run after TM and MusicBrainz enrichment** — this is the fallback for venues not found in either.

```bash
# Preflight
python scripts/nominatim_enrich.py --limit 20

# Live run
python scripts/nominatim_enrich.py --live

# Limit to a specific city
python scripts/nominatim_enrich.py --live --city Seattle

# Review CSV: exports/nominatim_review_YYYY-MM-DD.csv
# Low-confidence matches require manual verification in Google Maps
```

---

### `spotify_matching/spotify_matcher_fixed.py`
Matches Grooveprint artists against a user's Spotify library.

```bash
cd scripts/spotify_matching
python spotify_matcher_fixed.py
```

---

## Environment variables

Each script subfolder has its own `.env` file (gitignored). Copy `.env.example` if starting fresh.

| Variable | Used by |
|----------|---------|
| `SETLIST_API_KEY` | `fetch_setlist_api.py`, `find_secondary_cities.py` |
| `SUPABASE_URL` | All Supabase-connected scripts |
| `SUPABASE_SERVICE_KEY` | `refresh_shows.py`, `nominatim_enrich.py`, `tm_enrichment.py` |
| `SUPABASE_SERVICE_ROLE_KEY` | `musicbrainz_artist_enrich.py`, `musicbrainz_venue_enrich.py`, `wikidata_capacity_enrich.py` |
| `TM_API_KEY` | `tm_enrichment.py` |
| `SPOTIFY_CLIENT_ID` | `spotify_matcher_fixed.py` |
| `SPOTIFY_CLIENT_SECRET` | `spotify_matcher_fixed.py` |

---

## Recommended run order for a new city

1. `fetch_setlist_api.py` — pull historical data (multi-day)
2. `refresh_shows.py --dry-run` — preview alias candidates
3. `refresh_shows.py` — interactive alias review + live insert  
   ↳ `auto_update_venue_status()` runs automatically after insert
4. `musicbrainz_artist_enrich.py --new-only --live` — enrich new artists
5. `tm_enrichment.py` — lat/long for TM-mapped venues; upcoming show TM URLs
6. `musicbrainz_venue_enrich.py --live --city <city>` — MBID, dates, lat/long for MB-known venues
7. `nominatim_enrich.py --live --city <city>` — fallback geocoding for remaining venues
8. `wikidata_capacity_enrich.py --live --city <city>` — capacity from Wikidata for MB-matched venues
