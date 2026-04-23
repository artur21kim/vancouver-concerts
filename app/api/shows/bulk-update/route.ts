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

    if (!status || !['added', 'skipped', 'pending'].includes(status)) {
      return NextResponse.json({ 
        error: 'Invalid status. Expected "added", "skipped", or "pending".' 
      }, { status: 400 });
    }

    if (status === 'added') {
      // Bulk upsert into user_shows only when adding
      const records = show_ids.map(show_id => ({
        user_id: user.id,
        show_id: show_id,
        status: 'attended',
        source: source
      }));

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

      console.log(`✅ Bulk added ${show_ids.length} shows to user_shows, source: ${source}`);

    } else {
      // Skipped or pending — remove from user_shows if they exist
      const { error: deleteError } = await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .in('show_id', show_ids);

      if (deleteError) {
        console.error('Error bulk deleting shows:', deleteError);
        return NextResponse.json({ 
          error: 'Failed to bulk update shows',
          details: deleteError.message
        }, { status: 500 });
      }

      console.log(`✅ Bulk ${status} ${show_ids.length} shows — removed from user_shows if present`);
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
        updated_count: show_ids.length,
        status,
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
