import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// One Spotify request per invocation (50 tracks), outer gap provided by the caller.
// Mirrors the fetch route pattern: single chunk per call, polling loop handles pacing.
const MAX_TRACKS_PER_CALL = 50

export async function POST() {
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

      console.log(`✅ Token refreshed for user ${user.id}`)
    }

    // Find rows that still need album data backfilled.
    // Multi-artist tracks produce multiple rows with the same spotify_track_id,
    // so we deduplicate track IDs before hitting the Spotify API.
    const { data: tracksNeedingFill, error: tracksError } = await supabase
      .from('user_spotify_songs')
      .select('spotify_track_id')
      .eq('user_id', user.id)
      .is('spotify_album_id', null)

    if (tracksError) {
      console.error('❌ Error fetching tracks for backfill:', tracksError)
      return NextResponse.json({ error: 'Failed to fetch tracks.' }, { status: 500 })
    }

    if (!tracksNeedingFill || tracksNeedingFill.length === 0) {
      return NextResponse.json({
        success: true,
        updated_tracks: 0,
        remaining_tracks: 0,
        message: 'All tracks already have album data.',
      })
    }

    const uniqueTrackIds = [
      ...new Set(tracksNeedingFill.map(t => t.spotify_track_id))
    ]

    const toProcess = uniqueTrackIds.slice(0, MAX_TRACKS_PER_CALL)
    const remaining = uniqueTrackIds.length - toProcess.length

    console.log(
      `🎵 Album backfill: ${toProcess.length} unique tracks` +
      `${remaining > 0 ? `, ${remaining} remaining after this call` : ''} — user ${user.id}`
    )

    let updatedTracks = 0
    const BATCH_SIZE = 50

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE)
      const ids = batch.join(',')

      const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        console.error(`❌ Spotify /v1/tracks error (${res.status}) at batch offset ${i}: ${errBody}`)
        continue
      }

      const data = await res.json()
      const spotifyTracks: any[] = data.tracks ?? []

      for (const track of spotifyTracks) {
        if (!track?.id) continue // track can be null if deleted from Spotify

        const albumId: string | null = track.album?.id ?? null
        const albumReleaseDate: string | null = track.album?.release_date ?? null

        // Update all rows for this track (covers multi-artist duplicates)
        const { error: updateError } = await supabase
          .from('user_spotify_songs')
          .update({
            spotify_album_id: albumId,
            spotify_album_release_date: albumReleaseDate,
          })
          .eq('user_id', user.id)
          .eq('spotify_track_id', track.id)

        if (!updateError) {
          updatedTracks++
        } else {
          console.error(`❌ Supabase update failed for track ${track.id}:`, updateError.message)
        }
      }
    }

    console.log(`✅ Album backfill complete: ${updatedTracks} tracks updated for user ${user.id}`)

    return NextResponse.json({
      success: true,
      updated_tracks: updatedTracks,
      remaining_tracks: remaining,
      message: remaining > 0
        ? `${remaining} tracks still need backfilling — call this route again to continue.`
        : 'Backfill complete for this user.',
    })

  } catch (error) {
    console.error('❌ Album backfill error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
