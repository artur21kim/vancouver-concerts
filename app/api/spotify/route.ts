import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const firstConcertYear = requestUrl.searchParams.get('first_concert_year');

  // Check if user is authenticated
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Redirect to login with return path
    return NextResponse.redirect(
      new URL('/login?return_to=/discover', requestUrl.origin)
    );
  }

  // Store first concert year in session/cookie for use after callback
  // You may need to adjust this based on your session management
  if (firstConcertYear) {
    // Store in a way that persists through OAuth redirect
    // Option 1: Use Supabase to store temporarily
    await supabase
      .from('user_profiles') // Adjust table name as needed
      .upsert({
        user_id: user.id,
        first_concert_year: parseInt(firstConcertYear)
      });
  }

  // Build Spotify OAuth URL
  const scopes = [
    'user-library-read',           // Access liked songs
    'playlist-modify-public',      // Create public playlists (Phase 5)
    'playlist-modify-private',     // Create private playlists (Phase 5)
  ];

  const spotifyAuthUrl = new URL('https://accounts.spotify.com/authorize');
  spotifyAuthUrl.searchParams.append('client_id', process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID || '');
  spotifyAuthUrl.searchParams.append('response_type', 'code');
  spotifyAuthUrl.searchParams.append('redirect_uri', `${requestUrl.origin}/api/auth/callback/spotify`);
  spotifyAuthUrl.searchParams.append('scope', scopes.join(' '));
  spotifyAuthUrl.searchParams.append('state', user.id); // Use user ID as state for verification

  return NextResponse.redirect(spotifyAuthUrl.toString());
}
