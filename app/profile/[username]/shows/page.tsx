import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyGrooveprintClient, { type ProfileHeader } from '@/app/my-grooveprint/MyGrooveprintClient'

interface PageProps {
  params: Promise<{ username: string }>
}

export async function generateMetadata({ params }: PageProps) {
  const { username } = await params
  return { title: `${username}'s Shows | Grooveprint` }
}

export default async function FriendShowsPage({ params }: PageProps) {
  const { username } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/profile/${username}`)
  }

  // Run both queries in parallel
  const [profileResult, showsResult] = await Promise.all([
    supabase.rpc('get_user_profile', { target_username: username }),
    supabase.rpc('get_friend_shows', {
      target_username: username,
      viewer_user_id:  user.id,
    }),
  ])

  if (showsResult.error) {
    console.error('get_friend_shows error:', showsResult.error)
    redirect(`/profile/${username}`)
  }

  // Build profileHeader — only when get_user_profile returned a full (non-restricted) profile
  const raw = !profileResult.error && profileResult.data ? (profileResult.data as any) : null
  const profileHeader: ProfileHeader | undefined =
    raw && !('visibility' in raw)
      ? {
          user_id:               raw.user_id,
          username:              raw.username,
          bio:                   raw.bio ?? null,
          avatar_url:            raw.avatar_url ?? null,
          confirmed_shows:       raw.confirmed_shows   ?? 0,
          unique_artists:        raw.unique_artists    ?? 0,
          unique_venues:         raw.unique_venues     ?? 0,
          festival_count:        raw.festival_count    ?? 0,
          first_show_year:       raw.first_show_year   ?? null,
          last_show_year:        raw.last_show_year    ?? null,
          spotify_song_count:    raw.spotify_song_count   ?? null,
          spotify_artist_count:  raw.spotify_artist_count ?? null,
          spotify_album_count:   raw.spotify_album_count  ?? null,
          spotify_since_year:    null,
          spotify_connected:     raw.spotify_connected    ?? false,
          show_spotify_stats:    raw.show_spotify_stats   ?? false,
          spotify_user_id:       raw.spotify_user_id      ?? null,
          discogs_connected:     raw.discogs_connected     ?? false,
          discogs_username:      raw.discogs_username      ?? null,
          discogs_release_count: raw.discogs_release_count ?? null,
          is_own_profile:        raw.is_own_profile        ?? false,
          friendship_status:     raw.friendship_status     ?? null,
          request_direction:     raw.request_direction     ?? null,
          request_id:            raw.request_id            ?? null,
        }
      : undefined

  // Transform flat RPC rows → Show[] (same shape as MyGrooveprintPage)
  // match_score omitted — friend's scores aren't accessible;
  // headliner ranking falls back to monthly_listeners in MyGrooveprintClient
  const shows = (showsResult.data ?? []).map((row: any) => ({
    show_id:       row.show_id,
    date:          row.date,
    setlist_url:   row.setlist_url,
    show_type:     row.show_type,
    festival_name: row.festival_name,
    added_at:      row.added_at,
    notes:         null,
    source:        row.source,
    match_score:   null,
    artist: {
      artist_id:         row.artist_id,
      artist_name:       row.artist_name,
      monthly_listeners: row.monthly_listeners,
      spotify_artist_id: row.spotify_artist_id,
    },
    venue: {
      venue_id:          row.venue_id,
      venue_name:        row.venue_name,
      capacity:          row.capacity          ?? null,
      capacity_category: row.capacity_category ?? null,
    },
  }))

  return (
    <MyGrooveprintClient
      shows={shows}
      spotifySongs={[]}
      readOnly
      username={username}
      profileHeader={profileHeader}
    />
  )
}
