import { createClient } from '@supabase/supabase-js'
import BrowseClient from './BrowseClient'

export default async function BrowsePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Fetch all data upfront (client-side filtering for instant updates)
  const { data: shows } = await supabase
    .from('fact_shows')
    .select(`
      show_id,
      date,
      setlist_url,
      artist:dim_artist(artist_id, artist_name, monthly_listeners),
      venue:dim_venue(venue_id, venue_name, capacity)
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

  return <BrowseClient shows={shows || []} artists={artists || []} venues={venues || []} />
}