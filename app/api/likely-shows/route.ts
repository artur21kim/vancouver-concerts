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

    // Get all user venue statuses
    const { data: userVenues, error: venuesError } = await supabase
      .from('user_venues')
      .select('venue_id, status')
      .eq('user_id', user.id);

    if (venuesError) {
      console.error('Error fetching user venues:', venuesError);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    // Build a set of venues the user explicitly said 'no' to — these are the only ones we exclude
    const noVenueIds = new Set(
      (userVenues || [])
        .filter(v => v.status === 'no')
        .map(v => v.venue_id)
    );

    console.log(`🚫 Excluding ${noVenueIds.size} venues user said 'no' to`);

    // Get user's Spotify artists
    const { data: userSongs, error: songsError } = await supabase
      .from('user_spotify_songs')
      .select('spotify_artist_id')
      .eq('user_id', user.id);

    if (songsError) {
      return NextResponse.json({ error: 'Failed to fetch Spotify data' }, { status: 500 });
    }

    if (!userSongs || userSongs.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, message: 'No Spotify data found. Please connect your Spotify account.' }
      });
    }

    const artistSongCounts = userSongs.reduce((acc: any, song: any) => {
      const artistId = song.spotify_artist_id;
      if (!acc[artistId]) acc[artistId] = 0;
      acc[artistId]++;
      return acc;
    }, {});

    // Filter to artists with >= 2 liked songs to reduce noise
    const uniqueSpotifyArtistIds = Object.keys(artistSongCounts)
      .filter(id => artistSongCounts[id] >= 2);

    if (uniqueSpotifyArtistIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, message: 'Not enough Spotify data to generate matches. Try liking more songs.' }
      });
    }

    // Match Spotify artists to Vancouver artists
    const { data: matchedArtists, error: artistsError } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, spotify_artist_id')
      .in('spotify_artist_id', uniqueSpotifyArtistIds);

    if (artistsError) {
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, message: 'No matching artists found.' }
      });
    }

    const matchedArtistIds = matchedArtists.map(a => a.artist_id);

    // Get user's first concert year
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    const firstConcertYear = profile?.first_concert_year || 2000;

    // Fetch ALL shows for matched artists from first_concert_year onwards
    // No venue filter here — we'll filter out 'no' venues in code
    const { data: shows, error: showsError } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        artist_id,
        venue_id,
        dim_artist!inner (
          artist_id,
          artist_name
        ),
        dim_venue!inner (
          venue_id,
          venue_name
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

    // Fetch show IDs to exclude:
    // 1. Already in user_shows with status = 'attended' (added from any source)
    // 2. Already in user_show_reviews with status = 'skipped' (explicitly skipped)
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

    // Save likely_shows_total to user_profiles
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
