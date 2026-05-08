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
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const sort     = searchParams.get('sort') || 'date'
  const dir      = searchParams.get('dir')  || 'desc'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Shared RPC params
  const rpcBase = {
    p_decade:    decade,
    p_year:      year     ? parseInt(year)     : null,
    p_month:     month    ? parseInt(month)    : null,
    p_artist_id: artistId ? parseInt(artistId) : null,
    p_venue_id:  venueId  ? parseInt(venueId)  : null,
    p_show_type: showType || null,
    p_festival:  festival || null,
    p_capacity:  (capacity && capacity !== 'all') ? capacity : null,
    p_status:    (status   && status   !== 'all') ? status   : null,
  }

  // Run shows + stats in parallel
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

  const rows       = showsRes.data || []
  const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0
  const statsRow   = statsRes.data?.[0]

  const shows = rows.map((row: any) => ({
    show_id:           row.show_id,
    date:              row.date,
    setlist_url:       row.setlist_url,
    show_type:         row.show_type,
    festival_name:     row.festival_name,
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
