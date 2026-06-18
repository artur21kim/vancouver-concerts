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

    // ── Run shows + profile + lightweight Spotify counts in parallel ──────────
    const [
        { data: userShows, error },
        { data: profileRow },
        { data: spotifyStatsData },
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
                        capacity_category,
                        city
                    )
                )
            `)
            .eq('user_id', user.id)
            .order('added_at', { ascending: false }),
        supabase
            .from('user_profiles')
            .select('username, bio, avatar_url, spotify_connected, show_spotify_stats, spotify_user_id, discogs_connected, discogs_username, discogs_release_count, preferred_cities, preferred_tab')
            .eq('user_id', user.id)
            .single(),
        // GP-124: returns {song_count, artist_count, album_count} — 3 numbers instead of ~10k rows
        supabase.rpc('get_user_spotify_stats', { p_user_id: user.id }),
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
            city:          venue.city ?? null,
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

    // ── GP-124: Spotify songs are lazy-loaded client-side on first tab click.
    // Stats (counts) come from the lightweight RPC above.
    // Full user_spotify_songs fetch removed from server component entirely.
    const spotifyStats        = (spotifyStatsData as any)?.[0] ?? null
    const spotifySongCount    = spotifyStats ? Number(spotifyStats.song_count)         : 0
    const spotifyArtistCount  = spotifyStats ? Number(spotifyStats.artist_count)       : 0
    const spotifyAlbumCount   = spotifyStats ? Number(spotifyStats.album_count)        : 0
    const spotifySinceYear    = spotifyStats?.spotify_since_year
                                  ? Number(spotifyStats.spotify_since_year) : null

    // ── GP-127: Apply city preference filter ─────────────────────────────────
    const preferredCities: string[] | null = (profileRow as any)?.preferred_cities ?? null
    const filteredShows = preferredCities && preferredCities.length > 0
        ? shows.filter((s: any) => s?.city && preferredCities.includes(s.city))
        : shows

    // ── Build profileHeader from fetched data ─────────────────────────────────
    let profileHeader: ProfileHeader | undefined

    if (profileRow) {
        // Stats derived from filteredShows (respects city preference)
        const confirmedShows   = new Set(filteredShows.map((s: any) => `${s.date}__${s.venue.venue_id}`)).size
        const uniqueArtists    = new Set(filteredShows.map((s: any) => s.artist.artist_id)).size
        const uniqueVenues     = new Set(filteredShows.map((s: any) => s.venue.venue_id)).size
        const festivalCount    = new Set(
            filteredShows
                .filter((s: any) => s.festival_name)
                .map((s: any) => `${s.festival_name}::${s.date.split('-')[0]}`)
        ).size
        const showYears        = filteredShows.map((s: any) => parseInt(s.date.split('-')[0])).filter(Boolean)
        const firstShowYear    = showYears.length > 0 ? Math.min(...showYears) : null
        const lastShowYear     = showYears.length > 0 ? Math.max(...showYears) : null

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
            // GP-124: counts from lightweight RPC (not derived from full songs array)
            spotify_song_count:    spotifySongCount   > 0 ? spotifySongCount   : null,
            spotify_artist_count:  spotifyArtistCount > 0 ? spotifyArtistCount : null,
            spotify_album_count:   spotifyAlbumCount  > 0 ? spotifyAlbumCount  : null,
            spotify_since_year:    spotifySinceYear,
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
            preferred_tab:         (profileRow as any).preferred_tab ?? null,
        }
    }

    return (
        <MyGrooveprintClient
            shows={filteredShows as any}
            spotifySongs={[]}
            profileHeader={profileHeader}
        />
    )
}
