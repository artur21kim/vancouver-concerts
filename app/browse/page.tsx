import { createClient } from '@supabase/supabase-js'
import BrowseClient from './BrowseClient'

export const revalidate = 3600

export default async function BrowsePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const pageSize = 1000

  // Fetch all shows in batches
  let allShowsRaw: any[] = []
  let showPage = 0
  let hasMoreShows = true

  while (hasMoreShows) {
    const { data, error } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        setlist_url,
        show_type,
        festival_name,
        dim_artist!inner (
          artist_id,
          artist_name,
          monthly_listeners,
          spotify_id
        ),
        dim_venue!inner (
          venue_id,
          venue_name,
          capacity
        )
      `)
      .order('date', { ascending: false })
      .range(showPage * pageSize, (showPage + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching page', showPage, error)
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-600 text-lg mb-4">Failed to load concert data</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Try again
            </button>
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

  // Fetch artists in batches
  let allArtists: any[] = []
  let artistPage = 0
  let hasMoreArtists = true

  while (hasMoreArtists) {
    const { data, error } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, monthly_listeners, spotify_id')
      .order('artist_name')
      .range(artistPage * pageSize, (artistPage + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching artists', error)
      break
    }

    if (data && data.length > 0) {
      allArtists = [...allArtists, ...data]
      artistPage++
      hasMoreArtists = data.length === pageSize
    } else {
      hasMoreArtists = false
    }
  }

  // Fetch venues in batches
  let allVenues: any[] = []
  let venuePage = 0
  let hasMoreVenues = true

  while (hasMoreVenues) {
    const { data, error } = await supabase
      .from('dim_venue')
      .select('venue_id, venue_name, capacity')
      .order('venue_name')
      .range(venuePage * pageSize, (venuePage + 1) * pageSize - 1)

    if (error) {
      console.error('Error fetching venues', error)
      break
    }

    if (data && data.length > 0) {
      allVenues = [...allVenues, ...data]
      venuePage++
      hasMoreVenues = data.length === pageSize
    } else {
      hasMoreVenues = false
    }
  }

  // Check if we got any data
  if (allShowsRaw.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600">Loading concert database...</p>
        </div>
      </div>
    )
  }

  // Transform nested objects to flat structure
  const shows = allShowsRaw.map((show: any) => ({
    show_id: show.show_id,
    date: show.date,
    setlist_url: show.setlist_url,
    show_type: show.show_type,
    festival_name: show.festival_name,
    artist: {
      artist_id: show.dim_artist?.artist_id || 0,
      artist_name: show.dim_artist?.artist_name || 'Unknown',
      monthly_listeners: show.dim_artist?.monthly_listeners || null,
      spotify_id: show.dim_artist?.spotify_id || null
    },
    venue: {
      venue_id: show.dim_venue?.venue_id || 0,
      venue_name: show.dim_venue?.venue_name || 'Unknown',
      capacity: show.dim_venue?.capacity || null
    }
  }))

  return <BrowseClient shows={shows} artists={allArtists} venues={allVenues} />
}
