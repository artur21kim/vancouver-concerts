import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Guard: never wipe a successful completed fetch
    const { data: tokenData } = await supabase
      .from('user_spotify_tokens')
      .select('status, songs_fetched')
      .eq('user_id', user.id)
      .single();

    if (tokenData?.status === 'complete' && (tokenData?.songs_fetched ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Spotify connection already completed successfully — no reset needed.' },
        { status: 400 }
      );
    }

    // Wipe all Spotify-derived data in dependency order
    await supabase.from('user_spotify_songs').delete().eq('user_id', user.id);
    await supabase.from('user_artist_scores').delete().eq('user_id', user.id);
    await supabase.from('user_show_reviews').delete().eq('user_id', user.id);
    await supabase.from('user_shows').delete().eq('user_id', user.id);
    await supabase.from('user_venues').delete().eq('user_id', user.id);
    await supabase.from('user_spotify_tokens').delete().eq('user_id', user.id);

    // Reset profile flags
    await supabase
      .from('user_profiles')
      .update({
        spotify_connected: false,
        spotify_matched_shows: null,
        likely_shows_total: null,
        completed_past_run: false,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    console.log(`✅ Spotify self-serve reset complete for user ${user.id}`);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('❌ Spotify reset error:', error);
    return NextResponse.json(
      { error: 'Failed to reset Spotify connection' },
      { status: 500 }
    );
  }
}
