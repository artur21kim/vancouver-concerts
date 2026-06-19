import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const artistIdParam = searchParams.get('artist_id')

  if (!artistIdParam) {
    return NextResponse.json({ error: 'artist_id required' }, { status: 400 })
  }

  const artistId = parseInt(artistIdParam, 10)
  if (isNaN(artistId)) {
    return NextResponse.json({ error: 'artist_id must be an integer' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const { data, error } = await supabase.rpc('get_artist_city_breakdown', {
    p_artist_id: artistId,
  })

  if (error) {
    console.error('get_artist_city_breakdown error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ cities: data ?? [] })
}
