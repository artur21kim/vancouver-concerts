import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type VenueConfirmation = {
  venue_id: number;
  status: 'yes' | 'no' | 'not_sure';
};

// GET - fetch saved venue confirmations for the current user
export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: userVenues, error: venuesError } = await supabase
      .from('user_venues')
      .select('venue_id, status')
      .eq('user_id', user.id);

    if (venuesError) {
      console.error('Error fetching user venues:', venuesError);
      return NextResponse.json({ error: 'Failed to fetch venue confirmations' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        confirmations: userVenues || []
      }
    });

  } catch (error) {
    console.error('❌ Error fetching venue confirmations:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

// POST - save venue confirmations
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { confirmations } = body as { confirmations: VenueConfirmation[] };

    if (!confirmations || !Array.isArray(confirmations)) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected confirmations array.' 
      }, { status: 400 });
    }

    console.log(`💾 Saving ${confirmations.length} venue confirmations for user: ${user.id}`);

    const venueRecords = confirmations.map(conf => ({
      user_id: user.id,
      venue_id: conf.venue_id,
      status: conf.status
    }));

    const { error: upsertError } = await supabase
      .from('user_venues')
      .upsert(venueRecords, {
        onConflict: 'user_id,venue_id',
        ignoreDuplicates: false
      });

    if (upsertError) {
      console.error('Error upserting venue confirmations:', upsertError);
      return NextResponse.json({ 
        error: 'Failed to save venue confirmations',
        details: upsertError.message
      }, { status: 500 });
    }

    const yesCount = confirmations.filter(c => c.status === 'yes').length;
    const noCount = confirmations.filter(c => c.status === 'no').length;
    const notSureCount = confirmations.filter(c => c.status === 'not_sure').length;

    console.log(`✅ Venue confirmations saved: Yes: ${yesCount}, No: ${noCount}, Not Sure: ${notSureCount}`);

    return NextResponse.json({
      success: true,
      data: {
        total_confirmations: confirmations.length,
        yes_count: yesCount,
        no_count: noCount,
        not_sure_count: notSureCount
      }
    });

  } catch (error) {
    console.error('❌ Error in venue confirmation endpoint:', error);
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
