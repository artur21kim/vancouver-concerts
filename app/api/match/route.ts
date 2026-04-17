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

    console.log(`🎯 Starting matching algorithm for user: ${user.id}`);
    const startTime = Date.now();

    // Get user's first_concert_year
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile?.first_concert_year) {
      return NextResponse.json({ 
        error: 'First concert year not found. Please complete the questionnaire.' 
      }, { status: 400 });
    }

    const firstConcertYear = profile.first_concert_year;
    console.log(`📅 First concert year: ${firstConcertYear}`);

    // STEP 1: Get user's Spotify artists and count liked songs per artist
    const { data: userSongs, error: songsError } = await supabase
      .from('user_spotify_songs')
      .select('spotify_artist_id, artist_name')
      .eq('user_id', user.id);

    if (songsError) {
      console.error('Error fetching user songs:', songsError);
      return NextResponse.json({ error: 'Failed to fetch user songs' }, { status: 500 });
    }

    if (!userSongs || userSongs.length === 0) {
      return NextResponse.json({ 
        error: 'No Spotify data found. Please connect your Spotify account.' 
      }, { status: 400 });
    }

    // Count songs per artist (Spotify score)
    const artistSongCounts = userSongs.reduce((acc: any, song: any) => {
      const artistId = song.spotify_artist_id;
      if (!acc[artistId]) {
        acc[artistId] = { count: 0, name: song.artist_name };
      }
      acc[artistId].count++;
      return acc;
    }, {});

    const uniqueSpotifyArtistIds = Object.keys(artistSongCounts);
    console.log(`🎵 User has ${userSongs.length} liked songs from ${uniqueSpotifyArtistIds.length} unique artists`);

    // STEP 2: Match to Vancouver artists and get show counts
    const { data: matchedArtists, error: artistsError } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, spotify_artist_id')
      .in('spotify_artist_id', uniqueSpotifyArtistIds);

    if (artistsError) {
      console.error('Error fetching matched artists:', artistsError);
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({ 
        error: 'No artists matched. None of your Spotify artists have played in Vancouver.' 
      }, { status: 404 });
    }

    console.log(`✅ Matched ${matchedArtists.length} artists to Vancouver concert history`);

    const matchedArtistIds = matchedArtists.map(a => a.artist_id);

    // STEP 3: Get shows for matched artists from first_concert_year onwards
    const { data: shows, error: showsError } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        artist_id,
        venue_id,
        dim_venue!inner (
          venue_id,
          venue_name
        )
      `)
      .in('artist_id', matchedArtistIds)
      .gte('date', `${firstConcertYear}-01-01`);

    if (showsError) {
      console.error('Error fetching shows:', showsError);
      return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
    }

    if (!shows || shows.length === 0) {
      return NextResponse.json({ 
        error: `No shows found for your artists from ${firstConcertYear} onwards.` 
      }, { status: 404 });
    }

    console.log(`🎪 Found ${shows.length} shows from ${firstConcertYear} onwards`);

    // STEP 4: Calculate scores
    
    // Count shows per artist (Vancouver score)
    const artistShowCounts = shows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) {
        acc[show.artist_id] = 0;
      }
      acc[show.artist_id]++;
      return acc;
    }, {});

    // Create artist score map
    const artistScores = matchedArtists.map(artist => {
      const spotifyCount = artistSongCounts[artist.spotify_artist_id]?.count || 0;
      const vancouverCount = artistShowCounts[artist.artist_id] || 0;

      return {
        artist_id: artist.artist_id,
        artist_name: artist.artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        spotify_song_count: spotifyCount,
        vancouver_show_count: vancouverCount
      };
    });

    // Normalize scores (0-100 scale)
    const maxSpotifyCount = Math.max(...artistScores.map(a => a.spotify_song_count));
    const maxVancouverCount = Math.max(...artistScores.map(a => a.vancouver_show_count));

    const scoredArtists = artistScores.map(artist => {
      const spotifyScore = (artist.spotify_song_count / maxSpotifyCount) * 100;
      const vancouverScore = (artist.vancouver_show_count / maxVancouverCount) * 100;
      
      // Weighted score: 60% Spotify + 40% Vancouver
      const weightedScore = (0.6 * spotifyScore) + (0.4 * vancouverScore);

      return {
        ...artist,
        spotify_score: spotifyScore,
        vancouver_score: vancouverScore,
        weighted_score: weightedScore
      };
    }).sort((a, b) => b.weighted_score - a.weighted_score);

    // STEP 5: Group by venue and calculate venue scores
    const venueScores: any = {};

    shows.forEach((show: any) => {
      const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue;
      const venueId = venue.venue_id;
      const venueName = venue.venue_name;
      
      const artist = scoredArtists.find(a => a.artist_id === show.artist_id);
      
      if (!venueScores[venueId]) {
        venueScores[venueId] = {
          venue_id: venueId,
          venue_name: venueName,
          total_shows: 0,
          unique_artists: new Set(),
          total_score: 0
        };
      }

      venueScores[venueId].total_shows++;
      venueScores[venueId].unique_artists.add(show.artist_id);
      
      if (artist) {
        venueScores[venueId].total_score += artist.weighted_score;
      }
    });

    // Convert to array and calculate final venue scores
    const rankedVenues = Object.values(venueScores).map((venue: any) => ({
      venue_id: venue.venue_id,
      venue_name: venue.venue_name,
      total_shows: venue.total_shows,
      unique_artists: venue.unique_artists.size,
      average_artist_score: venue.total_score / venue.total_shows,
      venue_score: venue.total_score // Total weighted score from all artists
    }))
    .sort((a: any, b: any) => b.venue_score - a.venue_score)
    .slice(0, 15); // Top 15 venues

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ MATCHING COMPLETE`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Matched artists: ${matchedArtists.length}`);
    console.log(`   Total shows: ${shows.length}`);
    console.log(`   Top venues: ${rankedVenues.length}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return NextResponse.json({
      success: true,
      data: {
        first_concert_year: firstConcertYear,
        matched_artists_count: matchedArtists.length,
        total_shows_count: shows.length,
        top_artists: scoredArtists.slice(0, 20), // Top 20 artists for reference
        top_venues: rankedVenues,
        duration_seconds: parseFloat(duration)
      }
    });

  } catch (error) {
    console.error('❌ Matching algorithm error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
