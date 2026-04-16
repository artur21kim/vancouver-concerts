import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyShowsClient from './MyShowsClient'

export const metadata = {
    title: 'My Shows | Vancouver Concert History',
}

export default async function MyShowsPage() {
    const supabase = await createClient()

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/')
    }

    // Fetch user's shows with full details
    const { data: userShows } = await supabase
        .from('user_shows')
        .select(`
      show_id,
      added_at,
      notes,
      source,
      fact_shows!inner (
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
      )
    `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

    // Transform data to match Browse page format
    const shows = userShows?.map((us: any) => ({
        show_id: us.fact_shows.show_id,
        date: us.fact_shows.date,
        setlist_url: us.fact_shows.setlist_url,
        added_at: us.added_at,
        notes: us.notes,
        source: us.source,
        artist: {
            artist_id: us.fact_shows.dim_artist.artist_id,
            artist_name: us.fact_shows.dim_artist.artist_name,
            monthly_listeners: us.fact_shows.dim_artist.monthly_listeners,
        },
        venue: {
            venue_id: us.fact_shows.dim_venue.venue_id,
            venue_name: us.fact_shows.dim_venue.venue_name,
            capacity: us.fact_shows.dim_venue.capacity,
        },
    })) || []

    return <MyShowsClient shows={shows} />
}