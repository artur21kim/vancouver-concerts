import { createClient } from '@supabase/supabase-js'
import BrowseClient from './BrowseClient'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function getString(val: string | string[] | undefined): string | undefined {
  if (Array.isArray(val)) return val[0]
  return val
}

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
  const page     = getString(params.page)     || '1'
  const sort     = getString(params.sort)     || 'date'
  const dir      = getString(params.dir)      || 'desc'

  // Build query string to hit our new API route
  const qs = new URLSearchParams()
  qs.set('decade', decade)
  if (year)     qs.set('year',      year)
  if (month)    qs.set('month',     month)
  if (artistId) qs.set('artist_id', artistId)
  if (venueId)  qs.set('venue_id',  venueId)
  if (showType) qs.set('show_type', showType)
  if (festival) qs.set('festival',  festival)
  if (capacity) qs.set('capacity',  capacity)
  if (status)   qs.set('status',    status)
  qs.set('page', page)
  qs.set('sort', sort)
  qs.set('dir',  dir)

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Run initial shows fetch and venues fetch in parallel
  const [showsResult, venuesResult] = await Promise.all([
    // Shows: re-use same logic from the API route inline to avoid HTTP roundtrip
    fetchShowsServer(supabase, {
      decade, year, month, artistId, venueId,
      showType, festival, capacity, status,
      page: parseInt(page), sort, dir,
    }),
    // Venues: full list, small dataset
    supabase
      .from('dim_venue')
      .select('venue_id, venue_name, capacity, capacity_category, status, other_names')
      .order('venue_name')
      .then(r => r.data || []),
  ])

  return (
    <BrowseClient
      initialShows={showsResult.shows}
      initialTotal={showsResult.total}
      initialStats={showsResult.stats}
      initialTotalPages={showsResult.total_pages}
      venues={venuesResult}
      initialParams={{
        decade, year, month, artistId, venueId,
        showType, festival, capacity, status,
        page: parseInt(page), sort, dir,
      }}
    />
  )
}

// ── Inline server fetch (avoids HTTP roundtrip on first load) ─────────────
const SHOWS_PER_PAGE = 50

function getDecadeRange(decade: string): { from: number; to: number } | null {
  if (decade === 'all') return null
  const start = parseInt(decade.replace('s', ''))
  if (isNaN(start)) return null
  return { from: start, to: start + 9 }
}

async function fetchShowsServer(
  supabase: ReturnType<typeof createClient>,
  p: {
    decade: string; year?: string; month?: string
    artistId?: string; venueId?: string; showType?: string
    festival?: string; capacity?: string; status?: string
    page: number; sort: string; dir: string
  }
) {
  let yearFrom: number | null = null
  let yearTo:   number | null = null

  if (p.year) {
    yearFrom = parseInt(p.year)
    yearTo   = parseInt(p.year)
  } else {
    const range = getDecadeRange(p.decade)
    if (range) { yearFrom = range.from; yearTo = range.to }
  }

  let monthFrom: string | null = null
  let monthTo:   string | null = null
  if (p.month && yearFrom !== null) {
    const m = parseInt(p.month).toString().padStart(2, '0')
    monthFrom = `${yearFrom}-${m}-01`
    monthTo   = `${yearFrom}-${m}-31`
  }

  const capLabelMap: Record<string, string> = {
    small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large',
  }

  function applyFilters(q: any) {
    if (monthFrom) {
      q = q.gte('date', monthFrom).lte('date', monthTo)
    } else {
      if (yearFrom !== null) q = q.gte('date', `${yearFrom}-01-01`)
      if (yearTo   !== null) q = q.lte('date', `${yearTo}-12-31`)
    }
    if (p.artistId) q = q.eq('artist_id', parseInt(p.artistId))
    if (p.venueId)  q = q.eq('venue_id',  parseInt(p.venueId))
    if (p.showType) {
      if (p.showType === 'music') q = q.or('show_type.eq.music,show_type.is.null')
      else q = q.eq('show_type', p.showType)
    }
    if (p.festival) q = q.eq('festival_name', p.festival)
    return q
  }

  const ascending = p.dir === 'asc'

  let dataQuery = supabase
    .from('fact_shows')
    .select(`
      show_id, date, setlist_url, show_type, festival_name, artist_id, venue_id,
      dim_artist!inner ( artist_id, artist_name, monthly_listeners, spotify_artist_id ),
      dim_venue!inner  ( venue_id, venue_name, capacity, capacity_category, status, other_names )
    `, { count: 'exact' })

  dataQuery = applyFilters(dataQuery)

  if (p.capacity && p.capacity !== 'all') {
    if (p.capacity === 'unknown') {
      dataQuery = dataQuery.is('dim_venue.capacity', null)
    } else {
      const label = capLabelMap[p.capacity]
      if (label) dataQuery = dataQuery.ilike('dim_venue.capacity_category', `%${label}%`)
    }
  }
  if (p.status && p.status !== 'all') {
    dataQuery = dataQuery.ilike('dim_venue.status', p.status)
  }

  dataQuery = dataQuery
    .order('date', { ascending })
    .range((p.page - 1) * SHOWS_PER_PAGE, p.page * SHOWS_PER_PAGE - 1)

  const { data, error, count } = await dataQuery

  if (error) {
    console.error('Browse page server fetch error:', error)
    return { shows: [], total: 0, total_pages: 0, stats: { total_shows: 0, unique_artists: 0, unique_venues: 0, first_show: null, last_show: null } }
  }

  const shows = (data || []).map((row: any) => {
    const artist = Array.isArray(row.dim_artist) ? row.dim_artist[0] : row.dim_artist
    const venue  = Array.isArray(row.dim_venue)  ? row.dim_venue[0]  : row.dim_venue
    return {
      show_id: row.show_id, date: row.date, setlist_url: row.setlist_url,
      show_type: row.show_type, festival_name: row.festival_name,
      artist_id: row.artist_id, venue_id: row.venue_id,
      artist_name: artist?.artist_name ?? '', monthly_listeners: artist?.monthly_listeners ?? null,
      spotify_artist_id: artist?.spotify_artist_id ?? null,
      venue_name: venue?.venue_name ?? '', capacity: venue?.capacity ?? null,
      capacity_category: venue?.capacity_category ?? null,
      venue_status: venue?.status ?? null, other_names: venue?.other_names ?? null,
    }
  })

  // Lightweight stats query
  let statsQuery = supabase
    .from('fact_shows')
    .select('artist_id, venue_id, date')
    .order('date', { ascending: true })
  statsQuery = applyFilters(statsQuery)
  const { data: statsData } = await statsQuery

  const uniqueArtists = statsData ? new Set(statsData.map((r: any) => r.artist_id)).size : 0
  const uniqueVenues  = statsData ? new Set(statsData.map((r: any) => r.venue_id)).size  : 0
  const firstShow     = statsData?.[0]?.date ?? null
  const lastShow      = statsData?.[statsData.length - 1]?.date ?? null

  return {
    shows,
    total:       count ?? 0,
    total_pages: Math.ceil((count ?? 0) / SHOWS_PER_PAGE),
    stats: { total_shows: count ?? 0, unique_artists: uniqueArtists, unique_venues: uniqueVenues, first_show: firstShow, last_show: lastShow },
  }
}
