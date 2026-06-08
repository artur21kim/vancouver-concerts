import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()

  if (q.length < 1) {
    return NextResponse.json({ venues: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('dim_venue')
    .select('venue_id, venue_name, capacity_category')
    .ilike('venue_name', `%${q}%`)
    .order('venue_name')
    .limit(10)

  if (error) {
    console.error('Venue search error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    venues: (data || []).map((v: any) => ({
      value: v.venue_id,
      label: v.venue_name,
      capacity_category: v.capacity_category,
    })),
  })
}
