import Navigation from './components/Navigation'
import { createClient } from '@supabase/supabase-js'
import HomeClient from './HomeClient'

export const revalidate = 600

export type TopArtist = {
  artist_id:    number
  artist_name:  string
  show_count:   number
  spotify_url:  string | null
  state_counts: { state: string; cnt: number }[]
}

export type TopVenue = {
  venue_id:          number
  venue_name:        string
  capacity_category: string | null
  capacity:          number | null
  show_count:        number
  city:              string | null
  state:             string | null
}

export type CityStats = {
  city:       string
  state:      string | null
  country:    string | null
  show_count: number
  latitude:   number | null
  longitude:  number | null
}

export type HomeStats = {
  total_shows:    number
  unique_artists: number
  unique_venues:  number
  min_date:       string | null
  max_date:       string | null
}

export type DrillStats = {
  total_shows:    number
  unique_artists: number
  unique_venues:  number
  unique_cities:  number
  min_year:       number | null
  max_year:       number | null
}

export default async function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [statsRes, artistsRes, venuesRes, cityStatsRes] = await Promise.all([
    supabase.rpc('get_home_stats'),
    supabase.rpc('get_home_top_artists', { p_decade: null, p_year: null, p_month: null }),
    supabase.rpc('get_home_top_venues',  { p_decade: null, p_year: null, p_month: null }),
    supabase.rpc('get_overview_city_stats'),
  ])

  if (statsRes.error)     console.error('home stats error:',      statsRes.error)
  if (artistsRes.error)   console.error('home artists error:',    artistsRes.error)
  if (venuesRes.error)    console.error('home venues error:',     venuesRes.error)
  if (cityStatsRes.error) console.error('home city stats error:', cityStatsRes.error)

  const stats:     HomeStats   = statsRes.data     ?? { total_shows: 0, unique_artists: 0, unique_venues: 0, min_date: null, max_date: null }
  const artists:   TopArtist[] = artistsRes.data   ?? []
  const venues:    TopVenue[]  = venuesRes.data     ?? []
  const cityStats: CityStats[] = cityStatsRes.data ?? []

  return (
    <>
      <Navigation />
      <HomeClient
        initialStats={stats}
        initialArtists={artists}
        initialVenues={venues}
        initialCityStats={cityStats}
      />
    </>
  )
}
