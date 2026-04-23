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
    const { show_ids, status, source = 'manual' } = body;

    if (!show_ids || !Array.isArray(show_ids) || show_ids.length === 0) {
      return NextResponse.json({ error: 'Invalid request. Expected array of show_ids.' }, { status: 400 });
    }

    if (!status || !['added', 'skipped', 'pending'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status. Expected "added", "skipped", or "pending".' }, { status: 400 });
    }

    if (status === 'pending') {
      // Clear All — remove from both user_shows and user_show_reviews
      const { error: deleteShowsError } = await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .in('show_id', show_ids);

      if (deleteShowsError) {
        return NextResponse.json({ error: 'Failed to clear shows', details: deleteShowsError.message }, { status: 500 });
      }

      const { error: deleteReviewsError } = await supabase
        .from('user_show_reviews')
        .delete()
        .eq('user_id', user.id)
        .in('show_id', show_ids);

      if (deleteReviewsError) {
        return NextResponse.json({ error: 'Failed to clear reviews', details: deleteReviewsError.message }, { status: 500 });
      }

      console.log(`✅ Cleared ${show_ids.length} shows back to pending`);

    } else if (status === 'added') {
      // Bulk upsert into user_shows
      const records = show_ids.map(show_id => ({
        user_id: user.id,
        show_id,
        status: 'attended',
        source
      }));

      const { error: upsertError } = await supabase
        .from('user_shows')
        .upsert(records, { onConflict: 'user_id,show_id' });

      if (upsertError) {
        return NextResponse.json({ error: 'Failed to bulk update shows', details: upsertError.message }, { status: 500 });
      }

      // Auto-populate user_venues with 'yes' for all venues in these shows
      const { data: showVenues, error: showVenuesError } = await supabase
        .from('fact_shows')
        .select('venue_id')
        .in('show_id', show_ids);

      if (!showVenuesError && showVenues && showVenues.length > 0) {
        // Get unique venue IDs
        const uniqueVenueIds = [...new Set(showVenues.map(s => s.venue_id))];
        const venueRecords = uniqueVenueIds.map(venue_id => ({
          user_id: user.id,
          venue_id,
          status: 'yes'
        }));

        const { error: venueError } = await supabase
          .from('user_venues')
          .upsert(venueRecords, { onConflict: 'user_id,venue_id' });

        if (venueError) {
          console.error('Error bulk upserting user_venues:', venueError);
          // Don't fail the request — venue upsert is best-effort
        } else {
          console.log(`📍 Auto-populated user_venues for ${uniqueVenueIds.length} unique venues`);
        }
      }

      console.log(`✅ Bulk added ${show_ids.length} shows`);

    } else {
      // Skipped — remove from user_shows
      const { error: deleteError } = await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .in('show_id', show_ids);

      if (deleteError) {
        return NextResponse.json({ error: 'Failed to bulk update shows', details: deleteError.message }, { status: 500 });
      }

      console.log(`✅ Bulk skipped ${show_ids.length} shows`);
    }

    // Write decisions to user_show_reviews (skip for pending — those get deleted above)
    if (status !== 'pending') {
      const reviewRecords = show_ids.map(show_id => ({
        user_id: user.id,
        show_id,
        status,
        source,
        reviewed_at: new Date().toISOString()
      }));

      const { error: reviewError } = await supabase
        .from('user_show_reviews')
        .upsert(reviewRecords, { onConflict: 'user_id,show_id' });

      if (reviewError) {
        return NextResponse.json({ error: 'Failed to save reviews', details: reviewError.message }, { status: 500 });
      }
    }

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
      data: { updated_count: show_ids.length, status, source }
    });

  } catch (error) {
    console.error('❌ Error bulk updating shows:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
