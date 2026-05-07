import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Cache header — venues change rarely, cache for 1 hour at CDN
export const revalidate = 3600

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('dim_venue')
    .select('venue_id, venue_name, capacity, capacity_category, status, other_names')
    .order('venue_name')

  if (error) {
    console.error('Venues API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ venues: data || [] })
}
