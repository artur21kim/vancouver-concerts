import { createClient } from '@supabase/supabase-js'
import BrowseClient from './BrowseClient'

// This tells Next.js to cache this page and revalidate every hour
export const revalidate = 3600 // 1 hour in seconds

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
        dim_artist!inner (
          artist_id,
          artist_name,
          monthly_listeners
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
      break
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
    const { data } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, monthly_listeners')
      .order('artist_name')
      .range(artistPage * pageSize, (artistPage + 1) * pageSize - 1)
    
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
    const { data } = await supabase
      .from('dim_venue')
      .select('venue_id, venue_name, capacity')
      .order('venue_name')
      .range(venuePage * pageSize, (venuePage + 1) * pageSize - 1)
    
    if (data && data.length > 0) {
      allVenues = [...allVenues, ...data]
      venuePage++
      hasMoreVenues = data.length === pageSize
    } else {
      hasMoreVenues = false
    }
  }

  // Transform nested objects to flat structure
  const shows = allShowsRaw.map((show: any) => ({
    show_id: show.show_id,
    date: show.date,
    setlist_url: show.setlist_url,
    artist: {
      artist_id: show.dim_artist?.artist_id || 0,
      artist_name: show.dim_artist?.artist_name || 'Unknown',
      monthly_listeners: show.dim_artist?.monthly_listeners || null
    },
    venue: {
      venue_id: show.dim_venue?.venue_id || 0,
      venue_name: show.dim_venue?.venue_name || 'Unknown',
      capacity: show.dim_venue?.capacity || null
    }
  }))

  return <BrowseClient shows={shows} artists={allArtists} venues={allVenues} />
}