import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);

    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        return NextResponse.redirect(
            new URL('/login', requestUrl.origin)
        );
    }

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