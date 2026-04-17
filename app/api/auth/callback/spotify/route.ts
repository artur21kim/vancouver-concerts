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
    const accessToken = tokenData.access_token;

    // Initialize Supabase client
    const supabase = await createClient();

    // NOTE: This process can take a few minutes for users with large libraries
    // Rate limiting: 600ms between requests = 100 requests/minute
    // For 100 songs (2 requests): ~1.2 seconds
    // For 2000 songs (40 requests): ~24 seconds
    // For 5000 songs (100 requests): ~60 seconds (1 minute)
    // For 10000 songs (200 requests): ~120 seconds (2 minutes)
    
    // TODO Phase 4.5: Consider showing progress UI or running this in background job

    // Fetch all liked songs (paginated with rate limiting)
    const allSongs: any[] = [];
    let nextUrl: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50';
    let requestCount = 0;
    const startTime = Date.now();

    // Helper function to add delay for rate limiting
    const rateLimit = async () => {
      requestCount++;
      
      // 100 requests per minute = 1 request every 600ms
      if (requestCount % 10 === 0) {
        // Every 10 requests, check if we need to slow down
        const elapsedMs = Date.now() - startTime;
        const expectedMs = requestCount * 600; // 600ms per request = 100/min
        
        if (elapsedMs < expectedMs) {
          await new Promise(resolve => setTimeout(resolve, expectedMs - elapsedMs));
        }
      } else {
        // Standard delay between requests
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    };

    while (nextUrl) {
      const response: Response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        // Check if we hit rate limit
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
          console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry this request
        }
        throw new Error('Failed to fetch liked songs');
      }

      const data = await response.json();
      allSongs.push(...data.items);
      nextUrl = data.next;

      // TESTING LIMIT: Only fetch 100 songs to test flow without rate limiting
      // TODO: Remove or increase this limit after testing is successful
      if (allSongs.length >= 100) {
        console.log(`✅ Reached testing limit of 100 songs. Stopping fetch.`);
        console.log(`📊 Total songs fetched: ${allSongs.length}`);
        break;
      }

      // Rate limit delay before next request
      if (nextUrl) {
        await rateLimit();
      }
    }

    // Transform and prepare for database insert
    const songsToInsert = allSongs.flatMap(item => {
      const track = item.track;
      return track.artists.map((artist: any) => ({
        user_id: state, // user_id from OAuth state
        spotify_track_id: track.id,
        spotify_artist_id: artist.id,
        track_name: track.name,
        artist_name: artist.name,
        added_at: item.added_at
      }));
    });

    console.log(`📝 Inserting ${songsToInsert.length} song-artist pairs for user ${state}`);

    // Batch upsert into user_spotify_songs (handles duplicates gracefully)
    const batchSize = 1000;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < songsToInsert.length; i += batchSize) {
      const batch = songsToInsert.slice(i, i + batchSize);
      const { data, error } = await supabase
        .from('user_spotify_songs')
        .upsert(batch, { 
          onConflict: 'user_id,spotify_track_id',
          ignoreDuplicates: false // Update if exists
        });

      if (error) {
        console.error(`❌ Error upserting batch ${i / batchSize + 1}:`, error);
        errorCount++;
      } else {
        successCount++;
      }
    }

    console.log(`✅ Upsert complete: ${successCount} successful batches, ${errorCount} errors`);

    // Redirect to venue selection page
    return NextResponse.redirect(
      new URL('/venue-selection', requestUrl.origin)
    );

  } catch (error) {
    console.error('❌ Spotify OAuth error:', error);
    return NextResponse.redirect(
      new URL('/questionnaire?error=spotify_processing_failed', requestUrl.origin)
    );
  }
}
