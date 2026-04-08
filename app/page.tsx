import { createClient } from '@supabase/supabase-js'
import HomeClient from './HomeClient'

export const revalidate = 3600 // Cache for 1 hour like Browse page

export default async function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const pageSize = 1000

  // Fetch all shows in batches
  let allShowsRaw: any[] = []
  let showPage = 0
  let hasMoreShows = true

  while (hasMoreShows) {
    const { data, error } = await supabase
      .from('fact_shows')
      .select(`
        show_id,
        date,
        dim_artist!inner (
          artist_id,
          artist_name
        ),
        dim_venue!inner (
          venue_id,
          venue_name
        )
      `)
      .order('date', { ascending: false })
      .range(showPage * pageSize, (showPage + 1) * pageSize - 1)
    
    if (error) {
      console.error('Error fetching page', showPage, error)
      break
    }
    
    if (data && data.length > 0) {
      allShowsRaw = [...allShowsRaw, ...data]
      showPage++
      hasMoreShows = data.length === pageSize
    } else {
      hasMoreShows = false
    }
  }

  // Transform nested objects to flat structure
  const shows = allShowsRaw.map((show: any) => ({
    show_id: show.show_id,
    date: show.date,
    artist_id: show.dim_artist?.artist_id || 0,
    artist_name: show.dim_artist?.artist_name || 'Unknown',
    venue_id: show.dim_venue?.venue_id || 0,
    venue_name: show.dim_venue?.venue_name || 'Unknown'
  }))

  return <HomeClient shows={shows} />
}