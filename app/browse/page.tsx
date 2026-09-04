import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import BrowseClient from './BrowseClient'

export const dynamic = 'force-dynamic'
export const maxDuration = 30 // GP-208: 2020s has ~450k shows; stats query needs >10s default

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getString(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0]
  return val
}

const SHOWS_PER_PAGE = 50

export default async function BrowsePage({ searchParams }: PageProps) {
  const params = await searchParams

  const decade   = getString(params.decade)   || '2020s'
  const year     = getString(params.year)
  const month    = getString(params.month)
  const artistId = getString(params.artist_id)
  const venueId  = getString(params.venue_id)
  const showType = getString(params.show_type)
  const festival = getString(params.festival)
  const capacity = getString(params.capacity)
  const status   = getString(params.status)
  const state    = getString(params.state)
  const page     = getString(params.page)     || '1'
  const sort     = getString(params.sort)     || 'date'
  const dir      = getString(params.dir)      || 'desc'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // GP-127: Fetch city preference for logged-in users; anon users see all cities
  let preferredCities: string[] | null = null
  try {
    const serverSupabase = await createServerClient()
    const { data: { user } } = await serverSupabase.auth.getUser()
    if (user) {
      const { data: prefData } = await serverSupabase
        .from('user_profiles')
        .select('preferred_cities')
        .eq('user_id', user.id)
        .single()
      preferredCities = (prefData as any)?.preferred_cities ?? null
    }
  } catch {
    // Non-fatal — fall back to showing all cities
  }

  const rpcBase = {
    p_decade:            decade,
    p_year:              year     ? parseInt(year)     : null,
    p_month:             month    ? parseInt(month)    : null,
    p_artist_id:         artistId ? parseInt(artistId) : null,
    p_venue_id:          venueId  ? parseInt(venueId)  : null,
    p_show_type:         showType || null,
    p_festival:          festival || null,
    p_capacity:          (capacity && capacity !== 'all') ? capacity : null,
    p_status:            (status   && status   !== 'all') ? status   : null,
    p_state:             state    || null,
    p_preferred_cities:  preferredCities,
  }

  // GP-208: Parallel fetches — venues blob removed entirely.
  // - total_count window function removed from get_shows_paged; use get_shows_stats for pagination total.
  // - city/state/country now embedded in get_shows_paged rows via RPC join.
  // - get_browse_locations() replaces 34k-row dim_venue fetch for Location dropdown.
  // - get_browse_festivals() replaces full fact_shows scan for festival names.
  const [showsRes, statsRes, artistRes, festivalsRes, locationsRes, venueNameRes] = await Promise.all([
    supabase.rpc('get_shows_paged', {
      ...rpcBase,
      p_sort:     sort,
      p_dir:      dir,
      p_page:     parseInt(page),
      p_per_page: SHOWS_PER_PAGE,
    }),
    supabase.rpc('get_shows_stats', rpcBase),
    artistId
      ? supabase
          .from('dim_artist')
          .select('artist_id, artist_name')
          .eq('artist_id', parseInt(artistId))
          .single()
          .then(r => r.data)
      : Promise.resolve(null),
    // GP-208: lightweight DISTINCT query via RPC — replaces full fact_shows scan
    supabase.rpc('get_browse_festivals').then(r =>
      (r.data || []).map((x: any) => ({ value: x.festival_name as string, label: x.festival_name as string }))
    ),
    // GP-208: distinct (state, country) pairs — replaces 34k-row dim_venue fetch
    supabase.rpc('get_browse_locations').then(r => r.data || []),
    // Venue name lookup for initial URL filter (single row, only when venueId is set)
    venueId
      ? supabase
          .from('dim_venue')
          .select('venue_id, venue_name')
          .eq('venue_id', parseInt(venueId))
          .single()
          .then(r => r.data)
      : Promise.resolve(null),
  ])

  const rows     = showsRes.data || []
  const statsRow = statsRes.data?.[0]
  // GP-208: total now from get_shows_stats (COUNT(*) OVER() window function removed from shows RPC)
  const totalCount = statsRow ? Number(statsRow.total_shows) : 0

  const shows = rows.map((row: any) => ({
    show_id:           row.show_id,
    date:              row.date,
    setlist_url:       row.setlist_url,
    show_type:         row.show_type,
    festival_name:     row.festival_name,
    tour_name:         row.tour_name         ?? null,
    artist_id:         row.artist_id,
    venue_id:          row.venue_id,
    artist_name:       row.artist_name        ?? '',
    monthly_listeners: row.monthly_listeners  ?? null,
    spotify_artist_id: row.spotify_artist_id  ?? null,
    venue_name:        row.venue_name          ?? '',
    capacity:          row.capacity            ?? null,
    capacity_category: row.capacity_category   ?? null,
    venue_status:      row.venue_status        ?? null,
    other_names:       row.other_names         ?? null,
    ticketmaster_url:  row.ticketmaster_url     ?? null,
    // GP-208: city/state/country now come directly from the RPC join
    city:              row.city               ?? null,
    state:             row.state              ?? null,
    country:           row.country            ?? null,
  }))

  const stats = {
    total_shows:    statsRow ? Number(statsRow.total_shows)    : 0,
    unique_artists: statsRow ? Number(statsRow.unique_artists) : 0,
    unique_venues:  statsRow ? Number(statsRow.unique_venues)  : 0,
    first_show:     statsRow?.first_show  ?? null,
    last_show:      statsRow?.last_show   ?? null,
  }

  return (
    <BrowseClient
      initialShows={shows}
      initialTotal={totalCount}
      initialStats={stats}
      initialTotalPages={Math.ceil(totalCount / SHOWS_PER_PAGE)}
      locations={locationsRes as any}
      initialParams={{
        decade, year, month, artistId, venueId,
        showType, festival, capacity, status, state,
        page: parseInt(page), sort, dir,
      }}
      initialArtistName={artistRes?.artist_name ?? null}
      initialVenueName={(venueNameRes as any)?.venue_name ?? null}
      initialFestivals={festivalsRes as any}
    />
  )
}
