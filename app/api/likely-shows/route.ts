import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Thresholds derived from data analysis
const MIN_SONGS_MAIN = 3;        // ≥3 liked songs for main list
const MIN_SCORE_MAIN = 10.0;     // ≥10% normalized score for main list
const MIN_SCORE_LESS_LIKELY = 1.0; // ≥1% for Less Likely (anything below is Stretch)

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

    // Load locked scores from first run
    const { data: lockedScores, error: scoresError } = await supabase
      .from('user_artist_scores')
      .select('artist_id, spotify_song_count, normalized_score')
      .eq('user_id', user.id);

    const hasLockedScores = !scoresError && lockedScores && lockedScores.length > 0;

    // Build score lookup maps
    const lockedScoreMap: Record<number, number> = {};
    const lockedSongCountMap: Record<number, number> = {};
    if (hasLockedScores) {
      for (const row of lockedScores) {
        lockedScoreMap[row.artist_id] = Number(row.normalized_score);
        lockedSongCountMap[row.artist_id] = Number(row.spotify_song_count);
      }
    }

    // Fall back to live RPC if no locked scores yet (first run before match completes)
    const { data: matchedArtists, error: matchError } = await supabase
      .rpc('get_user_matched_artists', { p_user_id: user.id, p_min_song_count: 2 });

    if (matchError) {
      console.error('Matched artists RPC error:', matchError);
      return NextResponse.json({ error: 'Failed to match artists' }, { status: 500 });
    }

    if (!matchedArtists || matchedArtists.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], less_likely_shows: [], total_shows: 0, message: 'No Spotify data found or no artists matched Vancouver shows.' }
      });
    }

    const artistSongCounts: Record<string, number> = {};
    for (const row of matchedArtists) {
      artistSongCounts[row.spotify_artist_id] = Number(row.song_count);
    }

    console.log(`📊 ${matchedArtists.length} artists matched with >= 2 liked songs`);

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('first_concert_year')
      .eq('user_id', user.id)
      .single();

    const firstConcertYear = profile?.first_concert_year || 2000;

    // Use RPC to fetch shows server-side — avoids .in() URL length limits which
    // silently truncate large artist ID arrays, causing missing artists in results.
    const { data: shows, error: showsError } = await supabase
      .rpc('get_user_matched_shows', {
        p_user_id: user.id,
        p_min_song_count: 2,
        p_from_date: `${firstConcertYear}-01-01`,
        p_to_date: new Date().toISOString().split('T')[0],
      })
      .range(0, 49999);

    if (showsError) {
      console.error('Shows RPC error:', showsError);
      return NextResponse.json({ error: 'Failed to fetch shows' }, { status: 500 });
    }

    console.log(`🔍 shows array length RAW:`, shows?.length);

    if (!shows || shows.length === 0) {
      return NextResponse.json({
        success: true,
        data: { shows: [], less_likely_shows: [], total_shows: 0, message: 'No shows found matching your criteria.' }
      });
    }

    console.log(`📍 Fetched ${shows.length} shows via get_user_matched_shows RPC`);

    // Fetch show IDs to exclude (already reviewed)
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

    // Transform and filter — RPC already joins artist/venue so shape is flat
    const transformedShows = shows
      .filter((show: any) => !noVenueIds.has(show.venue_id) && !excludedShowIds.has(show.show_id))
      .map((show: any) => ({
        show_id: show.show_id,
        date: show.date,
        artist_id: show.artist_id,
        artist_name: show.artist_name,
        venue_id: show.venue_id,
        venue_name: show.venue_name,
        capacity_category: show.capacity_category ?? null,
        spotify_artist_id: show.spotify_artist_id,
        status: 'pending' as const
      }));

    // Calculate match scores
    const artistShowCounts = transformedShows.reduce((acc: any, show: any) => {
      if (!acc[show.artist_id]) acc[show.artist_id] = 0;
      acc[show.artist_id]++;
      return acc;
    }, {});

    let artistMatchScores: Record<number, {
      match_score: number;
      spotify_song_count: number;
      vancouver_show_count: number;
    }> = {};

    if (hasLockedScores) {
      // Use locked normalized scores — stable across re-runs
      for (const artist of matchedArtists) {
        const lockedScore = lockedScoreMap[artist.artist_id];
        const lockedSongs = lockedSongCountMap[artist.artist_id];
        if (lockedScore !== undefined) {
          artistMatchScores[artist.artist_id] = {
            match_score: lockedScore,
            spotify_song_count: lockedSongs ?? artistSongCounts[artist.spotify_artist_id] ?? 0,
            vancouver_show_count: artistShowCounts[artist.artist_id] || 0,
          };
        }
      }
    } else {
      // First run before scores locked — compute live
      const maxSpotifyCount = Math.max(...Object.values(artistSongCounts) as number[]);
      const maxVancouverCount = Math.max(...(Object.values(artistShowCounts) as number[]), 1);

      artistMatchScores = matchedArtists.reduce((acc: any, artist: any) => {
        const spotifyCount = artistSongCounts[artist.spotify_artist_id] || 0;
        const vancouverCount = artistShowCounts[artist.artist_id] || 0;
        const spotifyScore = (spotifyCount / maxSpotifyCount) * 100;
        const vancouverScore = (vancouverCount / maxVancouverCount) * 100;
        const rawScore = (0.8 * spotifyScore) + (0.2 * vancouverScore);
        acc[artist.artist_id] = {
          match_score: rawScore,
          spotify_song_count: spotifyCount,
          vancouver_show_count: vancouverCount
        };
        return acc;
      }, {});

      // Normalize so #1 = 100
      const maxScore = Math.max(...Object.values(artistMatchScores).map((a: any) => a.match_score), 1);
      for (const id of Object.keys(artistMatchScores)) {
        artistMatchScores[Number(id)].match_score =
          Math.round((artistMatchScores[Number(id)].match_score / maxScore) * 1000) / 10;
      }
    }

    // Attach scores and tier to each show
    const showsWithScores = transformedShows.map((show: {
      show_id: number;
      date: string;
      artist_id: number;
      artist_name: string;
      venue_id: number;
      venue_name: string;
      capacity_category: string | null;
      spotify_artist_id: string;
      status: 'pending';
    }) => {
      const scores = artistMatchScores[show.artist_id];
      const songCount = scores?.spotify_song_count ?? 0;
      const matchScore = scores?.match_score ?? 0;

      const isMain = songCount >= MIN_SONGS_MAIN && matchScore >= MIN_SCORE_MAIN;
      const isLessLikely = !isMain && matchScore >= MIN_SCORE_LESS_LIKELY;

      return {
        ...show,
        match_score: matchScore,
        spotify_song_count: songCount,
        vancouver_show_count: scores?.vancouver_show_count ?? 0,
        tier: isMain ? 'main' : isLessLikely ? 'less_likely' : 'stretch',
      };
    });

    const mainShows = showsWithScores.filter((s: any) => s.tier === 'main');
    const lessLikelyShows = showsWithScores.filter((s: any) => s.tier === 'less_likely');
    const stretchShows = showsWithScores.filter((s: any) => s.tier === 'stretch');

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ LIKELY SHOWS COMPLETE — ${mainShows.length} main, ${lessLikelyShows.length} less likely, ${stretchShows.length} stretch (${excludedShowIds.size} excluded) in ${duration}s`);

    await supabase
      .from('user_profiles')
      .update({ likely_shows_total: mainShows.length + lessLikelyShows.length })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        shows: mainShows,
        less_likely_shows: lessLikelyShows,
        stretch_shows: stretchShows,
        total_shows: mainShows.length + lessLikelyShows.length + stretchShows.length,
        matched_artists: matchedArtists.length,
        scores_source: hasLockedScores ? 'locked' : 'live',
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
