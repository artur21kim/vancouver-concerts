import { createClient } from '@supabase/supabase-js'
import ShowsChart from './components/ShowsChart'

export default async function Home() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  // Query 1: Shows by year
  const { data: showsByYear, error: error1 } = await supabase.rpc('shows_by_year')
  
  // Query 2: Top artists
  const { data: topArtists, error: error2 } = await supabase.rpc('top_artists')
  
  // Query 3: Top venues
  const { data: topVenues, error: error3 } = await supabase.rpc('top_venues')

// Calculate total shows
const totalShows = showsByYear?.reduce((sum: number, item: any) => sum + item.show_count, 0) || 0

return (
  <main className="min-h-screen bg-gray-50 py-12 px-4">
    <div className="max-w-6xl mx-auto">
    
      {/* Browse All Shows Link */}
      <div className="text-center mb-4">
        <a 
          href="/browse" 
          className="text-blue-600 hover:text-blue-800 underline text-lg"
        >
          → Browse All Shows
        </a>
      </div>

      {/* Header */}
      <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Vancouver Concert History
          </h1>
          <p className="text-xl text-gray-600">
            {totalShows.toLocaleString()} shows • 2000-2025
          </p>
        </div>

        {/* Shows by Year Chart */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Shows Per Year</h2>
          {showsByYear && showsByYear.length > 0 ? (
            <ShowsChart data={showsByYear} />
          ) : (
            <p className="text-red-500">No chart data available</p>
          )}
        </div>

        {/* Two columns for tables */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Top Artists */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Top 10 Artists</h2>
            {topArtists && topArtists.length > 0 ? (
              <div className="space-y-3">
                {topArtists.map((artist: any, index: number) => (
                  <div key={artist.artist_name} className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <span className="text-gray-900">{artist.artist_name}</span>
                    </div>
                    <span className="text-gray-600 font-medium">
                      {artist.show_count} shows
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-red-500">No artist data available</p>
            )}
          </div>

          {/* Top Venues */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Top 10 Venues</h2>
            {topVenues && topVenues.length > 0 ? (
              <div className="space-y-3">
                {topVenues.map((venue: any, index: number) => (
                  <div key={venue.venue_name} className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <span className="text-gray-900">{venue.venue_name}</span>
                    </div>
                    <span className="text-gray-600 font-medium">
                      {venue.show_count} shows
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-red-500">No venue data available</p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}