import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 0

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const decade = searchParams.get('decade') // e.g. '1980s' | 'pre1960s' | null
  const year   = searchParams.get('year')   // e.g. '1985' | null
  const month  = searchParams.get('month')  // e.g. '3' | null

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const p_decade = decade || null
  const p_year   = year   ? parseInt(year)  : null
  const p_month  = month  ? parseInt(month) : null

  const [chartRes, artistsRes, venuesRes, statsRes] = await Promise.all([
    // No chart when a month is selected — just return null
    p_month
      ? Promise.resolve({ data: null, error: null })
      : supabase.rpc('get_home_chart_data', { p_decade, p_year }),

    supabase.rpc('get_home_top_artists',  { p_decade, p_year, p_month }),
    supabase.rpc('get_home_top_venues',   { p_decade, p_year, p_month }),
    supabase.rpc('get_home_drill_stats',  { p_decade, p_year, p_month }),
  ])

  if (chartRes.error)   console.error('chart error:',   chartRes.error)
  if (artistsRes.error) console.error('artists error:', artistsRes.error)
  if (venuesRes.error)  console.error('venues error:',  venuesRes.error)
  if (statsRes.error)   console.error('stats error:',   statsRes.error)

  return NextResponse.json({
    chart:   chartRes.data   ?? [],
    artists: artistsRes.data ?? [],
    venues:  venuesRes.data  ?? [],
    stats:   statsRes.data   ?? null,
  })
}
