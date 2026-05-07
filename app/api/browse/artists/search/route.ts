import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q = (searchParams.get('q') || '').trim()

  if (q.length < 1) {
    return NextResponse.json({ artists: [] })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase
    .from('dim_artist')
    .select('artist_id, artist_name, monthly_listeners, spotify_artist_id')
    .ilike('artist_name', `%${q}%`)
    .order('artist_name')
    .limit(20)

  if (error) {
    console.error('Artist search error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    artists: (data || []).map((a: any) => ({
      value: a.artist_id,
      label: a.artist_name,
      monthly_listeners: a.monthly_listeners,
      spotify_artist_id: a.spotify_artist_id,
    })),
  })
}
