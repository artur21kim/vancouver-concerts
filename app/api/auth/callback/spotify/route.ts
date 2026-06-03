import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state'); // user_id

  if (!code || !state) {
    return NextResponse.redirect(
      new URL('/discover?error=spotify_auth_failed', requestUrl.origin)
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

    // Fetch Spotify profile for avatar (works with any valid token — no extra scope needed)
    let spotifyAvatarUrl: string | null = null;
    try {
      const meRes = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        spotifyAvatarUrl = me.images?.[0]?.url ?? null;
      }
    } catch (e) {
      console.error('⚠️ Could not fetch Spotify profile image:', e);
    }

    // Initialize Supabase client
    const supabase = await createClient();

    // Verify the user is actually logged in
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('❌ User not authenticated:', authError);
      throw new Error('User not authenticated');
    }

    // Verify the state matches the logged-in user
    if (user.id !== state) {
      console.error('❌ State mismatch:', { expected: state, actual: user.id });
      throw new Error('Invalid OAuth state');
    }

    // Calculate token expiration time
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Save token to database (upsert in case user reconnects)
    const { error: tokenError } = await supabase
      .from('user_spotify_tokens')
      .upsert({
        user_id: user.id,
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
      .eq('user_id', user.id);

    if (profileError) {
      console.error('❌ Error updating user profile:', profileError);
    }

    // Set avatar from Spotify if user doesn't already have one
    if (spotifyAvatarUrl) {
      await supabase
        .from('user_profiles')
        .update({ avatar_url: spotifyAvatarUrl })
        .eq('user_id', user.id)
        .is('avatar_url', null);
    }

    // Read back the scope that was saved before the OAuth redirect
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('last_match_scope, last_from_date')
      .eq('user_id', user.id)
      .single();

    const matchScope = profile?.last_match_scope || 'past';
    const fromDate = profile?.last_from_date || null;

    console.log(`✅ Spotify token saved for user: ${user.id}`);
    console.log(`📊 Redirecting to processing page (scope: ${matchScope})`);

    // Forward scope to processing page via URL params
    const processingUrl = new URL('/spotify-processing', requestUrl.origin);
    processingUrl.searchParams.set('match_scope', matchScope);
    if (fromDate) {
      processingUrl.searchParams.set('from_date', fromDate);
    }

    return NextResponse.redirect(processingUrl);

  } catch (error) {
    console.error('❌ Spotify OAuth error:', error);
    return NextResponse.redirect(
      new URL('/discover?error=spotify_processing_failed', requestUrl.origin)
    );
  }
}
