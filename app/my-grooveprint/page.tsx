import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyGrooveprintClient, { type ProfileHeader } from './MyGrooveprintClient'

export const metadata = {
    title: 'My Grooveprint | Grooveprint',
}

export default async function MyGrooveprintPage() {
    const supabase = await createClient()

    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        redirect('/')
    }

    // ── Run shows + profile in parallel ──────────────────────────────────────
    const [
        { data: userShows, error },
        { data: profileRow },
    ] = await Promise.all([
        supabase
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
            .order('added_at', { ascending: false }),
        supabase
            .from('user_profiles')
            .select('username, bio, avatar_url, spotify_connected, show_spotify_stats, spotify_user_id, discogs_connected, discogs_username, discogs_release_count')
            .eq('user_id', user.id)
            .single(),
    ])

    if (error) {
        console.error('Error fetching user shows:', error)
        return <MyGrooveprintClient shows={[]} spotifySongs={[]} />
    }

    if (!userShows || userShows.length === 0) {
        return <MyGrooveprintClient shows={[]} spotifySongs={[]} />
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

    // ── Spotify songs ─────────────────────────────────────────────────────────
    const { data: spotifySongsRaw } = await supabase
        .from('user_spotify_songs')
        .select('added_at, spotify_artist_id, artist_name, track_name, spotify_album_name, spotify_album_release_date, spotify_track_id')
        .eq('user_id', user.id)
        .not('added_at', 'is', null)

    const spotifySongs: {
        added_at: string
        spotify_artist_id: string | null
        artist_name: string
        track_name: string
        spotify_album_name: string | null
        spotify_album_release_date: string | null
        spotify_track_id: string | null
    }[] = spotifySongsRaw ?? []

    // ── Build profileHeader from fetched data ─────────────────────────────────
    let profileHeader: ProfileHeader | undefined

    if (profileRow) {
        // Stats derived from the shows array (mirrors what get_user_profile computes via SQL)
        const confirmedShows   = new Set(shows.map((s: any) => `${s.date}__${s.venue.venue_id}`)).size
        const uniqueArtists    = new Set(shows.map((s: any) => s.artist.artist_id)).size
        const uniqueVenues     = new Set(shows.map((s: any) => s.venue.venue_id)).size
        const festivalCount    = new Set(
            shows
                .filter((s: any) => s.festival_name)
                .map((s: any) => `${s.festival_name}::${s.date.split('-')[0]}`)
        ).size
        const showYears        = shows.map((s: any) => parseInt(s.date.split('-')[0])).filter(Boolean)
        const firstShowYear    = showYears.length > 0 ? Math.min(...showYears) : null
        const lastShowYear     = showYears.length > 0 ? Math.max(...showYears) : null

        // Spotify stats from already-fetched songs array
        const spotifySongCount   = new Set(spotifySongs.map(s => s.spotify_track_id).filter(Boolean)).size
        const spotifyArtistCount = new Set(spotifySongs.map(s => s.spotify_artist_id).filter(Boolean)).size
        const spotifyAlbumCount  = new Set(spotifySongs.filter(s => s.spotify_album_name).map(s => s.spotify_album_name)).size

        profileHeader = {
            user_id:               user.id,
            username:              (profileRow as any).username ?? '',
            bio:                   (profileRow as any).bio      ?? null,
            avatar_url:            (profileRow as any).avatar_url ?? null,
            confirmed_shows:       confirmedShows,
            unique_artists:        uniqueArtists,
            unique_venues:         uniqueVenues,
            festival_count:        festivalCount,
            first_show_year:       firstShowYear,
            last_show_year:        lastShowYear,
            spotify_song_count:    spotifySongCount   > 0 ? spotifySongCount   : null,
            spotify_artist_count:  spotifyArtistCount > 0 ? spotifyArtistCount : null,
            spotify_album_count:   spotifyAlbumCount  > 0 ? spotifyAlbumCount  : null,
            spotify_connected:     (profileRow as any).spotify_connected  ?? false,
            show_spotify_stats:    (profileRow as any).show_spotify_stats ?? true,
            spotify_user_id:       (profileRow as any).spotify_user_id   ?? null,
            discogs_connected:     (profileRow as any).discogs_connected  ?? false,
            discogs_username:      (profileRow as any).discogs_username   ?? null,
            discogs_release_count: (profileRow as any).discogs_release_count ?? null,
            is_own_profile:        true,
            friendship_status:     null,
            request_direction:     null,
            request_id:            null,
        }
    }

    return (
        <MyGrooveprintClient
            shows={shows as any}
            spotifySongs={spotifySongs}
            profileHeader={profileHeader}
        />
    )
}
