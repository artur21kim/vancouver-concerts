import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's Spotify fetch status
    const { data: tokenData, error: tokenError } = await supabase
      .from('user_spotify_tokens')
      .select('status, songs_fetched, total_songs, error_message')
      .eq('user_id', user.id)
      .single();

    if (tokenError || !tokenData) {
      return NextResponse.json({ 
        status: 'not_connected',
        songs_fetched: 0,
        total_songs: 0
      });
    }

    return NextResponse.json({
      status: tokenData.status,
      songs_fetched: tokenData.songs_fetched,
      total_songs: tokenData.total_songs,
      error_message: tokenData.error_message,
      progress_percentage: tokenData.total_songs > 0 
        ? Math.round((tokenData.songs_fetched / tokenData.total_songs) * 100)
        : 0
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    return NextResponse.json({ 
      error: 'Failed to check status'
    }, { status: 500 });
  }
}
