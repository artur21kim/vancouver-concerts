import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      console.log(`🔄 Token expired, refreshing for avatar refresh — user ${user.id}`)

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
        console.error('❌ Failed to refresh Spotify token:', await refreshRes.text())
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

    // Fetch Spotify profile
    const meRes = await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!meRes.ok) {
      console.error(`❌ Spotify /v1/me failed (${meRes.status}) for user ${user.id}`)
      return NextResponse.json(
        { error: 'Failed to fetch your Spotify profile. Please try again.' },
        { status: 502 }
      )
    }

    const me = await meRes.json()
    const avatarUrl: string | null = me.images?.[0]?.url ?? null

    if (!avatarUrl) {
      return NextResponse.json(
        { error: 'No profile image found on your Spotify account.' },
        { status: 404 }
      )
    }

    // Update unconditionally — allows overriding Google avatar, not just filling null
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)

    if (updateError) {
      console.error('❌ Failed to update avatar_url:', updateError)
      return NextResponse.json({ error: 'Failed to save avatar.' }, { status: 500 })
    }

    console.log(`✅ Avatar refreshed from Spotify for user ${user.id}`)
    return NextResponse.json({ success: true, avatar_url: avatarUrl })

  } catch (error) {
    console.error('❌ Avatar refresh error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
