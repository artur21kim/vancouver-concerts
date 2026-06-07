import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Mirrors the fetch route exactly: one page of /v1/me/tracks per invocation,
// cursor passed in by the caller, 3s outer gap provided by the polling loop.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Fetch stored Spotify token
    const { data: tokenData, error: tokenError } = await supabase
      .from('user_spotify_tokens')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', user.id)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Spotify not connected.' }, { status: 404 })
    }

    // Refresh token if expired
    let accessToken = tokenData.access_token
    const now = new Date()
    const expiresAt = new Date(tokenData.expires_at)

    if (now >= expiresAt) {
      console.log(`🔄 Refreshing token for album backfill — user ${user.id}`)
      const refreshRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(
            `${process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token,
        }),
      })

      if (!refreshRes.ok) {
        console.error('❌ Token refresh failed:', await refreshRes.text())
        return NextResponse.json(
          { error: 'Could not refresh Spotify token. Please reconnect Spotify.' },
          { status: 401 }
        )
      }

      const refreshData = await refreshRes.json()
      accessToken = refreshData.access_token

      await supabase
        .from('user_spotify_tokens')
        .update({
          access_token: accessToken,
          expires_at: new Date(Date.now() + refreshData.expires_in * 1000).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
    }

    // Accept cursor from caller — same pattern as fetch route's last_fetch_url
    const body = await request.json().catch(() => ({}))
    const url: string = body.cursor ?? 'https://api.spotify.com/v1/me/tracks?limit=50'

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`❌ Spotify /v1/me/tracks error (${res.status}): ${errBody}`)
      return NextResponse.json({ error: `Spotify API error ${res.status}` }, { status: 502 })
    }

    const data = await res.json()
    const items: any[] = data.items ?? []
    const nextUrl: string | null = data.next ?? null

    console.log(
      `🎵 Album backfill: ${items.length} tracks — user ${user.id}` +
      (nextUrl ? ' (more pages follow)' : ' (last page)')
    )

    let updatedTracks = 0

    for (const item of items) {
      const track = item.track
      if (!track?.id) continue

      const { error: updateError } = await supabase
        .from('user_spotify_songs')
        .update({
          spotify_album_id: track.album?.id ?? null,
          spotify_album_name: track.album?.name ?? null,
          spotify_album_release_date: track.album?.release_date ?? null,
        })
        .eq('user_id', user.id)
        .eq('spotify_track_id', track.id)

      if (!updateError) {
        updatedTracks++
      } else {
        console.error(`❌ Supabase update failed for track ${track.id}:`, updateError.message)
      }
    }

    console.log(`✅ ${updatedTracks} tracks updated for user ${user.id}`)

    return NextResponse.json({
      success: true,
      updated_tracks: updatedTracks,
      next_url: nextUrl,
    })

  } catch (error) {
    console.error('❌ Album backfill error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
