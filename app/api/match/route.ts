import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get('mode');
    const isVenueSelection = mode === 'venue-selection';

    console.log(`🎯 Starting matching algorithm for user: ${user.id} (mode: ${mode || 'default'})`);
    const startTime = Date.now();

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

    const { data: userVenues } = await supabase
      .from('user_venues')
      .select('venue_id, status')
      .eq('user_id', user.id);

    const userVenueStatusMap = (userVenues || []).reduce((acc: any, v: any) => {
      acc[v.venue_id] = v.status;
      return acc;
    }, {});

    const noVenueIds = new Set(
      (userVenues || []).filter(v => v.status === 'no').map(v => v.venue_id)
    );

    const confirmedVenueIds = new Set(
      (userVenues || []).filter(v => v.status === 'yes' || v.status === 'no').map(v => v.venue_id)
    );

    const { data: userSongs, error: songsError } = await supabase
      .from('user_spotify_songs')
      .select('spotify_artist_id, artist_name')
      .eq('user_id', user.id);

    if (songsError) {
      return NextResponse.json({ error: 'Failed to fetch user songs' }, { status: 500 });
    }

    if (!userSongs || userSongs.length === 0) {
      return NextResponse.json({ 
        error: 'No Spotify data found. Please connect your Spotify account.' 
      }, { status: 400 });
    }

    const artistSongCounts = userSongs.reduce((acc: any, song: any) => {
      const artistId = song.spotify_artist_id;
      if (!acc[artistId]) acc[artistId] = { count: 0, name: song.artist_name };
      acc[artistId].count++;
      return acc;
    }, {});

    const uniqueSpotifyArtistIds = Object.keys(artistSongCounts);

    const { data: matchedArtists, error: artistsError } = await supabase
      .from('dim_artist')
      .select('artist_id, artist_name, spotify_artist_id')
      .in('spotify_artist_id', uniqueSpotifyArtistIds);

    if (artistsError) {
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({ 
        error: 'No artists matched. None of your Spotify artists have played in Vancouver.' 
      }, { status: 404 });
    }

    const matchedArtistIds = matchedArtists.map(a => a.artist_id);

    const { data: shows, error: showsError } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        artist_id,
        venue_id,
        dim_venue!inner (
          venue_id,
          venue_name,
          capacity,
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
        error: `No shows found for your artists from ${firstConcertYear} onwards.` 
      }, { status: 404 });
    }

    const [attendedResult, skippedResult] = await Promise.all([
      supabase.from('user_shows').select('show_id').eq('user_id', user.id).eq('status', 'attended'),
      supabase.from('user_show_reviews').select('show_id').eq('user_id', user.id).eq('status', 'skipped')
    ]);

    const excludedShowIds = new Set([
      ...(attendedResult.data || []).map((s: any) => s.show_id),
      ...(skippedResult.data || []).map((s: any) => s.show_id)
    ]);

    const artistsWithPendingShows = new Set(
      shows
        .filter((show: any) => !excludedShowIds.has(show.show_id) && !noVenueIds.has(show.venue_id))
        .map((show: any) => show.artist_id)
    );

    // Filtered counts (excludes 'no' venues — current run)
    const artistShowCountsFiltered = shows.reduce((acc: any, show: any) => {
      if (noVenueIds.has(show.venue_id)) return acc;
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    // Unfiltered counts (all venues — clean slate)
    const artistShowCountsAll = shows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    const maxSpotifyCount = Math.max(...matchedArtists.map(a => artistSongCounts[a.spotify_artist_id]?.count || 0));
    const maxVancouverCountFiltered = Math.max(...matchedArtists.map(a => artistShowCountsFiltered[a.artist_id] || 0), 1);
    const maxVancouverCountAll = Math.max(...matchedArtists.map(a => artistShowCountsAll[a.artist_id] || 0), 1);

    const scoredArtists = matchedArtists.map(artist => {
      const spotifyCount = artistSongCounts[artist.spotify_artist_id]?.count || 0;
      const vancouverCountFiltered = artistShowCountsFiltered[artist.artist_id] || 0;
      const vancouverCountAll = artistShowCountsAll[artist.artist_id] || 0;

      const spotifyScore = (spotifyCount / maxSpotifyCount) * 100;
      const vancouverScoreFiltered = (vancouverCountFiltered / maxVancouverCountFiltered) * 100;
      const vancouverScoreAll = (vancouverCountAll / maxVancouverCountAll) * 100;

      return {
        artist_id: artist.artist_id,
        artist_name: artist.artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        spotify_song_count: spotifyCount,
        vancouver_show_count: vancouverCountFiltered,
        weighted_score: (0.7 * spotifyScore) + (0.3 * vancouverScoreFiltered),
        has_pending_shows: artistsWithPendingShows.has(artist.artist_id),
        vancouver_show_count_all: vancouverCountAll,
        weighted_score_all: (0.7 * spotifyScore) + (0.3 * vancouverScoreAll),
      };
    });

    const currentRunArtists = [...scoredArtists].sort((a, b) => b.weighted_score - a.weighted_score);
    // Return full list for all_artists so frontend can display any top N without cutoff
    const allArtists = [...scoredArtists].sort((a, b) => b.weighted_score_all - a.weighted_score_all);

    const venueScores: any = {};

    shows.forEach((show: any) => {
      if (noVenueIds.has(show.venue_id)) return;
      const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue;
      const venueId = venue.venue_id;
      const artist = currentRunArtists.find(a => a.artist_id === show.artist_id);

      if (!venueScores[venueId]) {
        venueScores[venueId] = {
          venue_id: venueId,
          venue_name: venue.venue_name,
          capacity: venue.capacity || null,
          capacity_category: venue.capacity_category || null,
          total_shows: 0,
          unique_artists: new Set(),
          total_score: 0
        };
      }

      venueScores[venueId].total_shows++;
      venueScores[venueId].unique_artists.add(show.artist_id);
      if (artist) venueScores[venueId].total_score += artist.weighted_score;
    });

    const allRankedVenues = Object.values(venueScores)
      .map((venue: any) => ({
        venue_id: venue.venue_id,
        venue_name: venue.venue_name,
        capacity: venue.capacity,
        capacity_category: venue.capacity_category,
        total_shows: venue.total_shows,
        unique_artists: venue.unique_artists.size,
        average_artist_score: venue.total_score / venue.total_shows,
        venue_score: venue.total_score,
        user_status: userVenueStatusMap[venue.venue_id] || null
      }))
      .sort((a: any, b: any) => b.venue_score - a.venue_score);

    const top15Venues = isVenueSelection
      ? (allRankedVenues as any[]).filter(v => !confirmedVenueIds.has(v.venue_id)).slice(0, 15)
      : (allRankedVenues as any[]).slice(0, 15);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ MATCHING COMPLETE — ${matchedArtists.length} artists, ${shows.length} shows, ${Object.keys(venueScores).length} venues in ${duration}s`);

    await supabase
      .from('user_profiles')
      .update({ spotify_matched_shows: shows.length })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        first_concert_year: firstConcertYear,
        matched_artists_count: matchedArtists.length,
        total_shows_count: shows.length,
        total_venues_matched: Object.keys(venueScores).length,
        top_artists: currentRunArtists.slice(0, 20),
        all_artists: allArtists, // Full list — frontend slices to top 15 for display
        top_venues: top15Venues,
        has_more_venues: isVenueSelection
          ? (allRankedVenues as any[]).filter(v => !confirmedVenueIds.has(v.venue_id)).length > 15
          : false,
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
