import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyShowsClient from './MyShowsClient'

export const metadata = {
    title: 'My Shows | Grooveprint',
}

export default async function MyShowsPage() {
    const supabase = await createClient()

    // Check if user is authenticated
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/')
    }

    // Fetch user's shows with full details
    const { data: userShows, error } = await supabase
        .from('user_shows')
        .select(`
            show_id,
            added_at,
            source,
            fact_shows (
                show_id,
                date,
                setlist_url,
                show_type,
                festival_name,
                dim_artist (
                    artist_id,
                    artist_name,
                    monthly_listeners,
                    spotify_artist_id
                ),
                dim_venue (
                    venue_id,
                    venue_name,
                    capacity
                )
            )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

    console.log('=== MY SHOWS DEBUG ===')
    console.log('User ID:', user.id)
    console.log('Error:', error)
    console.log('Raw data:', JSON.stringify(userShows, null, 2))
    console.log('Data length:', userShows?.length)

    if (error) {
        console.error('Error fetching user shows:', error)
        return <MyShowsClient shows={[]} />
    }

    if (!userShows || userShows.length === 0) {
        console.log('No shows found for user')
        return <MyShowsClient shows={[]} />
    }

    // Transform data to match Browse page format
    const shows = userShows?.map((us: any) => {
        console.log('Processing user show:', us)
        
        // Handle the array structure from Supabase joins
        const show = Array.isArray(us.fact_shows) ? us.fact_shows[0] : us.fact_shows
        
        if (!show) {
            console.error('No fact_shows data for user_show:', us)
            return null
        }

        const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
        const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue

        if (!artist || !venue) {
            console.error('Missing artist or venue data:', { artist, venue })
            return null
        }

        return {
            show_id: show.show_id,
            date: show.date,
            setlist_url: show.setlist_url,
            show_type: show.show_type,
            festival_name: show.festival_name,
            added_at: us.added_at,
            notes: null,  // Column doesn't exist in schema
            source: us.source,
            artist: {
                artist_id: artist.artist_id,
                artist_name: artist.artist_name,
                monthly_listeners: artist.monthly_listeners,
                spotify_artist_id: artist.spotify_id,
            },
            venue: {
                venue_id: venue.venue_id,
                venue_name: venue.venue_name,
                capacity: venue.capacity,
            },
        }
    }).filter(show => show !== null) || []

    console.log('Transformed shows count:', shows.length)
    console.log('=== END DEBUG ===')


    return <MyShowsClient shows={shows} />
}
