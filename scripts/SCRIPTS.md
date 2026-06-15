# Grooveprint — Scripts Cheatsheet

All data pipeline and enrichment scripts live in `vancouver-concerts/scripts/`.

---

## Quick reference

| Script | Purpose | Trigger | Frequency | Env vars required |
|--------|---------|---------|-----------|-------------------|
| `refresh_shows.py` | Load fetched setlist data into Supabase after alias review | Manual | Per city import | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `fetch_setlist_api.py` | Pull show data from setlist.fm API for a city/year range | Manual (GitHub Actions planned — SCRUM-95) | Daily delta + historical backfill | `SETLIST_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `find_secondary_cities.py` | Discover additional cities in a province/state by show volume | Manual | One-off per region | `SETLIST_API_KEY` |
| `musicbrainz_enrich.py` | Enrich `dim_artist` with MBIDs from MusicBrainz | Manual (auto-trigger planned — SCRUM-97) | Post-ingestion | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `spotify_matching/spotify_matcher_fixed.py` | Match artists against Spotify library for initial data load | Manual | One-off / as needed | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `spotify_matching/merge_spotify_data.py` | Merge Spotify match output files | Manual | One-off | — |
| `tm_enrichment/tm_enrichment.py` | Enrich `fact_shows` with Ticketmaster URLs and venue lat/long | Manual | Per city, after import | `TM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
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

**Note:** `--city`, `--state`, `--country` are all required. Run `auto_update_venue_status()` in Supabase after each import.

---

### `fetch_setlist_api.py`
Fetches raw show data from the setlist.fm API. Supports resume across sessions.

```bash
# Full historical fetch for a new city
python scripts/fetch_setlist_api.py --city Toronto --state ON --country CA \
  --start-year 1900 --end-year 2025

# Resume an interrupted fetch
python scripts/fetch_setlist_api.py --city Toronto --state ON --country CA \
  --start-year 1980 --end-year 2021 --resume

# Daily delta (current year only)
python scripts/fetch_setlist_api.py --city Vancouver --state BC --country CA --no-interactive
```

**Rate limit:** 2 req/sec, 1,440 req/day (basic tier). Resets ~11:19 AM PST.  
**Output:** Airport-code named CSV files (e.g. `yvr_2026-06-09.csv`).  
**GitHub Actions:** Planned at 19:30 UTC daily (SCRUM-95), Vancouver-only until rate limit upgrade confirmed.

---

### `find_secondary_cities.py`
Discovers cities in a province/state that exceed a show volume threshold.

```bash
# BC province-wide
python scripts/find_secondary_cities.py --state BC --country CA

# Ontario province-wide
python scripts/find_secondary_cities.py --state ON --country CA
```

**Threshold:** >500 shows = ingestion candidate; 100–500 = manual review.

---

### `musicbrainz_enrich.py`
Looks up MBIDs for artists in `dim_artist` and writes them back to Supabase.

```bash
# Enrich all artists missing an MBID
python scripts/musicbrainz_enrich.py --new-only

# Full re-run (all artists)
python scripts/musicbrainz_enrich.py
```

**Note:** Auto-trigger after new artist ingestion is planned (SCRUM-97).

---

### `tm_enrichment/tm_enrichment.py`
Matches upcoming shows to Ticketmaster events and writes `ticketmaster_url` to `fact_shows`. Also planned to capture `latitude`/`longitude` for `dim_venue` (SCRUM-98).

```bash
cd scripts/tm_enrichment
python tm_enrichment.py
```

Requires `dim_venue.tm_venue_id` to be populated for each venue first.

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
| `SUPABASE_SERVICE_KEY` | All Supabase-connected scripts |
| `TM_API_KEY` | `tm_enrichment.py` |
| `SPOTIFY_CLIENT_ID` | `spotify_matcher_fixed.py` |
| `SPOTIFY_CLIENT_SECRET` | `spotify_matcher_fixed.py` |

---

## Recommended run order for a new city

1. `fetch_setlist_api.py` — pull historical data (multi-day)
2. `refresh_shows.py --dry-run` — preview alias candidates
3. `refresh_shows.py` — interactive alias review + live insert
4. `musicbrainz_enrich.py --new-only` — enrich new artists
5. `tm_enrichment.py` — enrich upcoming shows with TM URLs
6. Run `SELECT auto_update_venue_status();` in Supabase SQL editor
