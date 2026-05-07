import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SHOWS_PER_PAGE = 50

function getDecadeRange(decade: string): { from: number; to: number } | null {
  if (decade === 'all') return null
  const start = parseInt(decade.replace('s', ''))
  if (isNaN(start)) return null
  return { from: start, to: start + 9 }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const decade    = searchParams.get('decade') || '2020s'
  const year      = searchParams.get('year')
  const month     = searchParams.get('month')
  const artistId  = searchParams.get('artist_id')
  const venueId   = searchParams.get('venue_id')
  const showType  = searchParams.get('show_type')
  const festival  = searchParams.get('festival')
  const capacity  = searchParams.get('capacity')
  const status    = searchParams.get('status')
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const sortDir   = searchParams.get('dir') === 'asc'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // ── Date range ────────────────────────────────────────────────────────────
  let yearFrom: number | null = null
  let yearTo:   number | null = null

  if (year) {
    yearFrom = parseInt(year)
    yearTo   = parseInt(year)
  } else {
    const range = getDecadeRange(decade)
    if (range) { yearFrom = range.from; yearTo = range.to }
  }

  let monthFrom: string | null = null
  let monthTo:   string | null = null
  if (month && yearFrom !== null) {
    const m = parseInt(month).toString().padStart(2, '0')
    monthFrom = `${yearFrom}-${m}-01`
    // Last day of month: use next month minus 1 day approach via lte on day 31
    monthTo   = `${yearFrom}-${m}-31`
  }

  const capLabelMap: Record<string, string> = {
    small:  'Small',
    medium: 'Medium',
    large:  'Large',
    xlarge: 'X-Large',
  }

  // Helper to apply common date/dimension filters to any query
  function applyFilters(q: any) {
    if (monthFrom) {
      q = q.gte('date', monthFrom).lte('date', monthTo)
    } else {
      if (yearFrom !== null) q = q.gte('date', `${yearFrom}-01-01`)
      if (yearTo   !== null) q = q.lte('date', `${yearTo}-12-31`)
    }
    if (artistId) q = q.eq('artist_id', parseInt(artistId))
    if (venueId)  q = q.eq('venue_id',  parseInt(venueId))
    if (showType) {
      if (showType === 'music') q = q.or('show_type.eq.music,show_type.is.null')
      else q = q.eq('show_type', showType)
    }
    if (festival) q = q.eq('festival_name', festival)
    return q
  }

  // ── Main paginated data query ─────────────────────────────────────────────
  let dataQuery = supabase
    .from('fact_shows')
    .select(`
      show_id,
      date,
      setlist_url,
      show_type,
      festival_name,
      artist_id,
      venue_id,
      dim_artist!inner (
        artist_id,
        artist_name,
        monthly_listeners,
        spotify_artist_id
      ),
      dim_venue!inner (
        venue_id,
        venue_name,
        capacity,
        capacity_category,
        status,
        other_names
      )
    `, { count: 'exact' })

  dataQuery = applyFilters(dataQuery)

  if (capacity && capacity !== 'all') {
    if (capacity === 'unknown') {
      dataQuery = dataQuery.is('dim_venue.capacity', null)
    } else {
      const label = capLabelMap[capacity]
      if (label) dataQuery = dataQuery.ilike('dim_venue.capacity_category', `%${label}%`)
    }
  }
  if (status && status !== 'all') {
    dataQuery = dataQuery.ilike('dim_venue.status', status)
  }

  dataQuery = dataQuery
    .order('date', { ascending: sortDir })
    .range((page - 1) * SHOWS_PER_PAGE, page * SHOWS_PER_PAGE - 1)

  const { data, error, count } = await dataQuery

  if (error) {
    console.error('Browse shows API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // ── Transform ─────────────────────────────────────────────────────────────
  const shows = (data || []).map((row: any) => {
    const artist = Array.isArray(row.dim_artist) ? row.dim_artist[0] : row.dim_artist
    const venue  = Array.isArray(row.dim_venue)  ? row.dim_venue[0]  : row.dim_venue
    return {
      show_id:           row.show_id,
      date:              row.date,
      setlist_url:       row.setlist_url,
      show_type:         row.show_type,
      festival_name:     row.festival_name,
      artist_id:         row.artist_id,
      venue_id:          row.venue_id,
      artist_name:       artist?.artist_name       ?? '',
      monthly_listeners: artist?.monthly_listeners ?? null,
      spotify_artist_id: artist?.spotify_artist_id ?? null,
      venue_name:        venue?.venue_name          ?? '',
      capacity:          venue?.capacity            ?? null,
      capacity_category: venue?.capacity_category   ?? null,
      venue_status:      venue?.status              ?? null,
      other_names:       venue?.other_names         ?? null,
    }
  })

  // ── Stats query (lightweight — IDs + dates only, no pagination) ───────────
  // Separate query without capacity/status join filters (acceptable approximation)
  let statsQuery = supabase
    .from('fact_shows')
    .select('artist_id, venue_id, date')
    .order('date', { ascending: true })

  statsQuery = applyFilters(statsQuery)

  const { data: statsData } = await statsQuery

  let uniqueArtists = 0
  let uniqueVenues  = 0
  let firstShow:  string | null = null
  let lastShow:   string | null = null

  if (statsData && statsData.length > 0) {
    uniqueArtists = new Set(statsData.map((r: any) => r.artist_id)).size
    uniqueVenues  = new Set(statsData.map((r: any) => r.venue_id)).size
    firstShow     = statsData[0].date
    lastShow      = statsData[statsData.length - 1].date
  }

  return NextResponse.json({
    shows,
    total:       count ?? 0,
    page,
    per_page:    SHOWS_PER_PAGE,
    total_pages: Math.ceil((count ?? 0) / SHOWS_PER_PAGE),
    stats: {
      total_shows:    count ?? 0,
      unique_artists: uniqueArtists,
      unique_venues:  uniqueVenues,
      first_show:     firstShow,
      last_show:      lastShow,
    },
  })
}
