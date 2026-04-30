import Navigation from './components/Navigation'
import { createClient } from '@supabase/supabase-js'
import HomeClient from './HomeClient'

export const revalidate = 3600

export default async function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const pageSize = 1000

  // Fetch all shows in batches — lean, ID-only
  let allShowsRaw: any[] = []
  let showPage = 0
  let hasMoreShows = true

  while (hasMoreShows) {
    const { data, error } = await supabase
      .from('fact_shows')
      .select('show_id, date, artist_id, venue_id, show_type')
      .order('date', { ascending: false })
      .range(showPage * pageSize, (showPage + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching page', showPage, error)
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 text-lg mb-4">Failed to load concert data</p>
          </div>
        </div>
      )
    }

    if (data && data.length > 0) {
      allShowsRaw = [...allShowsRaw, ...data]
      showPage++
      hasMoreShows = data.length === pageSize
    } else {
      hasMoreShows = false
    }
  }

  // Fetch artists
  let allArtists: any[] = []
  let artistPage = 0
  let hasMoreArtists = true

  while (hasMoreArtists) {
    const { data, error } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name')
      .order('artist_name')
      .range(artistPage * pageSize, (artistPage + 1) * pageSize - 1)

    if (error) { console.error('Error fetching artists', error); break }
    if (data && data.length > 0) {
      allArtists = [...allArtists, ...data]
      artistPage++
      hasMoreArtists = data.length === pageSize
    } else {
      hasMoreArtists = false
    }
  }

  // Fetch venues with capacity info
  let allVenues: any[] = []
  let venuePage = 0
  let hasMoreVenues = true

  while (hasMoreVenues) {
    const { data, error } = await supabase
      .from('dim_venue')
      .select('venue_id, venue_name, capacity_category, status')
      .order('venue_name')
      .range(venuePage * pageSize, (venuePage + 1) * pageSize - 1)

    if (error) { console.error('Error fetching venues', error); break }
    if (data && data.length > 0) {
      allVenues = [...allVenues, ...data]
      venuePage++
      hasMoreVenues = data.length === pageSize
    } else {
      hasMoreVenues = false
    }
  }

  if (allShowsRaw.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading concert history...</p>
        </div>
      </div>
    )
  }

  const shows = allShowsRaw.map((show: any) => ({
    show_id: show.show_id,
    date: show.date,
    artist_id: show.artist_id,
    venue_id: show.venue_id,
    show_type: show.show_type,
  }))

  return (
    <>
      <Navigation />
      <HomeClient shows={shows} artists={allArtists} venues={allVenues} />
    </>
  )
}
