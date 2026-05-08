import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🎯 Fetching likely shows for user: ${user.id}`);
    const startTime = Date.now();

    const { data: userVenues, error: venuesError } = await supabase
      .from('user_venues')
      .select('venue_id, status')
      .eq('user_id', user.id);

    if (venuesError) {
      console.error('Error fetching user venues:', venuesError);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    const noVenueIds = new Set(
      (userVenues || [])
        .filter(v => v.status === 'no')
        .map(v => v.venue_id)
    );

    console.log(`🚫 Excluding ${noVenueIds.size} venues user said 'no' to`);

    // Single DB-side join: returns only artists in dim_artist that match
    // user's Spotify songs with >= 2 liked songs. Avoids both the 1000-row
    // fetch limit and the .in() URL length limit.
    const { data: matchedArtists, error: matchError } = await supabase
      .rpc('get_user_matched_artists', { p_user_id: user.id, p_min_song_count: 2 });

    if (matchError) {
      console.error('Matched artists RPC error:', matchError);
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, message: 'No Spotify data found or no artists matched Vancouver shows.' }
      });
    }

    // Build song count lookup from RPC results
    const artistSongCounts: Record<string, number> = {};
    for (const row of matchedArtists) {
      artistSongCounts[row.spotify_artist_id] = Number(row.song_count);
    }

    const matchedArtistIds = matchedArtists.map((a: any) => a.artist_id);

    console.log(`📊 ${matchedArtists.length} artists matched with >= 2 liked songs`);

    // Get user's first concert year
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    const firstConcertYear = profile?.first_concert_year || 2000;

    // Fetch ALL shows for matched artists from first_concert_year onwards
    const { data: shows, error: showsError } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        artist_id,
        venue_id,
        dim_artist!inner (
          artist_id,
          artist_name,
          spotify_artist_id
        ),
        dim_venue!inner (
          venue_id,
          venue_name,
          capacity_category
        )
      `)
      .in('artist_id', matchedArtistIds)
      .gte('date', `${firstConcertYear}-01-01`);

    if (showsError) {
      return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
    }

    if (!shows || shows.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, message: 'No shows found matching your criteria.' }
      });
    }

    // Fetch show IDs to exclude
    const [attendedResult, skippedResult] = await Promise.all([
      supabase
        .from('user_shows')
        .select('show_id')
        .eq('user_id', user.id)
        .eq('status', 'attended'),
      supabase
        .from('user_show_reviews')
        .select('show_id')
        .eq('user_id', user.id)
        .eq('status', 'skipped')
    ]);

    const excludedShowIds = new Set([
      ...(attendedResult.data || []).map((s: any) => s.show_id),
      ...(skippedResult.data || []).map((s: any) => s.show_id)
    ]);

    console.log(`🚫 Excluding ${excludedShowIds.size} shows (${(attendedResult.data || []).length} attended, ${(skippedResult.data || []).length} skipped)`);

    // Transform, filter out 'no' venues and excluded shows
    const transformedShows = shows
      .filter((show: any) => !noVenueIds.has(show.venue_id) && !excludedShowIds.has(show.show_id))
      .map((show: any) => {
        const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist;
        const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue;
        return {
          show_id: show.show_id,
          date: show.date,
          artist_id: artist.artist_id,
          artist_name: artist.artist_name,
          venue_id: venue.venue_id,
          venue_name: venue.venue_name,
          capacity_category: venue.capacity_category ?? null,
          spotify_artist_id: artist.spotify_artist_id,
          status: 'pending' as const
        };
      });

    // Calculate match scores
    const artistShowCounts = transformedShows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    const maxSpotifyCount = Math.max(...Object.values(artistSongCounts) as number[]);
    const maxVancouverCount = Math.max(...(Object.values(artistShowCounts) as number[]), 1);

    const artistMatchScores = matchedArtists.reduce((acc: any, artist: any) => {
      const spotifyCount = artistSongCounts[artist.spotify_artist_id] || 0;
      const vancouverCount = artistShowCounts[artist.artist_id] || 0;
      const spotifyScore = (spotifyCount / maxSpotifyCount) * 100;
      const vancouverScore = (vancouverCount / maxVancouverCount) * 100;
      acc[artist.artist_id] = {
        match_score: (0.7 * spotifyScore) + (0.3 * vancouverScore),
        spotify_song_count: spotifyCount,
        vancouver_show_count: vancouverCount
      };
      return acc;
    }, {});

    const showsWithScores = transformedShows.map(show => ({
      ...show,
      match_score: artistMatchScores[show.artist_id]?.match_score || 0,
      spotify_song_count: artistMatchScores[show.artist_id]?.spotify_song_count || 0,
      vancouver_show_count: artistMatchScores[show.artist_id]?.vancouver_show_count || 0
    }));

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ LIKELY SHOWS COMPLETE — ${showsWithScores.length} pending shows (${excludedShowIds.size} excluded) in ${duration}s`);

    await supabase
      .from('user_profiles')
      .update({ likely_shows_total: showsWithScores.length })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        shows: showsWithScores,
        total_shows: showsWithScores.length,
        matched_artists: matchedArtistIds.length
      }
    });

  } catch (error) {
    console.error('❌ Likely shows error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
