import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get funnel stats from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('spotify_matched_shows, likely_shows_total')
      .eq('user_id', user.id)
      .single();

    if (profileError) {
      console.error('Error fetching profile:', profileError);
      return NextResponse.json({ error: 'Failed to fetch profile' }, { status: 500 });
    }

    // Count added shows directly from user_show_reviews (source of truth)
    const { count: addedCount, error: addedError } = await supabase
      .from('user_show_reviews')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('source', 'likely_shows')
      .eq('status', 'added');

    if (addedError) {
      console.error('Error counting added shows:', addedError);
      return NextResponse.json({ error: 'Failed to count added shows' }, { status: 500 });
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

    // Keep user_profiles in sync
    await supabase
      .from('user_profiles')
      .update({ likely_shows_added: addedCount || 0 })
      .eq('user_id', user.id);

    return NextResponse.json({
      success: true,
      data: {
        spotify_matched_shows: profile?.spotify_matched_shows || 0,
        likely_shows_total: profile?.likely_shows_total || 0,
        likely_shows_added: addedCount || 0,
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
