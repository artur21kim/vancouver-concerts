# Grooveprint Data Pipeline

**Last updated:** June 9, 2026  
**Maintainer:** Artur Kim  
**Primary data source:** [setlist.fm](https://www.setlist.fm) (CC BY-NC-SA 4.0)

---

## Overview

Grooveprint's concert database is built from two data sources stitched together:

| Source | What it provides | Script |
|---|---|---|
| setlist.fm (via Octoparse) | Show history: artist, venue, date, tour name | `scripts/refresh_shows.py` |
| Ticketmaster Discovery API | Event URLs for future shows | `scripts/tm_enrichment.py` |

All data lands in three tables in Supabase:

```
dim_artist   ← one row per artist
dim_venue    ← one row per venue
fact_shows   ← one row per artist-show (multi-artist bills = multiple rows)
```

The Excel working file (`grooveprint-data.xlsx`) mirrors this star schema across three tabs and is used for manual review and enrichment before Supabase syncs.

---

## Data Sources

### setlist.fm

- **Licence:** CC BY-NC-SA 4.0 — attribution required in the app footer; monetization triggers the NC clause (legal review needed before scaling)
- **Scraped with:** Octoparse (cloud scraper)
- **Coverage:** Vancouver, BC, Canada — 1900 to present
- **Volume:** ~36,000+ shows as of June 2026
- **Dedup key:** `setlist_url` — globally unique per artist-show on setlist.fm

### Ticketmaster Discovery API

- **Provides:** `ticketmaster_url` for upcoming shows only
- **Matched by:** venue ID + artist name + date
- **Enrichment script:** `scripts/tm_enrichment.py`
- **Rate limit:** 5 req/sec (script runs at 4 req/sec)
- **Scope:** only venues with `tm_venue_id` populated in `dim_venue`

---

## End-to-End Workflow

```
1. Octoparse scrape
       ↓
2. Excel review (optional)
       ↓
3. scripts/refresh_shows.py  →  Supabase (fact_shows, dim_artist, dim_venue)
       ↓
4. scripts/tm_enrichment.py  →  Supabase (fact_shows.ticketmaster_url)
       ↓
5. Verify in Excel / Supabase dashboard
```

---

## Step-by-Step: Running a Refresh

### Prerequisites

```bash
pip install requests python-dotenv openpyxl
```

Create a `.env` file in the repo root (or export to shell):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key   # never use NEXT_PUBLIC_ prefix
TM_API_KEY=your-ticketmaster-consumer-key    # for tm_enrichment.py only
```

---

### Step 1: Octoparse Scrape

Configure your Octoparse task to target `https://www.setlist.fm/search?query=vancouver` with the following field mapping:

| Octoparse field | setlist.fm element | Example value |
|---|---|---|
| `Field1` | Show title | `Rush at Rogers Arena, Vancouver, BC, Canada` |
| `Field` | Page URL | `https://www.setlist.fm/setlist/rush/2026/...html` |
| `month` | Date — month | `DEC` |
| `day` | Date — day | `17` |
| `Year` | Date — year | `2026` |
| `details` | Artist name | `Rush` |
| `details2` | Tour/venue label block | `Tour:\nFifty Something Tour,\n` |
| `details4` | Tour name or venue string | `Fifty Something Tour` |
| `details6` | Venue string (when tour present) | `Rogers Arena, Vancouver, BC, Canada` |

**`details2` has two patterns depending on whether a tour is listed:**

- `"Tour: <name>"` → `details4` = tour name, `details6` = full venue string
- `"Venue: <string>"` → `details4` = full venue string, `details6` = empty (support act with no recorded tour)

**Export format:** CSV (UTF-8) or XLSX. Save as UTF-8 to avoid encoding issues with special characters (e.g., Scandinavian artist names).

**File naming convention:** Save exports as `exports/{AIRPORT_CODE}_{YYYY-MM-DD}.csv` — e.g. `exports/yvr_2026-06-09.csv`. Airport codes: `yvr` = Vancouver, `sea` = Seattle, `yyz` = Toronto, `yul` = Montreal, `aus` = Austin, `bna` = Nashville, `lax` = LA, `jfk` = NYC.

**Scrape window:** Overlap by 2–3 weeks with the previous scrape. The dedup script handles duplicates automatically.

---

### Step 2: Dry-Run Preview

Always run `--dry-run` first to see what will change without writing anything:

```bash
python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --dry-run
```

Sample output:
```
================================================================
Grooveprint — Show Refresh
Started:  2026-06-09 14:32:01
Input:    exports/yvr_2026-06-09.csv
City:     Vancouver
Mode:     DRY RUN (no DB writes)
================================================================

Loading input file…
  1088 raw rows read

Parsing rows…
  1086 parsed   |   2 skipped (parse errors)

Loading Supabase snapshot…
  Existing shows … 35,841
  Existing artists … 12,654
  Existing venues … 487

Classifying…
  842 duplicates  |  244 new  |  7 new artists  |  2 new venues

New shows (first 20 of 244):
  2026-12-17  Rush                              Rogers Arena
  2026-12-15  Rush                              Rogers Arena
  ...

New artists (7):
  + Devon Again
  + Buck Meek
  ...

New venues (2):
  + The Key
  + Hollywood Theatre

Fuzzy suggestions — artist (would prompt in live run):
  'Aversions'  →  'Aversion'  [94%]
```

Review the preview. If new artists or venues look wrong (encoding issues, scraped garbage, unexpected fuzzy matches), fix the CSV or resolve aliases in the live run before applying.

---

### Step 3: Apply

```bash
python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv
```

The script will:
1. Create any new `dim_artist` rows (artist_name only; spotify fields left null for manual enrichment later)
2. Create any new `dim_venue` rows (venue_name + city + status='Open'; capacity and TM fields left null)
3. Insert new `fact_shows` rows with `show_type='music'` as the default

**Alias review (interactive, fires automatically)**

When the script finds a near-match for a venue or artist that isn't an exact match or known alias, it pauses before applying changes:

```
⚠️  Artist alias review — 2 to verify
    A = same entity (alias)  |  N = different (new)  |  S = skip  |  K = keep all as new
────────────────────────────────────────────────────────────────
1/2  'Aversions'  →  'Aversion'  [94% similarity]
       2026-05-23  @ Rickshaw Theatre
  [A]lias / [N]ew / [S]kip / [K]eep all as new:
```

| Key | Action |
|---|---|
| `A` Alias | Same entity — writes alias to DB immediately; show inserts this run |
| `N` New | Different entity — auto-creates as new artist/venue this run |
| `S` Skip | Uncertain — holds this show for the next run |
| `K` Keep all | Batch-decides all remaining as New without further prompts |

The date and context (venue for artist reviews, artist for venue reviews) are shown to help with the decision. Use dry-run output and setlist.fm to research ambiguous cases before running live.

**If you exit mid-review (Ctrl+C):**
- Any `A` aliases already chosen are durably written to the DB — they auto-resolve next run (no review needed)
- Unreviewed shows are simply deferred — no data is lost or corrupted
- The apply phase uses `ON CONFLICT DO NOTHING`, so reruns are always safe

**Non-interactive mode** (for future automation):

```bash
python scripts/refresh_shows.py --input exports/yvr_2026-06-09.csv --no-interactive
```

Fuzzy suggestions are reported in the summary but don't block execution. Intended for scheduled jobs — not recommended for manual runs where alias decisions improve data quality.

**show_type exceptions** — set manually in Supabase or via SQL after import:
- Comedy shows: `UPDATE fact_shows SET show_type = 'comedy' WHERE ...`
- Festival shows: `UPDATE fact_shows SET show_type = 'festival', festival_name = '...' WHERE ...`

---

### Step 4: Ticketmaster URL Enrichment (upcoming shows only)

After a data refresh, run TM enrichment to add ticket links for future shows:

```bash
python scripts/tm_enrichment.py
```

This script queries `dim_venue` for rows with `tm_venue_id` populated, fetches upcoming events from the TM Discovery API, matches by artist name + date, and writes `ticketmaster_url` to `fact_shows`.

To add a new venue's TM mapping: update `dim_venue` with the venue's `tm_venue_id` (found via the TM venue search endpoint or the TM URL in your browser).

---

### Step 5: Verify

After applying, verify counts in the Supabase dashboard or run:

```sql
SELECT COUNT(*) FROM fact_shows;
SELECT COUNT(*) FROM dim_artist WHERE spotify_artist_id IS NULL;  -- new artists needing Spotify enrichment
SELECT COUNT(*) FROM dim_venue WHERE capacity IS NULL;            -- new venues needing capacity
```

---

## Schema Reference

### `fact_shows`

One row per artist-show. Multi-artist bills (same venue + date) produce multiple rows.

| Column | Type | Description |
|---|---|---|
| `show_id` | `bigint` | Auto-generated PK |
| `date` | `date` | Show date (local Vancouver time) |
| `artist_id` | `int` | FK → `dim_artist` |
| `venue_id` | `int` | FK → `dim_venue` |
| `setlist_url` | `text` | UNIQUE. Source URL from setlist.fm — dedup key |
| `show_type` | `text` | `'music'` (default) \| `'comedy'` \| `'festival'` |
| `festival_name` | `text` | Populated for festival shows |
| `ticketmaster_url` | `text` | Added by `tm_enrichment.py` — future shows only |

### `dim_artist`

One row per artist.

| Column | Type | Description |
|---|---|---|
| `artist_id` | `int` | Auto-generated PK |
| `artist_name` | `text` | Canonical name from setlist.fm |
| `spotify_artist_id` | `text` | Spotify URI — enriched manually or via Spotify API |
| `review_status` | `text` | Manual review flag |
| `monthly_listeners` | `int4` | Populated via Spotify API batch job |
| `listeners_updated` | `date` | Last Spotify listener count update |
| `peak_listeners` | `int4` | Historical peak |
| `first_artist_show` | `date` | Derived: earliest show in `fact_shows` |
| `last_artist_show` | `date` | Derived: latest show in `fact_shows` |
| `show_count` | `int` | Derived: count of rows in `fact_shows` |

> **New artists** created by `refresh_shows.py` have only `artist_name` populated. `spotify_artist_id` and listener data require manual enrichment or a separate Spotify batch job.

### `dim_venue`

One row per physical venue.

| Column | Type | Description |
|---|---|---|
| `venue_id` | `int` | Auto-generated PK |
| `venue_name` | `text` | Canonical name (no city suffix) |
| `city` | `text` | e.g. `'Vancouver'` |
| `tm_venue_id` | `text` | Ticketmaster venue ID — required for TM enrichment |
| `tm_url` | `text` | Ticketmaster venue page |
| `latitude` | `float` | Manual or from TM |
| `longitude` | `float` | Manual or from TM |
| `timezone` | `text` | e.g. `'America/Vancouver'` |
| `capacity` | `int4` | Seating capacity — **manual entry** |
| `capacity_category` | `text` | `'Small (<500)'` \| `'Medium (500-1.5K)'` \| `'Large (1.5K-10K)'` \| `'X-Large (10K+)'` |
| `status` | `text` | `'Open'` \| `'Closed'` |
| `first_venue_show` | `date` | Derived |
| `last_venue_show` | `date` | Derived |
| `show_count` | `int` | Derived |

> **Capacity** is manually populated. It powers venue-size filtering and chart colors throughout the app. For city expansion, aim to populate capacity for the top 50–100 venues — it's optional but significantly improves the UX for power users. Unknown capacity shows as the grey `?` badge and is still fully functional.

### `venue_aliases`

Maps setlist.fm venue name variants (per city) to canonical `dim_venue` rows. Written interactively during `refresh_shows.py` runs when fuzzy suggestions are resolved as `A` (Alias).

| Column | Type | Description |
|---|---|---|
| `setlist_name` | `text` | Venue name as it appears on setlist.fm |
| `city` | `text` | City — part of composite PK for city expansion safety |
| `venue_id` | `int` | FK → `dim_venue` |
| `created_at` | `timestamptz` | — |

**Primary key:** `(setlist_name, city)`

### `artist_aliases`

Maps setlist.fm artist name variants to canonical `dim_artist` rows. Artists are global — no city dimension.

| Column | Type | Description |
|---|---|---|
| `setlist_name` | `text` | Artist name as it appears on setlist.fm (PK) |
| `artist_id` | `int` | FK → `dim_artist` |
| `created_at` | `timestamptz` | — |

---

## Deduplication Strategy

**Key:** `setlist_url` is unique per artist-show on setlist.fm and serves as the canonical dedup key.

- `refresh_shows.py` loads all existing `setlist_url` values from `fact_shows` at startup (paginated, handles 36k+ rows)
- Any input row whose URL already exists in the DB is skipped and counted as a "duplicate"
- The script uses PostgreSQL `ON CONFLICT DO NOTHING` for the final INSERT, making reruns of the same input file fully idempotent
- **Overlapping scrape windows are safe** — scrape generously rather than trying to track exact cutoff dates

**What doesn't change on refresh:** artist_name and venue_name in existing fact_shows rows are never updated. If setlist.fm renames an artist, the historical rows keep the old name. This is intentional — it preserves the data as it existed at scrape time.

### Venue & Artist Resolution Chain

Before creating a new `dim_venue` or `dim_artist` row, the script resolves names in priority order:

**Venue** (fuzzy threshold: 82%)
1. Exact match → `dim_venue.venue_name`
2. Exact match → `dim_venue.other_names` (comma-separated historical names, e.g. "GM Place" resolves to Rogers Arena silently)
3. Exact match → `venue_aliases` table (setlist.fm naming discrepancies, scoped per city)
4. Fuzzy match → interactive A/N/S/K review (or reported in non-interactive mode)
5. No match → auto-create (`status='Open'`, city extracted from venue string)

**Artist** (fuzzy threshold: 85% — stricter to protect Spotify matching)
1. Exact match → `dim_artist.artist_name`
2. Exact match → `artist_aliases` table
3. Fuzzy match → interactive A/N/S/K review (or reported in non-interactive mode)
4. No match → auto-create (`review_status='unverified'`)

Artist fuzzy threshold is stricter than venue because a wrong link corrupts the Spotify library matching pipeline.

---

## City Expansion

### Sequencing

```
Vancouver (current) → Seattle → Toronto → Montreal → Austin / Nashville → LA / NYC
```

Seattle and Toronto are the natural first expansion cities — strong concert cultures and data density on setlist.fm.

### Adding a New City

1. **Octoparse:** duplicate the Vancouver task, change the search query to the new city (e.g., `seattle, wa, united states`)
2. **Run refresh:** `python scripts/refresh_shows.py --input exports/sea_2026-06-09.csv` — city is extracted automatically from the venue string (e.g., "Showbox, Seattle, WA, United States"), so no `--city` flag is required
3. **dim_venue enrichment:** for each new venue, manually populate `capacity`, `tm_venue_id`, and `latitude/longitude` (the top 50–100 venues by show count cover the majority of traffic)
4. **TM enrichment:** add `tm_venue_id` values to `dim_venue`, then run `tm_enrichment.py`
5. **App config:** city filter/selector UI will need to be updated to expose the new city (tracked under the City Expansion epic)

### Venue capacity for new cities

For Vancouver, capacity was manually populated because local knowledge made it fast. For expansion cities, prioritize the top venues by `show_count` — the long tail of small venues contributes little to the filtering experience and can be filled in over time.

---

## Known Manual Steps

These steps are not yet automated and require human judgment:

| Step | Description |
|---|---|
| `spotify_artist_id` enrichment | Match new `dim_artist` rows to Spotify artist URIs. Currently done manually via Spotify search or a one-off Python script against the Spotify API. |
| `monthly_listeners` refresh | Listener counts stale after ~90 days. No scheduled refresh job yet. |
| `show_type` overrides | Comedy and festival shows scraped as `'music'`. Must be corrected via SQL after import. |
| `festival_name` | Not parsed from setlist.fm tour names. Set manually for known festivals. |
| `dim_venue` capacity | Manually populated from venue websites or Ticketmaster listings. |
| `tm_venue_id` mapping | Must be looked up in TM's venue search and added to `dim_venue` before TM enrichment runs. |
| Derived aggregate columns | `first_artist_show`, `last_artist_show`, `show_count` etc. are denormalized columns. Not updated automatically on ingestion — refresh via SQL or scheduled job (future work). |

---

## Affiliate & Monetization Notes

- **Ticketmaster affiliate:** application paused at business categorization step. `ticketmaster_url` in `fact_shows` is ready when the affiliate program is approved.
- **Vivid Seats:** 6% commission, parallel option to TM.
- **setlist.fm CC BY-NC-SA 4.0:** the NC clause is triggered by monetization. Legal review is required before activating any affiliate links or other revenue features.
