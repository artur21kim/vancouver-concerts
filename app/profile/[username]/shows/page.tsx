import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import MyShowsClient from '@/app/my-shows/MyShowsClient'

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

  // Unauthenticated → back to profile (friendship required)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    redirect(`/profile/${username}`)
  }

  const { data: rows, error } = await supabase.rpc('get_friend_shows', {
    target_username: username,
    viewer_user_id:  user.id,
  })

  if (error) {
    console.error('get_friend_shows error:', error)
    redirect(`/profile/${username}`)
  }

  // Transform flat RPC rows → Show[] (same shape as MyShowsPage)
  // match_score omitted — friend's scores aren't accessible;
  // headliner ranking falls back to monthly_listeners in MyShowsClient
  const shows = (rows ?? []).map((row: any) => ({
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
    <MyShowsClient
      shows={shows}
      spotifySongs={[]}
      readOnly
      username={username}
    />
  )
}
