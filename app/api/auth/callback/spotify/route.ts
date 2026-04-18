import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state'); // user_id

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/questionnaire?error=spotify_auth_failed', requestUrl.origin)
    );
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(
          `${process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
        ).toString('base64')}`
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: `${requestUrl.origin}/api/auth/callback/spotify`
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to exchange code for token');
    }

    const tokenData = await tokenResponse.json();

    // Initialize Supabase client
    const supabase = await createClient();

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Save token to database (upsert in case user reconnects)
    const { error: tokenError } = await supabase
      .from('user_spotify_tokens')
      .upsert({
        user_id: state,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt.toISOString(),
        status: 'pending',
        songs_fetched: 0,
        total_songs: 0,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id'
      });

    if (tokenError) {
      console.error('❌ Error saving Spotify token:', tokenError);
      throw new Error('Failed to save Spotify token');
    }

    // Update user profile to mark Spotify as connected
    const { error: profileError } = await supabase
      .from('user_profiles')
      .update({ 
        spotify_connected: true,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', state);

    if (profileError) {
      console.error('❌ Error updating user profile:', profileError);
    }

    console.log(`✅ Spotify token saved for user: ${state}`);
    console.log(`📊 Redirecting to processing page`);

    // Redirect to dedicated processing page (NOT venue-selection)
    return NextResponse.redirect(
      new URL('/spotify-processing', requestUrl.origin)
    );

  } catch (error) {
    console.error('❌ Spotify OAuth error:', error);
    return NextResponse.redirect(
      new URL('/questionnaire?error=spotify_processing_failed', requestUrl.origin)
    );
  }
}
