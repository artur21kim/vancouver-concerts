import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🎯 Fetching likely shows for user: ${user.id}`);
    const startTime = Date.now();

    // Get user's confirmed venues (yes or not_sure)
    const { data: userVenues, error: venuesError } = await supabase
      .from('user_venues')
      .select('venue_id, status')
      .eq('user_id', user.id)
      .in('status', ['yes', 'not_sure']);

    if (venuesError) {
      console.error('Error fetching user venues:', venuesError);
      return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
    }

    if (!userVenues || userVenues.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          shows: [],
          total_shows: 0,
          message: 'No confirmed venues. Please confirm venues first.'
        }
      });
    }

    const confirmedVenueIds = userVenues.map(v => v.venue_id);
    console.log(`📍 User confirmed ${confirmedVenueIds.length} venues`);

    // Get user's Spotify artists
    const { data: userSongs, error: songsError } = await supabase
      .from('user_spotify_songs')
      .select('spotify_artist_id')
      .eq('user_id', user.id);

    if (songsError) {
      console.error('Error fetching user songs:', songsError);
      return NextResponse.json({ error: 'Failed to fetch Spotify data' }, { status: 500 });
    }

    if (!userSongs || userSongs.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          shows: [],
          total_shows: 0,
          message: 'No Spotify data found. Please connect your Spotify account.'
        }
      });
    }

    // Count songs per artist for Spotify score
    const artistSongCounts = userSongs.reduce((acc: any, song: any) => {
      const artistId = song.spotify_artist_id;
      if (!acc[artistId]) acc[artistId] = 0;
      acc[artistId]++;
      return acc;
    }, {});

    const uniqueSpotifyArtistIds = Object.keys(artistSongCounts);
    console.log(`🎵 User has ${userSongs.length} liked songs from ${uniqueSpotifyArtistIds.length} unique artists`);

    // Match Spotify artists to Vancouver artists
    const { data: matchedArtists, error: artistsError } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, spotify_artist_id')
      .in('spotify_artist_id', uniqueSpotifyArtistIds);

    if (artistsError) {
      console.error('Error matching artists:', artistsError);
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          shows: [],
          total_shows: 0,
          message: 'No matching artists found.'
        }
      });
    }

    const matchedArtistIds = matchedArtists.map(a => a.artist_id);
    console.log(`✅ Matched ${matchedArtistIds.length} artists`);

    // Get user's first concert year
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    const firstConcertYear = profile?.first_concert_year || 2000;

    // Fetch shows matching criteria
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
      .in('venue_id', confirmedVenueIds)
      .gte('date', `${firstConcertYear}-01-01`);

    if (showsError) {
      console.error('Error fetching shows:', showsError);
      return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
    }

    if (!shows || shows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          shows: [],
          total_shows: 0,
          message: 'No shows found matching your criteria.'
        }
      });
    }

    // Transform shows data
    const transformedShows = shows.map((show: any) => {
      const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist;
      const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue;
      return {
        show_id: show.show_id,
        date: show.date,
        artist_id: artist.artist_id,
        artist_name: artist.artist_name,
        venue_id: venue.venue_id,
        venue_name: venue.venue_name,
        spotify_artist_id: artist.spotify_artist_id
      };
    });

    // Calculate match scores
    const artistShowCounts = transformedShows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    const maxSpotifyCount = Math.max(...Object.values(artistSongCounts) as number[]);
    const maxVancouverCount = Math.max(...Object.values(artistShowCounts) as number[]);

    const artistMatchScores = matchedArtists.reduce((acc: any, artist: any) => {
      const spotifyCount = artistSongCounts[artist.spotify_artist_id] || 0;
      const vancouverCount = artistShowCounts[artist.artist_id] || 0;
      const spotifyScore = (spotifyCount / maxSpotifyCount) * 100;
      const vancouverScore = (vancouverCount / maxVancouverCount) * 100;
      const matchScore = (0.7 * spotifyScore) + (0.3 * vancouverScore);
      acc[artist.artist_id] = {
        match_score: matchScore,
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

    // Fetch existing review decisions from user_show_reviews
    const showIds = showsWithScores.map(s => s.show_id);
    const { data: existingReviews } = await supabase
      .from('user_show_reviews')
      .select('show_id, status')
      .eq('user_id', user.id)
      .in('show_id', showIds);

    // Build a status map from saved reviews
    const reviewStatusMap = (existingReviews || []).reduce((acc: any, r: any) => {
      acc[r.show_id] = r.status; // 'added' or 'skipped'
      return acc;
    }, {});

    // Attach saved status to each show — pending if no review exists
    const showsWithStatus = showsWithScores.map(show => ({
      ...show,
      status: (reviewStatusMap[show.show_id] || 'pending') as 'added' | 'skipped' | 'pending'
    }));

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ LIKELY SHOWS COMPLETE`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Confirmed venues: ${confirmedVenueIds.length}`);
    console.log(`   Matched artists: ${matchedArtistIds.length}`);
    console.log(`   Total shows: ${showsWithStatus.length}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Save likely_shows_total count to user_profiles
    await supabase
      .from('user_profiles')
      .update({ likely_shows_total: showsWithStatus.length })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        shows: showsWithStatus,
        total_shows: showsWithStatus.length,
        confirmed_venues: confirmedVenueIds.length,
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
