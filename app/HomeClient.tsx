'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js'
import { Bar } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

type Show = {
  show_id: number
  date: string
  artist_id: number
  artist_name: string
  venue_id: number
  venue_name: string
}

type Decade = 'all' | '1900s' | '1910s' | '1920s' | '1930s' | '1940s' | '1950s' | '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'

const DECADES: Decade[] = ['all', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']

export default function HomeClient({ shows }: { shows: Show[] }) {
  const router = useRouter()
  const [selectedDecade, setSelectedDecade] = useState<Decade>('all')

  // Filter shows by selected decade
  const filteredShows = useMemo(() => {
    if (selectedDecade === 'all') return shows

    const decadeStart = parseInt(selectedDecade.substring(0, 4))
    const decadeEnd = decadeStart + 9

    return shows.filter((show) => {
      const year = new Date(show.date).getFullYear()
      return year >= decadeStart && year <= decadeEnd
    })
  }, [shows, selectedDecade])

  // Calculate stats
  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map((s) => s.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map((s) => s.venue_id)).size
    
    // Shows per year (only if decade selected, not for "all")
    let showsPerYear = null
    if (selectedDecade !== 'all') {
      const decadeStart = parseInt(selectedDecade.substring(0, 4))
      const decadeEnd = decadeStart + 9
      const years = decadeEnd - decadeStart + 1
      showsPerYear = (totalShows / years).toFixed(0)
    }

    return { totalShows, uniqueArtists, uniqueVenues, showsPerYear }
  }, [filteredShows, selectedDecade])

  // Chart data
  const chartData = useMemo(() => {
    if (selectedDecade === 'all') {
      // Show 13 bars (one per decade)
      const decadeCounts: { [key: string]: number } = {}
      
      DECADES.filter(d => d !== 'all').forEach(decade => {
        decadeCounts[decade] = 0
      })

      shows.forEach(show => {
        const year = new Date(show.date).getFullYear()
        const decadeStart = Math.floor(year / 10) * 10
        const decadeLabel = `${decadeStart}s`
        if (decadeCounts[decadeLabel] !== undefined) {
          decadeCounts[decadeLabel]++
        }
      })

      return {
        labels: DECADES.filter(d => d !== 'all'),
        datasets: [{
          label: 'Shows',
          data: DECADES.filter(d => d !== 'all').map(d => decadeCounts[d]),
          backgroundColor: 'rgb(59, 130, 246)',
        }]
      }
    } else {
      // Show 10 bars (individual years within decade)
      const decadeStart = parseInt(selectedDecade.substring(0, 4))
      const years = Array.from({ length: 10 }, (_, i) => decadeStart + i)
      
      const yearCounts: { [key: number]: number } = {}
      years.forEach(year => yearCounts[year] = 0)

      filteredShows.forEach(show => {
        const year = new Date(show.date).getFullYear()
        if (yearCounts[year] !== undefined) {
          yearCounts[year]++
        }
      })

      return {
        labels: years.map(y => y.toString()),
        datasets: [{
          label: 'Shows',
          data: years.map(y => yearCounts[y]),
          backgroundColor: 'rgb(59, 130, 246)',
        }]
      }
    }
  }, [shows, filteredShows, selectedDecade])

  // Top 10 Artists
  const topArtists = useMemo(() => {
    const artistCounts: { [key: number]: { name: string; count: number } } = {}
    
    filteredShows.forEach(show => {
      if (!artistCounts[show.artist_id]) {
        artistCounts[show.artist_id] = { name: show.artist_name, count: 0 }
      }
      artistCounts[show.artist_id].count++
    })

    return Object.entries(artistCounts)
      .map(([id, data]) => ({ artist_id: parseInt(id), artist_name: data.name, show_count: data.count }))
      .sort((a, b) => b.show_count - a.show_count)
      .slice(0, 10)
  }, [filteredShows])

  // Top 10 Venues
  const topVenues = useMemo(() => {
    const venueCounts: { [key: number]: { name: string; count: number } } = {}
    
    filteredShows.forEach(show => {
      if (!venueCounts[show.venue_id]) {
        venueCounts[show.venue_id] = { name: show.venue_name, count: 0 }
      }
      venueCounts[show.venue_id].count++
    })

    return Object.entries(venueCounts)
      .map(([id, data]) => ({ venue_id: parseInt(id), venue_name: data.name, show_count: data.count }))
      .sort((a, b) => b.show_count - a.show_count)
      .slice(0, 10)
  }, [filteredShows])

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: false }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { precision: 0 }
      }
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-8 px-4">
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
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            Vancouver Concert History
          </h1>
          <p className="text-xl text-gray-600">
            {shows.length.toLocaleString()} shows • 1900-2025
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          {stats.showsPerYear && (
            <StatCard label="Shows per Year" value={stats.showsPerYear} />
          )}
        </div>

        {/* Shows Chart */}
        <div className="bg-white rounded-lg shadow-lg p-5 mb-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            {selectedDecade === 'all' ? 'Shows by Decade' : `Shows in the ${selectedDecade}`}
          </h2>
          <div style={{ height: '350px' }}>
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* Decade Filter Buttons */}
        <div className="bg-white rounded-lg shadow-lg p-5 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Filter by Decade</h2>
          <div className="flex flex-wrap gap-2">
            {DECADES.map((decade) => (
              <button
                key={decade}
                onClick={() => setSelectedDecade(decade)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  selectedDecade === decade
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {decade === 'all' ? 'All Time' : decade}
              </button>
            ))}
          </div>
        </div>

        {/* Two columns for tables */}
        <div className="grid md:grid-cols-2 gap-8">
          {/* Top Artists */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Top 10 Artists
              {selectedDecade !== 'all' && (
                <span className="text-base font-normal text-gray-600 ml-2">({selectedDecade})</span>
              )}
            </h2>
            {topArtists.length > 0 ? (
              <div className="space-y-3">
                {topArtists.map((artist, index) => (
                  <div key={artist.artist_id} className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <button
                        onClick={() => router.push(`/browse?artist_id=${artist.artist_id}`)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {artist.artist_name}
                      </button>
                    </div>
                    <span className="text-gray-600 font-medium">
                      {artist.show_count} shows
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No shows in this decade</p>
            )}
          </div>

          {/* Top Venues */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Top 10 Venues
              {selectedDecade !== 'all' && (
                <span className="text-base font-normal text-gray-600 ml-2">({selectedDecade})</span>
              )}
            </h2>
            {topVenues.length > 0 ? (
              <div className="space-y-3">
                {topVenues.map((venue, index) => (
                  <div key={venue.venue_id} className="flex items-center justify-between border-b pb-2">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-semibold text-gray-400 w-6">
                        {index + 1}
                      </span>
                      <button
                        onClick={() => router.push(`/browse?venue_id=${venue.venue_id}`)}
                        className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                      >
                        {venue.venue_name}
                      </button>
                    </div>
                    <span className="text-gray-600 font-medium">
                      {venue.show_count} shows
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No shows in this decade</p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

// Stats Card Component
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}