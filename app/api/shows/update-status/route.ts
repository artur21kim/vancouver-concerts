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
    const { show_id, status } = body;

    if (!show_id || !status || !['added', 'skipped'].includes(status)) {
      return NextResponse.json({ 
        error: 'Invalid request. Expected show_id and status (added/skipped).' 
      }, { status: 400 });
    }

    // Map status to user_shows status
    const userShowStatus = status === 'added' ? 'attended' : 'not_attended';

    // Upsert to user_shows
    const { error: upsertError } = await supabase
      .from('user_shows')
      .upsert({
        user_id: user.id,
        show_id: show_id,
        status: userShowStatus
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

    console.log(`✅ Updated show ${show_id} to status: ${userShowStatus}`);

    return NextResponse.json({
      success: true,
      data: {
        show_id,
        status: userShowStatus
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
