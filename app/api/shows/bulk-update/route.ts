import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { show_ids, status, source = 'manual' } = body;

    if (!show_ids || !Array.isArray(show_ids) || show_ids.length === 0) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected array of show_ids.' 
      }, { status: 400 });
    }

    if (!status || !['added', 'skipped'].includes(status)) {
      return NextResponse.json({ 
        error: 'Invalid status. Expected "added" or "skipped".' 
      }, { status: 400 });
    }

    // Map status to user_shows status
    const userShowStatus = status === 'added' ? 'attended' : 'not_attended';

    // Prepare records for bulk upsert
    const records = show_ids.map(show_id => ({
      user_id: user.id,
      show_id: show_id,
      status: userShowStatus,
      source: source
    }));

    // Bulk upsert to user_shows
    const { error: upsertError } = await supabase
      .from('user_shows')
      .upsert(records, {
        onConflict: 'user_id,show_id'
      });

    if (upsertError) {
      console.error('Error bulk upserting shows:', upsertError);
      return NextResponse.json({ 
        error: 'Failed to bulk update shows',
        details: upsertError.message
      }, { status: 500 });
    }

    console.log(`✅ Bulk updated ${show_ids.length} shows to status: ${userShowStatus}, source: ${source}`);

    // Update likely_shows_added count if source is likely_shows
    if (source === 'likely_shows') {
      const increment = status === 'added' ? show_ids.length : -show_ids.length;
      
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('likely_shows_added')
        .eq('user_id', user.id)
        .single();

      const newCount = Math.max(0, (profile?.likely_shows_added || 0) + increment);
      
      await supabase
        .from('user_profiles')
        .update({ likely_shows_added: newCount })
        .eq('user_id', user.id);
    }

    return NextResponse.json({
      success: true,
      data: {
        updated_count: show_ids.length,
        status: userShowStatus,
        source
      }
    });

  } catch (error) {
    console.error('❌ Error bulk updating shows:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
