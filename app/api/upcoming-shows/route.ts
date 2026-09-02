import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope') || 'spotify'; // 'spotify' | 'all'

    console.log(`🎯 Fetching upcoming shows for user: ${user.id} (scope: ${scope})`);
    const startTime = Date.now();

    // GP-127: Fetch city preference alongside matched artists
    const [
      { data: matchedArtists, error: artistsError },
      { data: prefData },
    ] = await Promise.all([
      supabase.rpc('get_user_matched_artists', { p_user_id: user.id, p_min_song_count: 1 }),
      supabase.from('user_profiles').select('preferred_cities').eq('user_id', user.id).single(),
    ]);

    const preferredCities: string[] | null = (prefData as any)?.preferred_cities ?? null

    if (artistsError) {
      console.error('Matched artists RPC error:', artistsError);
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    // Get today's date in Vancouver time
    const todayVancouver = new Date().toLocaleDateString('en-CA', {
      timeZone: 'America/Vancouver',
    });

    // Build lookup maps from RPC results
    const matchedArtistIds = (matchedArtists || []).map((a: any) => a.artist_id);

    const artistSongCounts: Record<string, number> = {};
    for (const row of (matchedArtists || [])) {
      artistSongCounts[row.spotify_artist_id] = Number(row.song_count);
    }

    // Build set of matched artist_ids for quick lookup
    const matchedArtistIdSet = new Set(matchedArtistIds);

    // Build spotify_artist_id lookup by artist_id
    const artistSpotifyIdMap: Record<number, string> = {};
    for (const a of (matchedArtists || [])) {
      artistSpotifyIdMap[a.artist_id] = a.spotify_artist_id;
    }

    let shows: any[] = [];

    // GP-127: city added to dim_venue select for city preference filtering
    // SCRUM-84: latitude + longitude added for map view
    // GP-205: kexp_url + kexp_session_count added for KEXP icon
    const artistSelect = `
      artist_id,
      artist_name,
      spotify_artist_id,
      kexp_url,
      kexp_session_count
    `;

    const venueSelect = `
      venue_id,
      venue_name,
      capacity,
      capacity_category,
      latitude,
      longitude,
      city
    `;

    if (scope === 'all') {
      const { data: allShows, error: showsError } = await supabase
        .from('fact_shows')
        .select(`
          show_id,
          date,
          artist_id,
          venue_id,
          ticketmaster_url,
          dim_artist!inner (
            ${artistSelect}
          ),
          dim_venue!inner (
            ${venueSelect}
          )
        `)
        .gte('date', todayVancouver)
        .order('date', { ascending: true });

      if (showsError) {
        console.error('Shows fetch error:', showsError);
        return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
      }

      shows = allShows || [];
    } else {
      if (matchedArtistIds.length === 0) {
        return NextResponse.json({
          success: true,
          data: { shows: [], total_shows: 0, matched_artists: 0, message: 'No matching artists found.' }
        });
      }

      const { data: spotifyShows, error: showsError } = await supabase
        .from('fact_shows')
        .select(`
          show_id,
          date,
          artist_id,
          venue_id,
          ticketmaster_url,
          dim_artist!inner (
            ${artistSelect}
          ),
          dim_venue!inner (
            ${venueSelect}
          )
        `)
        .in('artist_id', matchedArtistIds)
        .gte('date', todayVancouver)
        .order('date', { ascending: true });

      if (showsError) {
        console.error('Shows fetch error:', showsError);
        return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
      }

      shows = spotifyShows || [];
    }

    if (shows.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], total_shows: 0, matched_artists: matchedArtistIds.length, message: 'No upcoming shows found.' }
      });
    }

    const showIds = shows.map((s: any) => s.show_id);

    const { data: existingReviews } = await supabase
      .from('user_show_reviews')
      .select('show_id, status')
      .eq('user_id', user.id)
      .in('show_id', showIds);

    const reviewStatusMap = (existingReviews || []).reduce((acc: any, review: any) => {
      acc[review.show_id] = review.status;
      return acc;
    }, {});

    const transformedShows = shows.map((show: any) => {
      const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist;
      const venue  = Array.isArray(show.dim_venue)  ? show.dim_venue[0]  : show.dim_venue;
      const isSpotifyMatch = matchedArtistIdSet.has(artist.artist_id);

      return {
        show_id:            show.show_id,
        date:               show.date,
        artist_id:          artist.artist_id,
        artist_name:        artist.artist_name,
        spotify_artist_id:  artistSpotifyIdMap[artist.artist_id] || artist.spotify_artist_id || null,
        kexp_url:           artist.kexp_url           ?? null,
        kexp_session_count: artist.kexp_session_count ?? null,
        venue_id:           venue.venue_id,
        venue_name:        venue.venue_name,
        capacity:          venue.capacity          || null,
        capacity_category: venue.capacity_category || null,
        latitude:          venue.latitude          ?? null,
        longitude:         venue.longitude         ?? null,
        city:              venue.city              ?? null,
        ticketmaster_url:  show.ticketmaster_url   || null,
        status:            (reviewStatusMap[show.show_id] || 'pending') as 'pending' | 'added' | 'skipped',
        is_spotify_match:  isSpotifyMatch,
      };
    });

    const artistShowCounts = transformedShows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    const maxSpotifyCount = Object.keys(artistSongCounts).length > 0
      ? Math.max(...(Object.values(artistSongCounts) as number[]))
      : 1;
    const maxVancouverCount = Math.max(...(Object.values(artistShowCounts) as number[]), 1);

    const artistMatchScores = (matchedArtists || []).reduce((acc: any, artist: any) => {
      const spotifyCount   = artistSongCounts[artist.spotify_artist_id] || 0;
      const vancouverCount = artistShowCounts[artist.artist_id] || 0;
      const spotifyScore   = (spotifyCount   / maxSpotifyCount)   * 100;
      const vancouverScore = (vancouverCount / maxVancouverCount) * 100;
      acc[artist.artist_id] = {
        match_score:          (0.7 * spotifyScore) + (0.3 * vancouverScore),
        spotify_song_count:   spotifyCount,
        vancouver_show_count: vancouverCount,
      };
      return acc;
    }, {});

    const showsWithScores = transformedShows.map(show => ({
      ...show,
      match_score:          artistMatchScores[show.artist_id]?.match_score          || 0,
      spotify_song_count:   artistMatchScores[show.artist_id]?.spotify_song_count   || 0,
      vancouver_show_count: artistMatchScores[show.artist_id]?.vancouver_show_count || 0,
    }));

    // GP-127: Apply city preference filter (null preference = all cities)
    const cityFiltered = preferredCities && preferredCities.length > 0
      ? showsWithScores.filter((s: any) => s.city && preferredCities.includes(s.city))
      : showsWithScores

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ UPCOMING SHOWS COMPLETE — ${cityFiltered.length} shows${preferredCities ? ` (filtered to ${preferredCities.join(', ')})` : ''} in ${duration}s (scope: ${scope})`);

    return NextResponse.json({
      success: true,
      data: {
        shows:           cityFiltered,
        total_shows:     cityFiltered.length,
        matched_artists: matchedArtistIds.length,
        scope,
      }
    });

  } catch (error) {
    console.error('❌ Upcoming shows error:', error);
    return NextResponse.json({
      error:   'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
