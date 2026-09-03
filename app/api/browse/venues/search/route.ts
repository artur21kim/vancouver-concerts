import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim()

  if (!q || q.length < 2) {
    return NextResponse.json({ venues: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('dim_venue')
    .select('venue_id, venue_name, city, state, country')
    .ilike('venue_name', `%${q}%`)
    .order('venue_name')
    .limit(10)

  if (error) {
    console.error('Venue search error:', error)
    return NextResponse.json({ venues: [] })
  }

  return NextResponse.json({
    venues: (data || []).map((v: any) => ({
      value:   v.venue_id,
      label:   v.venue_name,
      city:    v.city    ?? null,
      state:   v.state   ?? null,
      country: v.country ?? null,
    })),
  })
}
