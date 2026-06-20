import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Process one chunk of Spotify songs (500 songs = ~4 seconds)
// This stays well under the 10-second timeout limit
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's token from database
    const { data: tokenData, error: tokenError } = await supabase
      .from('user_spotify_tokens')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Spotify token not found' }, { status: 404 });
    }

    // Check if token is expired and refresh if needed
    const now = new Date();
    const expiresAt = new Date(tokenData.expires_at);
    
    let accessToken = tokenData.access_token;
    
    if (now >= expiresAt) {
      console.log(`🔄 Token expired, refreshing for user ${user.id}`);
      
      // Refresh the token
      const refreshResponse = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${Buffer.from(
            `${process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
          ).toString('base64')}`
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: tokenData.refresh_token
        })
      });

      if (!refreshResponse.ok) {
        console.error('❌ Failed to refresh token:', await refreshResponse.text());
        return NextResponse.json({ error: 'Failed to refresh Spotify token' }, { status: 401 });
      }

      const refreshData = await refreshResponse.json();
      accessToken = refreshData.access_token;
      
      // Update token in database
      const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000);
      await supabase
        .from('user_spotify_tokens')
        .update({ 
          access_token: accessToken,
          expires_at: newExpiresAt.toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);
      
      console.log(`✅ Token refreshed for user ${user.id}`);
    }

    // If already complete, return success
    if (tokenData.status === 'complete') {
      return NextResponse.json({ 
        status: 'complete',
        songs_fetched: tokenData.songs_fetched,
        total_songs: tokenData.total_songs
      });
    }

    // Update status to processing if pending
    if (tokenData.status === 'pending') {
      await supabase
        .from('user_spotify_tokens')
        .update({ 
          status: 'processing',
          fetch_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id);
    }

    const startUrl = tokenData.last_fetch_url || 'https://api.spotify.com/v1/me/tracks?limit=50';
    
    const chunkStartTime = Date.now();
    const totalElapsedTime = tokenData.fetch_started_at 
      ? (Date.now() - new Date(tokenData.fetch_started_at).getTime()) / 1000 
      : 0;
    
    console.log(`🔄 Fetching chunk for user ${user.id} (${tokenData.songs_fetched} songs so far, ${totalElapsedTime.toFixed(1)}s elapsed)`);

    // Fetch one batch (up to 10 requests = 500 songs max per chunk)
    const songsInChunk: any[] = [];
    let nextUrl: string | null = startUrl;
    let requestCount = 0;
    const maxRequestsPerChunk = 10; // 10 requests * 50 songs = 500 songs per chunk

    while (nextUrl && requestCount < maxRequestsPerChunk) {
      const response = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          // Token is invalid or lacks permissions
          console.error(`❌ Spotify auth error (${response.status}):`, await response.text());
          
          await supabase
            .from('user_spotify_tokens')
            .update({ 
              status: 'error',
              error_message: `Authentication failed (${response.status}). Please reconnect Spotify.`,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id);

          return NextResponse.json({ 
            status: 'error',
            error: 'auth_failed',
            message: 'Spotify authentication failed. Please reconnect your account.',
            songs_fetched: tokenData.songs_fetched
          }, { status: response.status });
        }
        
        if (response.status === 429) {
          // Rate limited - mark for retry
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) : 60;
          
          await supabase
            .from('user_spotify_tokens')
            .update({ 
              error_message: `Rate limited. Retry after ${waitTime}s`,
              updated_at: new Date().toISOString()
            })
            .eq('user_id', user.id);

          return NextResponse.json({ 
            status: 'processing',
            error: 'rate_limited',
            retry_after: waitTime,
            songs_fetched: tokenData.songs_fetched,
            total_songs: tokenData.total_songs
          });
        }
        
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = await response.json();
      
      // On first request, get total count
      if (requestCount === 0 && tokenData.total_songs === 0) {
        await supabase
          .from('user_spotify_tokens')
          .update({ 
            total_songs: data.total,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);
      }

      songsInChunk.push(...data.items);
      nextUrl = data.next;
      requestCount++;

      // Rate limiting: 400ms between requests
      if (nextUrl && requestCount < maxRequestsPerChunk) {
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    }

    console.log(`📦 Chunk fetched: ${songsInChunk.length} songs in this batch (${requestCount} API requests, ${((Date.now() - chunkStartTime) / 1000).toFixed(2)}s)`);

    const transformStartTime = Date.now();

    // SCRUM-59: Transform songs for database — capture album_id, release_date,
    // album_name, and album_image_url from the liked-tracks response
    // (album object is included at no extra API cost)
    const songsToInsert = songsInChunk.flatMap(item => {
      const track = item.track;
      return track.artists.map((artist: any) => ({
        user_id: user.id,
        spotify_track_id: track.id,
        spotify_artist_id: artist.id,
        track_name: track.name,
        artist_name: artist.name,
        added_at: item.added_at,
        spotify_album_id: track.album?.id ?? null,
        spotify_album_name: track.album?.name ?? null,
        spotify_album_release_date: track.album?.release_date ?? null,
        spotify_album_image_url: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? null,
      }));
    });

    const transformTime = ((Date.now() - transformStartTime) / 1000).toFixed(2);
    const upsertStartTime = Date.now();

    // Batch upsert
    const batchSize = 1000;
    let upsertSuccessCount = 0;
    let upsertErrorCount = 0;
    
    for (let i = 0; i < songsToInsert.length; i += batchSize) {
      const batch = songsToInsert.slice(i, i + batchSize);
      const { error: upsertError } = await supabase
        .from('user_spotify_songs')
        .upsert(batch, { 
          onConflict: 'user_id,spotify_track_id,spotify_artist_id',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error(`❌ Error upserting batch:`, upsertError);
        upsertErrorCount++;
      } else {
        upsertSuccessCount++;
      }
    }

    const upsertTime = ((Date.now() - upsertStartTime) / 1000).toFixed(2);
    
    console.log(`💾 Transform: ${transformTime}s | Upsert: ${upsertTime}s (${upsertSuccessCount} batches OK, ${upsertErrorCount} errors)`);

    // Update progress
    const newSongsFetched = tokenData.songs_fetched + songsInChunk.length;
    const isComplete = !nextUrl;
    
    // Calculate cumulative API requests
    const totalApiRequests = (tokenData.total_api_requests || 0) + requestCount;

    const updateData: any = {
      songs_fetched: newSongsFetched,
      last_fetch_url: nextUrl,
      status: isComplete ? 'complete' : 'processing',
      error_message: null,
      total_api_requests: totalApiRequests,
      total_records_created: songsToInsert.length,
      updated_at: new Date().toISOString()
    };

    if (isComplete) {
      updateData.fetch_completed_at = new Date().toISOString();
      
      const totalDuration = tokenData.fetch_started_at 
        ? ((Date.now() - new Date(tokenData.fetch_started_at).getTime()) / 1000).toFixed(2)
        : '0';
      
      console.log(`\n🎉 SPOTIFY FETCH COMPLETE:`);
      console.log(`   - Songs fetched: ${newSongsFetched}`);
      console.log(`   - API requests: ${totalApiRequests}`);
      console.log(`   - Total duration: ${totalDuration}s`);
      console.log(`   - Records created: ${songsToInsert.length}`);
      console.log(`   - User: ${user.id}\n`);
    }

    await supabase
      .from('user_spotify_tokens')
      .update(updateData)
      .eq('user_id', user.id);

    // SCRUM-57: Derive and store spotify_first_year on fetch completion (new users).
    // Existing users were backfilled via the ALTER TABLE migration SQL.
    // Uses the oldest added_at across all songs now in the DB for this user.
    if (isComplete) {
      const { data: earliest } = await supabase
        .from('user_spotify_songs')
        .select('added_at')
        .eq('user_id', user.id)
        .not('added_at', 'is', null)
        .order('added_at', { ascending: true })
        .limit(1)
        .single();
      if (earliest?.added_at) {
        const firstYear = new Date(earliest.added_at).getFullYear();
        await supabase
          .from('user_profiles')
          .update({ spotify_first_year: firstYear })
          .eq('user_id', user.id);
        console.log(`📅 spotify_first_year = ${firstYear} for user ${user.id}`);
      }
    }

    console.log(`✅ Progress: ${newSongsFetched} songs fetched${isComplete ? ' - COMPLETE' : ''}`);

    return NextResponse.json({
      status: isComplete ? 'complete' : 'processing',
      songs_fetched: newSongsFetched,
      total_songs: tokenData.total_songs || newSongsFetched,
      has_more: !isComplete
    });

  } catch (error) {
    console.error('❌ Spotify fetch error:', error);
    
    // Try to mark as error in database
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user) {
        await supabase
          .from('user_spotify_tokens')
          .update({ 
            status: 'error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);
      }
    } catch (dbError) {
      console.error('Failed to update error status:', dbError);
    }

    return NextResponse.json({ 
      error: 'Failed to fetch Spotify songs',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
