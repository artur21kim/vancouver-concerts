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
    // For 2000 songs (40 requests): ~24 seconds
    // For 5000 songs (100 requests): ~60 seconds (1 minute)
    // For 10000 songs (200 requests): ~120 seconds (2 minutes)
    
    // TODO Phase 4.5: Consider showing progress UI or running this in background job

    // ⏱️ START PERFORMANCE TRACKING
    const performanceStart = Date.now();
    console.log(`🚀 Starting Spotify fetch for user: ${state}`);

    // Fetch all liked songs (paginated with rate limiting)
    const fetchStartTime = Date.now();
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
          console.log(`⚠️ Rate limited. Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry this request
        }
        throw new Error('Failed to fetch liked songs');
      }

      const data = await response.json();
      allSongs.push(...data.items);
      nextUrl = data.next;

      // Log progress every 500 songs
      if (allSongs.length % 500 === 0 && allSongs.length > 0) {
        const elapsed = ((Date.now() - fetchStartTime) / 1000).toFixed(1);
        console.log(`📊 Progress: ${allSongs.length} songs fetched (${elapsed}s elapsed)`);
      }

      // Rate limit delay before next request
      if (nextUrl) {
        await rateLimit();
      }
    }

    const fetchEndTime = Date.now();
    const fetchDuration = ((fetchEndTime - fetchStartTime) / 1000).toFixed(2);
    
    console.log(`✅ Spotify Fetch Complete:`);
    console.log(`   - Songs fetched: ${allSongs.length}`);
    console.log(`   - API requests: ${requestCount}`);
    console.log(`   - Fetch duration: ${fetchDuration}s`);

    // Transform and prepare for database insert
    const transformStartTime = Date.now();
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

    const transformDuration = ((Date.now() - transformStartTime) / 1000).toFixed(2);
    console.log(`🔄 Transform complete: ${songsToInsert.length} records in ${transformDuration}s`);

    // Batch upsert into user_spotify_songs (handles duplicates gracefully)
    const upsertStartTime = Date.now();
    const batchSize = 1000;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < songsToInsert.length; i += batchSize) {
      const batch = songsToInsert.slice(i, i + batchSize);
      const { data, error } = await supabase
        .from('user_spotify_songs')
        .upsert(batch, { 
          onConflict: 'user_id,spotify_track_id,spotify_artist_id',
          ignoreDuplicates: false // Update if exists
        });

      if (error) {
        console.error(`❌ Error upserting batch ${i / batchSize + 1}:`, error);
        errorCount++;
      } else {
        successCount++;
      }
    }

    const upsertDuration = ((Date.now() - upsertStartTime) / 1000).toFixed(2);
    const totalDuration = ((Date.now() - performanceStart) / 1000).toFixed(2);

    console.log(`✅ Upsert complete: ${successCount} successful batches, ${errorCount} errors`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📈 PERFORMANCE SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   User ID: ${state}`);
    console.log(`   Total songs: ${allSongs.length}`);
    console.log(`   Total records: ${songsToInsert.length}`);
    console.log(`   API requests: ${requestCount}`);
    console.log(`   ─────────────────────────────────────`);
    console.log(`   Fetch time: ${fetchDuration}s`);
    console.log(`   Transform time: ${transformDuration}s`);
    console.log(`   Upsert time: ${upsertDuration}s`);
    console.log(`   ─────────────────────────────────────`);
    console.log(`   🏁 TOTAL TIME: ${totalDuration}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

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
