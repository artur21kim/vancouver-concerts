import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { show_id, status, source = 'manual' } = body;

    if (!show_id || !status || !['added', 'skipped', 'pending'].includes(status)) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected show_id and status (added/skipped/pending).' 
      }, { status: 400 });
    }

    if (status === 'pending') {
      // Undo — delete the review record so show returns to New
      const { error: deleteReviewError } = await supabase
        .from('user_show_reviews')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', show_id);

      if (deleteReviewError) {
        console.error('Error deleting review:', deleteReviewError);
        return NextResponse.json({ error: 'Failed to undo review', details: deleteReviewError.message }, { status: 500 });
      }

      // Also remove from user_shows in case it was previously added
      await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', show_id);

      console.log(`↩️ Undid review for show ${show_id}, source: ${source}`);

      return NextResponse.json({
        success: true,
        data: { show_id, status: 'pending', source }
      });
    }

    if (status === 'added') {
      // Upsert into user_shows
      const { error: upsertError } = await supabase
        .from('user_shows')
        .upsert({
          user_id: user.id,
          show_id: show_id,
          status: 'attended',
          source: source
        }, { onConflict: 'user_id,show_id' });

      if (upsertError) {
        console.error('Error upserting show:', upsertError);
        return NextResponse.json({ error: 'Failed to update show status', details: upsertError.message }, { status: 500 });
      }

      // Auto-populate user_venues with 'yes' when a show is added
      const { data: show, error: showError } = await supabase
        .from('fact_shows')
        .select('venue_id')
        .eq('show_id', show_id)
        .single();

      if (!showError && show?.venue_id) {
        const { error: venueError } = await supabase
          .from('user_venues')
          .upsert({
            user_id: user.id,
            venue_id: show.venue_id,
            status: 'yes'
          }, { onConflict: 'user_id,venue_id' });

        if (venueError) {
          console.error('Error upserting user_venue:', venueError);
        } else {
          console.log(`📍 Auto-populated user_venues: venue ${show.venue_id} = yes`);
        }
      }

    } else {
      // Skipped — remove from user_shows
      const { error: deleteError } = await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', show_id);

      if (deleteError) {
        console.error('Error deleting show:', deleteError);
        return NextResponse.json({ error: 'Failed to update show status', details: deleteError.message }, { status: 500 });
      }
    }

    // Write decision to user_show_reviews for persistence
    const { error: reviewError } = await supabase
      .from('user_show_reviews')
      .upsert({
        user_id: user.id,
        show_id: show_id,
        status: status,
        source: source,
        reviewed_at: new Date().toISOString()
      }, { onConflict: 'user_id,show_id' });

    if (reviewError) {
      console.error('Error upserting review:', reviewError);
      return NextResponse.json({ error: 'Failed to save review', details: reviewError.message }, { status: 500 });
    }

    console.log(`✅ Updated show ${show_id} to status: ${status}, source: ${source}`);

    // Recalculate likely_shows_added from user_show_reviews
    if (source === 'likely_shows') {
      const { count } = await supabase
        .from('user_show_reviews')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('source', 'likely_shows')
        .eq('status', 'added');

      await supabase
        .from('user_profiles')
        .update({ likely_shows_added: count || 0 })
        .eq('user_id', user.id);
    }

    return NextResponse.json({
      success: true,
      data: { show_id, status, source }
    });

  } catch (error) {
    console.error('❌ Error updating show status:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
