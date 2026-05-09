import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function getVancouverYesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log(`🎯 Starting matching algorithm for user: ${user.id}`);
    const startTime = Date.now();

    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    if (profileError || !profile?.first_concert_year) {
      return NextResponse.json({ 
        error: 'First concert year not found. Please complete the Discover setup.' 
      }, { status: 400 });
    }

    const firstConcertYear = profile.first_concert_year;
    const yesterdayVancouver = getVancouverYesterday();

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
        error: 'No Spotify data found or no artists matched Vancouver shows.' 
      }, { status: 400 });
    }

    // Build song count lookup from RPC results
    const artistSongCounts: Record<string, number> = {};
    for (const row of matchedArtists) {
      artistSongCounts[row.spotify_artist_id] = Number(row.song_count);
    }

    const matchedArtistIds = matchedArtists.map((a: any) => a.artist_id);

    console.log(`📊 ${matchedArtists.length} artists matched with >= 2 liked songs`);

    // Fetch shows within the user's concert history window, up to yesterday
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
      .gte('date', `${firstConcertYear}-01-01`)
      .lte('date', yesterdayVancouver)
      .limit(5000);

    if (showsError) {
      return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
    }

    if (!shows || shows.length === 0) {
      return NextResponse.json({ 
        error: `No shows found for your artists from ${firstConcertYear} onwards.` 
      }, { status: 404 });
    }

    // Count shows per artist (excluding 'no' venues)
    const artistShowCountsFiltered = shows.reduce((acc: any, show: any) => {
      if (noVenueIds.has(show.venue_id)) return acc;
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    const artistShowCountsAll = shows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    // Only include artists who actually have shows in the valid date range
    const artistsWithShows = matchedArtists.filter(
      (a: any) => (artistShowCountsAll[a.artist_id] || 0) > 0
    );

    if (artistsWithShows.length === 0) {
      return NextResponse.json({ 
        error: `No shows found for your artists from ${firstConcertYear} onwards.` 
      }, { status: 404 });
    }

    const maxSpotifyCount = Math.max(...artistsWithShows.map((a: any) => artistSongCounts[a.spotify_artist_id] || 0));
    const maxVancouverCountFiltered = Math.max(...artistsWithShows.map((a: any) => artistShowCountsFiltered[a.artist_id] || 0), 1);
    const maxVancouverCountAll = Math.max(...artistsWithShows.map((a: any) => artistShowCountsAll[a.artist_id] || 0), 1);

    const scoredArtists = artistsWithShows.map((artist: any) => {
      const spotifyCount = artistSongCounts[artist.spotify_artist_id] || 0;
      const vancouverCountFiltered = artistShowCountsFiltered[artist.artist_id] || 0;
      const vancouverCountAll = artistShowCountsAll[artist.artist_id] || 0;

      const spotifyScore = (spotifyCount / maxSpotifyCount) * 100;
      const vancouverScoreFiltered = (vancouverCountFiltered / maxVancouverCountFiltered) * 100;
      const vancouverScoreAll = (vancouverCountAll / maxVancouverCountAll) * 100;

      const weightedScoreFiltered = (0.8 * spotifyScore) + (0.2 * vancouverScoreFiltered);
      const weightedScoreAll = (0.8 * spotifyScore) + (0.2 * vancouverScoreAll);

      return {
        artist_id: artist.artist_id,
        artist_name: artist.artist_name,
        spotify_artist_id: artist.spotify_artist_id,
        spotify_song_count: spotifyCount,
        vancouver_show_count: vancouverCountFiltered,
        vancouver_show_count_all: vancouverCountAll,
        match_score: Math.round(weightedScoreFiltered * 10) / 10,
        match_score_all: Math.round(weightedScoreAll * 10) / 10,
      };
    });

    const currentRunArtists = [...scoredArtists].sort((a, b) => b.match_score - a.match_score);
    const allArtists = [...scoredArtists].sort((a, b) => b.match_score_all - a.match_score_all);

    // Build venue scores
    const venueScores: any = {};

    shows.forEach((show: any) => {
      if (noVenueIds.has(show.venue_id)) return;
      const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue;
      const venueId = venue.venue_id;
      const artist = scoredArtists.find((a: any) => a.artist_id === show.artist_id);

      if (!venueScores[venueId]) {
        venueScores[venueId] = {
          venue_id: venueId,
          venue_name: venue.venue_name,
          capacity: venue.capacity || null,
          capacity_category: venue.capacity_category || null,
          total_shows: 0,
          unique_artists: new Set(),
          raw_score: 0,
        };
      }

      venueScores[venueId].total_shows++;
      venueScores[venueId].unique_artists.add(show.artist_id);
      if (artist) venueScores[venueId].raw_score += artist.match_score;
    });

    const rawScores = Object.values(venueScores).map((v: any) => v.raw_score);
    const maxRawScore = Math.max(...rawScores, 1);

    const allRankedVenues = Object.values(venueScores)
      .map((venue: any) => ({
        venue_id: venue.venue_id,
        venue_name: venue.venue_name,
        capacity: venue.capacity,
        capacity_category: venue.capacity_category,
        total_shows: venue.total_shows,
        unique_artists: venue.unique_artists.size,
        match_score: Math.round((venue.raw_score / maxRawScore) * 1000) / 10,
        user_status: userVenueStatusMap[venue.venue_id] || null,
      }))
      .sort((a: any, b: any) => b.match_score - a.match_score);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ MATCHING COMPLETE — ${artistsWithShows.length} artists, ${shows.length} shows, ${Object.keys(venueScores).length} venues in ${duration}s`);

    await supabase
      .from('user_profiles')
      .update({ spotify_matched_shows: shows.length })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        first_concert_year: firstConcertYear,
        upper_bound_date: yesterdayVancouver,
        matched_artists_count: artistsWithShows.length,
        total_spotify_artists: matchedArtists.length,
        total_shows_count: shows.length,
        total_venues_matched: Object.keys(venueScores).length,
        top_artists: currentRunArtists.slice(0, 15),
        all_artists: allArtists,
        all_venues: allRankedVenues,
        duration_seconds: parseFloat(duration),
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
