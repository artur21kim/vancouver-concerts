import { createClient } from '@supabase/supabase-js'
import { NextResponse }  from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const state = searchParams.get('state')

  if (!state) {
    return NextResponse.json({ error: 'state required' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const [artistsRes, venuesRes] = await Promise.all([
    supabase.rpc('get_home_top_artists', { p_state: state }),
    supabase.rpc('get_home_top_venues',  { p_state: state }),
  ])

  if (artistsRes.error) console.error('[state-drill] artists error:', artistsRes.error)
  if (venuesRes.error)  console.error('[state-drill] venues error:',  venuesRes.error)

  return NextResponse.json({
    artists: artistsRes.data ?? [],
    venues:  venuesRes.data  ?? [],
  })
}
