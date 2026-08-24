import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'edge'

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state')
  if (!state) {
    return NextResponse.json({ error: 'Missing state param' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.rpc('get_state_overview_stats', { p_state: state })
  if (error) {
    console.error('[state-stats]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // RPC returns a single-row array — extract first row
  const stats = Array.isArray(data) ? (data[0] ?? null) : data ?? null

  return NextResponse.json({ stats })
}
