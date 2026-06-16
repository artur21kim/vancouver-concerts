import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: tokenData, error } = await supabase
      .from('user_discogs_tokens')
      .select('status, releases_fetched, total_releases')
      .eq('user_id', user.id)
      .single()

    if (error || !tokenData) {
      return NextResponse.json({
        status: 'not_connected',
        releases_fetched: 0,
        total_releases: 0,
        progress_percentage: 0,
      })
    }

    const fetched = tokenData.releases_fetched ?? 0
    const total = tokenData.total_releases ?? 0

    return NextResponse.json({
      status: tokenData.status,
      releases_fetched: fetched,
      total_releases: total,
      progress_percentage: total > 0 ? Math.round((fetched / total) * 100) : 0,
    })
  } catch (error) {
    console.error('❌ Discogs status error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
