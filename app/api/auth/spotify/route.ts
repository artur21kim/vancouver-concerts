import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const matchScope = requestUrl.searchParams.get('match_scope') || 'past';
  const fromDate = requestUrl.searchParams.get('from_date') || null;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL('/login', requestUrl.origin)
    );
  }

  // Persist scope to profile as a permanent record
  await supabase
    .from('user_profiles')
    .update({
      last_match_scope: matchScope,
      last_from_date: fromDate,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id);

  const params = new URLSearchParams({
    client_id: process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!,
    response_type: 'code',
    redirect_uri: `${requestUrl.origin}/api/auth/callback/spotify`,
    scope: 'user-library-read',
    state: user.id,
  });

  const spotifyAuthUrl = `https://accounts.spotify.com/authorize?${params.toString()}`;

  return NextResponse.redirect(spotifyAuthUrl);
}
