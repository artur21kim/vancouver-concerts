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
    const { show_id, status, source = 'manual' } = body;

    if (!show_id || !status || !['added', 'skipped'].includes(status)) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected show_id and status (added/skipped).' 
      }, { status: 400 });
    }

    if (status === 'added') {
      // Upsert into user_shows only when adding
      const { error: upsertError } = await supabase
        .from('user_shows')
        .upsert({
          user_id: user.id,
          show_id: show_id,
          status: 'attended',
          source: source
        }, {
          onConflict: 'user_id,show_id'
        });

      if (upsertError) {
        console.error('Error upserting show:', upsertError);
        return NextResponse.json({ 
          error: 'Failed to update show status',
          details: upsertError.message
        }, { status: 500 });
      }

      console.log(`✅ Added show ${show_id} to user_shows, source: ${source}`);

    } else {
      // Skipped — remove from user_shows if it exists
      const { error: deleteError } = await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', show_id);

      if (deleteError) {
        console.error('Error deleting show:', deleteError);
        return NextResponse.json({ 
          error: 'Failed to update show status',
          details: deleteError.message
        }, { status: 500 });
      }

      console.log(`✅ Skipped show ${show_id} — removed from user_shows if present`);
    }

    // Recalculate likely_shows_added directly from user_shows
    if (source === 'likely_shows') {
      const { count, error: countError } = await supabase
        .from('user_shows')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'likely_shows')
        .eq('status', 'attended');

      if (!countError) {
        await supabase
          .from('user_profiles')
          .update({ likely_shows_added: count || 0 })
          .eq('user_id', user.id);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        show_id,
        status: status === 'added' ? 'attended' : 'not_attended',
        source
      }
    });

  } catch (error) {
    console.error('❌ Error updating show status:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
