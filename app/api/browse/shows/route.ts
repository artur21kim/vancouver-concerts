import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SHOWS_PER_PAGE = 50

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const decade   = searchParams.get('decade')   || '2020s'
  const year     = searchParams.get('year')
  const month    = searchParams.get('month')
  const artistId = searchParams.get('artist_id')
  const venueId  = searchParams.get('venue_id')
  const showType = searchParams.get('show_type')
  const festival = searchParams.get('festival')
  const capacity = searchParams.get('capacity')
  const status   = searchParams.get('status')
  const state    = searchParams.get('state')    // GP-151: province/state filter
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const sort     = searchParams.get('sort') || 'date'
  const dir      = searchParams.get('dir')  || 'desc'
  // GP-127: comma-separated city list passed from Browse page when user has a preference
  const citiesParam = searchParams.get('cities')
  const preferredCities = citiesParam ? citiesParam.split(',').filter(Boolean) : null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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

  // Run shows + stats in parallel.
  // total_count was removed from get_shows_paged (was a full-scan window function).
  // Pagination total now comes from get_shows_stats which runs concurrently anyway.
  const [showsRes, statsRes] = await Promise.all([
    supabase.rpc('get_shows_paged', {
      ...rpcBase,
      p_sort:     sort,
      p_dir:      dir,
      p_page:     page,
      p_per_page: SHOWS_PER_PAGE,
    }),
    supabase.rpc('get_shows_stats', rpcBase),
  ])

  if (showsRes.error) {
    console.error('Browse shows RPC error:', showsRes.error)
    return NextResponse.json({ error: showsRes.error.message }, { status: 500 })
  }
  if (statsRes.error) {
    console.error('Browse stats RPC error:', statsRes.error)
    return NextResponse.json({ error: statsRes.error.message }, { status: 500 })
  }

  const rows     = showsRes.data || []
  const statsRow = statsRes.data?.[0]
  // GP-208: total now from get_shows_stats (not the removed COUNT(*) OVER() window function)
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
    // GP-208: city/state/country now come directly from get_shows_paged RPC join
    city:              row.city               ?? null,
    state:             row.state              ?? null,
    country:           row.country            ?? null,
  }))

  return NextResponse.json({
    shows,
    total:       totalCount,
    page,
    per_page:    SHOWS_PER_PAGE,
    total_pages: Math.ceil(totalCount / SHOWS_PER_PAGE),
    stats: {
      total_shows:    statsRow ? Number(statsRow.total_shows)    : 0,
      unique_artists: statsRow ? Number(statsRow.unique_artists) : 0,
      unique_venues:  statsRow ? Number(statsRow.unique_venues)  : 0,
      first_show:     statsRow?.first_show  ?? null,
      last_show:      statsRow?.last_show   ?? null,
    },
  })
}
