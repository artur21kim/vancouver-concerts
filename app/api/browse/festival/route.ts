import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const revalidate = 0

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('fact_shows')
    .select('festival_name')
    .not('festival_name', 'is', null)
    .neq('festival_name', '')
    .order('festival_name')

  if (error) {
    console.error('Festivals API error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const unique = Array.from(
    new Set((data || []).map((r: any) => r.festival_name as string))
  ).sort()

  return NextResponse.json(
    { festivals: unique.map(f => ({ value: f, label: f })) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
