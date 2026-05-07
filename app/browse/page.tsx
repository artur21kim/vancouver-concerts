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
  const page     = getString(params.page)     || '1'
  const sort     = getString(params.sort)     || 'date'
  const dir      = getString(params.dir)      || 'desc'

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

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

  // Parallel: shows, stats, venues, and artist name lookup (if needed)
  const [showsRes, statsRes, venuesRes, artistRes, festivalsRes] = await Promise.all([
    supabase.rpc('get_shows_paged', {
      ...rpcBase,
      p_sort:     sort,
      p_dir:      dir,
      p_page:     parseInt(page),
      p_per_page: SHOWS_PER_PAGE,
    }),
    supabase.rpc('get_shows_stats', rpcBase),
    supabase
      .from('dim_venue')
      .select('venue_id, venue_name, capacity, capacity_category, status, other_names')
      .order('venue_name')
      .then(r => r.data || []),
    artistId
      ? supabase
          .from('dim_artist')
          .select('artist_id, artist_name')
          .eq('artist_id', parseInt(artistId))
          .single()
          .then(r => r.data)
      : Promise.resolve(null),
    supabase
      .from('fact_shows')
      .select('festival_name')
      .not('festival_name', 'is', null)
      .neq('festival_name', '')
      .order('festival_name')
      .then(r => {
        const unique = Array.from(new Set((r.data || []).map((x: any) => x.festival_name as string))).sort()
        return unique.map(f => ({ value: f, label: f }))
      }),
  ])

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
      venues={venuesRes as any}
      initialParams={{
        decade, year, month, artistId, venueId,
        showType, festival, capacity, status,
        page: parseInt(page), sort, dir,
      }}
      initialArtistName={artistRes?.artist_name ?? null}
      initialFestivals={festivalsRes as any}
    />
  )
}
