import { createClient } from '@supabase/supabase-js'
import BrowseClient from './BrowseClient'

export default async function BrowsePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Fetch shows without joins (simpler, more reliable)
  const { data: showsRaw, error } = await supabase
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

  const { data: artists } = await supabase
    .from('dim_artist')
    .select('artist_id, artist_name, monthly_listeners')
    .order('artist_name')

  const { data: venues } = await supabase
    .from('dim_venue')
    .select('venue_id, venue_name, capacity')
    .order('venue_name')

  //  ADD THESE LOGS
  console.log('Supabase error:', error)
  console.log('First show raw:', showsRaw?.[0])
  
  // Transform nested objects to flat structure
const shows = showsRaw?.map((show: any) => {
  console.log('Raw show structure:', show) // Debug log
  
  return {
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
  }
}) || []

  return <BrowseClient shows={shows || []} artists={artists || []} venues={venues || []} />
}