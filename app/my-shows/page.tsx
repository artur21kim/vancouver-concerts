import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyShowsClient from './MyShowsClient'

export const metadata = {
    title: 'My Shows | Grooveprint',
}

export default async function MyShowsPage() {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/')
    }

    // ── User shows ────────────────────────────────────────────────────────────
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
                    capacity,
                    capacity_category
                )
            )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

    if (error) {
        console.error('Error fetching user shows:', error)
        return <MyShowsClient shows={[]} spotifySongs={[]} />
    }

    if (!userShows || userShows.length === 0) {
        return <MyShowsClient shows={[]} spotifySongs={[]} />
    }

    const shows = userShows.map((us: any) => {
        const show = Array.isArray(us.fact_shows) ? us.fact_shows[0] : us.fact_shows
        if (!show) return null

        const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
        const venue  = Array.isArray(show.dim_venue)  ? show.dim_venue[0]  : show.dim_venue

        if (!artist || !venue) return null

        return {
            show_id:       show.show_id,
            date:          show.date,
            setlist_url:   show.setlist_url,
            show_type:     show.show_type,
            festival_name: show.festival_name,
            added_at:      us.added_at,
            notes:         null,
            source:        us.source,
            artist: {
                artist_id:         artist.artist_id,
                artist_name:       artist.artist_name,
                monthly_listeners: artist.monthly_listeners,
                spotify_artist_id: artist.spotify_artist_id,
            },
            venue: {
                venue_id:          venue.venue_id,
                venue_name:        venue.venue_name,
                capacity:          venue.capacity          ?? null,
                capacity_category: venue.capacity_category ?? null,
            },
        }
    }).filter(Boolean)

    // ── Spotify songs (added_at only — for timeline overlay) ─────────────────
    const { data: spotifySongsRaw } = await supabase
        .from('user_spotify_songs')
        .select('added_at')
        .eq('user_id', user.id)
        .not('added_at', 'is', null)

    const spotifySongs: { added_at: string }[] = spotifySongsRaw ?? []

    return <MyShowsClient shows={shows as any} spotifySongs={spotifySongs} />
}
