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

    // Get funnel stats from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('spotify_matched_shows, likely_shows_total, likely_shows_added')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    // Get total shows in My Shows (all sources)
    const { count: totalShowsCount, error: countError } = await supabase
      .from('user_shows')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'attended');

    if (countError) {
      console.error('Error counting shows:', countError);
      return NextResponse.json({ error: 'Failed to count shows' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        spotify_matched_shows: profile?.spotify_matched_shows || 0,
        likely_shows_total: profile?.likely_shows_total || 0,
        likely_shows_added: profile?.likely_shows_added || 0,
        total_shows_in_my_shows: totalShowsCount || 0
      }
    });

  } catch (error) {
    console.error('❌ Review summary error:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
