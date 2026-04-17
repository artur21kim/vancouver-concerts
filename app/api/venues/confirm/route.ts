import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type VenueConfirmation = {
  venue_id: number;
  status: 'yes' | 'no' | 'not_sure';
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body = await request.json();
    const { confirmations } = body as { confirmations: VenueConfirmation[] };

    if (!confirmations || !Array.isArray(confirmations)) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected confirmations array.' 
      }, { status: 400 });
    }

    console.log(`💾 Saving ${confirmations.length} venue confirmations for user: ${user.id}`);

    // Prepare data for upsert
    const venueRecords = confirmations.map(conf => ({
      user_id: user.id,
      venue_id: conf.venue_id,
      status: conf.status
    }));

    // Upsert venue confirmations
    const { error: upsertError } = await supabase
      .from('user_venues')
      .upsert(venueRecords, {
        onConflict: 'user_id,venue_id',
        ignoreDuplicates: false // Update if exists
      });

    if (upsertError) {
      console.error('Error upserting venue confirmations:', upsertError);
      return NextResponse.json({ 
        error: 'Failed to save venue confirmations',
        details: upsertError.message
      }, { status: 500 });
    }

    // Count confirmations by status
    const yesCount = confirmations.filter(c => c.status === 'yes').length;
    const noCount = confirmations.filter(c => c.status === 'no').length;
    const notSureCount = confirmations.filter(c => c.status === 'not_sure').length;

    console.log(`✅ Venue confirmations saved:`);
    console.log(`   - Yes: ${yesCount}`);
    console.log(`   - No: ${noCount}`);
    console.log(`   - Not Sure: ${notSureCount}`);

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
