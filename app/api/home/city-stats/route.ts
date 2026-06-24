import { createClient } from '@supabase/supabase-js'
import { NextResponse }  from 'next/server'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.rpc('get_overview_city_stats')

  if (error) {
    console.error('city-stats RPC error:', error)
    return NextResponse.json({ cityStats: [] }, { status: 500 })
  }

  return NextResponse.json({ cityStats: data ?? [] })
}
