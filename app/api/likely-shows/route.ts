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

    const uniqueSpotifyArtistIds = [...new Set(userSongs.map(s => s.spotify_artist_id))];
    console.log(`🎵 User has ${uniqueSpotifyArtistIds.length} unique Spotify artists`);

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
    const { data: profile, error: profileError } = await supabase
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
        venue_name: venue.venue_name
      };
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ LIKELY SHOWS COMPLETE`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`   Confirmed venues: ${confirmedVenueIds.length}`);
    console.log(`   Matched artists: ${matchedArtistIds.length}`);
    console.log(`   Total shows: ${transformedShows.length}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    return NextResponse.json({
      success: true,
      data: {
        shows: transformedShows,
        total_shows: transformedShows.length,
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
