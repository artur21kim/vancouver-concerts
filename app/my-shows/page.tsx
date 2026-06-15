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

    // ── Match scores for headliner determination ──────────────────────────────
    const { data: scoreRows } = await supabase
        .from('user_artist_scores')
        .select('artist_id, normalized_score')
        .eq('user_id', user.id)

    const scoreMap: Record<number, number> = {}
    for (const row of (scoreRows ?? [])) {
        scoreMap[row.artist_id] = Number(row.normalized_score)
    }

    // ── Transform shows ───────────────────────────────────────────────────────
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
            match_score:   scoreMap[artist.artist_id] ?? null,
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

    // ── Spotify songs — SCRUM-80: added_at + spotify_artist_id + artist_name
    //    for artist-contextual song counting in the monthly drilldown overlay ──
    const { data: spotifySongsRaw } = await supabase
        .from('user_spotify_songs')
        .select('added_at, spotify_artist_id, artist_name, track_name, spotify_album_name, spotify_album_release_date, spotify_track_id')
        .eq('user_id', user.id)
        .not('added_at', 'is', null)

    const spotifySongs: { added_at: string; spotify_artist_id: string | null; artist_name: string; track_name: string; spotify_album_name: string | null; spotify_album_release_date: string | null; spotify_track_id: string | null }[] =
        spotifySongsRaw ?? []

    return <MyShowsClient shows={shows as any} spotifySongs={spotifySongs} />
}
