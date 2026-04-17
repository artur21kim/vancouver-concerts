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
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function HomeClient({ shows }: { shows: Show[] }) {
  const router = useRouter()
  const [selectedDecade, setSelectedDecade] = useState<Decade>('all')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues, setShowAllVenues] = useState(false)

  // Filter shows by selected decade, year, or month
  const filteredShows = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return shows.filter((show) => {
        const date = new Date(show.date)
        return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth
      })
    }

    if (selectedYear) {
      return shows.filter((show) => {
        const year = new Date(show.date).getFullYear()
        return year === selectedYear
      })
    }

    if (selectedDecade === 'all') return shows

    const decadeStart = parseInt(selectedDecade.substring(0, 4))
    const decadeEnd = decadeStart + 9

    return shows.filter((show) => {
      const year = new Date(show.date).getFullYear()
      return year >= decadeStart && year <= decadeEnd
    })
  }, [shows, selectedDecade, selectedYear, selectedMonth])

  // Calculate stats
  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map((s) => s.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map((s) => s.venue_id)).size

    let showsPerYear = null
    if (selectedDecade !== 'all' && !selectedYear && !selectedMonth) {
      const decadeStart = parseInt(selectedDecade.substring(0, 4))
      const decadeEnd = decadeStart + 9
      const years = decadeEnd - decadeStart + 1
      showsPerYear = (totalShows / years).toFixed(0)
    }

    return { totalShows, uniqueArtists, uniqueVenues, showsPerYear }
  }, [filteredShows, selectedDecade, selectedYear, selectedMonth])

  // Chart data
  const chartData = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return {
        labels: [],
        datasets: []
      }
    } else if (selectedYear) {
      const monthCounts: { [key: number]: number } = {}
      Array.from({ length: 12 }, (_, i) => i).forEach(month => monthCounts[month] = 0)

      filteredShows.forEach(show => {
        const dateParts = show.date.split('-')
        const month = parseInt(dateParts[1]) - 1
        monthCounts[month]++
      })

      return {
        labels: MONTH_NAMES,
        datasets: [{
          label: 'Shows',
          data: Array.from({ length: 12 }, (_, i) => monthCounts[i]),
          backgroundColor: 'rgb(59, 130, 246)',
        }]
      }
    } else if (selectedDecade === 'all') {
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
  }, [shows, filteredShows, selectedDecade, selectedYear, selectedMonth])

  // Top Artists
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
  }, [filteredShows])

  // Top Venues
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
  }, [filteredShows])

  // Chart options with drilldown onClick
  const chartOptions = useMemo(() => ({
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
    },
    onClick: (event: any, elements: any) => {
      if (elements.length > 0) {
        const index = elements[0].index

        if (selectedYear) {
          const clickedMonth = index
          const year = selectedYear
          const month = clickedMonth + 1
          router.push(`/browse?year=${year}&month=${month}`)
        } else if (selectedDecade === 'all') {
          const decades = DECADES.filter(d => d !== 'all')
          const clickedDecade = decades[index] as Decade
          setSelectedDecade(clickedDecade)
          setSelectedYear(null)
          setSelectedMonth(null)
        } else {
          const decadeStart = parseInt(selectedDecade.substring(0, 4))
          const clickedYear = decadeStart + index
          setSelectedYear(clickedYear)
          setSelectedMonth(null)
        }
      }
    }
  }), [selectedDecade, selectedYear, router])

  // Get chart title
  const chartTitle = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return `Shows in ${MONTH_NAMES[selectedMonth]} ${selectedYear}`
    }
    if (selectedYear) {
      return `Shows in ${selectedYear}`
    }
    if (selectedDecade === 'all') {
      return 'Shows by Decade'
    }
    return `Shows in the ${selectedDecade}`
  }, [selectedDecade, selectedYear, selectedMonth])

  // Get filter context for Top 10 headers
  const filterContext = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return `${MONTH_NAMES[selectedMonth]} ${selectedYear}`
    }
    if (selectedYear) return selectedYear.toString()
    if (selectedDecade !== 'all') return selectedDecade
    return null
  }, [selectedDecade, selectedYear, selectedMonth])

  // Breadcrumb navigation
  const breadcrumb = useMemo(() => {
    const crumbs: { label: string; onClick: () => void; active: boolean }[] = []

    crumbs.push({
      label: 'All Time',
      onClick: () => {
        setSelectedDecade('all')
        setSelectedYear(null)
        setSelectedMonth(null)
      },
      active: selectedDecade === 'all' && !selectedYear && selectedMonth === null
    })

    if (selectedDecade !== 'all' || selectedYear || selectedMonth !== null) {
      const decade = selectedYear
        ? `${Math.floor(selectedYear / 10) * 10}s` as Decade
        : selectedDecade

      crumbs.push({
        label: decade,
        onClick: () => {
          setSelectedDecade(decade)
          setSelectedYear(null)
          setSelectedMonth(null)
        },
        active: selectedDecade !== 'all' && !selectedYear && selectedMonth === null
      })
    }

    if (selectedYear) {
      crumbs.push({
        label: selectedYear.toString(),
        onClick: () => {
          setSelectedMonth(null)
        },
        active: !!selectedYear && selectedMonth === null
      })
    }

    if (selectedMonth !== null && selectedYear) {
      crumbs.push({
        label: MONTH_NAMES[selectedMonth],
        onClick: () => { },
        active: true
      })
    }

    return crumbs
  }, [selectedDecade, selectedYear, selectedMonth])

  // Navigation helpers (Previous/Next)
  const navigation = useMemo(() => {
    if (selectedDecade === 'all' && !selectedYear) {
      return null
    }

    if (selectedYear && selectedMonth === null) {
      const currentDecade = Math.floor(selectedYear / 10) * 10
      const prevYear = selectedYear - 1
      const nextYear = selectedYear + 1

      return {
        previous: prevYear >= 1900 ? {
          label: prevYear.toString(),
          onClick: () => {
            setSelectedYear(prevYear)
            const newDecade = `${Math.floor(prevYear / 10) * 10}s` as Decade
            setSelectedDecade(newDecade)
          }
        } : null,
        current: selectedYear.toString(),
        next: nextYear <= 2025 ? {
          label: nextYear.toString(),
          onClick: () => {
            setSelectedYear(nextYear)
            const newDecade = `${Math.floor(nextYear / 10) * 10}s` as Decade
            setSelectedDecade(newDecade)
          }
        } : null
      }
    }

    if (selectedDecade !== 'all') {
      const currentDecadeStart = parseInt(selectedDecade.substring(0, 4))
      const prevDecadeStart = currentDecadeStart - 10
      const nextDecadeStart = currentDecadeStart + 10

      return {
        previous: prevDecadeStart >= 1900 ? {
          label: `${prevDecadeStart}s`,
          onClick: () => {
            setSelectedDecade(`${prevDecadeStart}s` as Decade)
            setSelectedYear(null)
          }
        } : null,
        current: selectedDecade,
        next: nextDecadeStart <= 2020 ? {
          label: `${nextDecadeStart}s`,
          onClick: () => {
            setSelectedDecade(`${nextDecadeStart}s` as Decade)
            setSelectedYear(null)
          }
        } : null
      }
    }

    return null
  }, [selectedDecade, selectedYear, selectedMonth])

  return (
    <main className="min-h-screen bg-gray-50 py-4 md:py-8 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Header - Mobile Responsive */}
        <div className="mb-4 md:mb-6">
          {/* Main title - hidden on mobile, visible on desktop */}
          <h1 className="hidden md:block text-5xl font-bold text-gray-900 mb-4 text-center">
            Vancouver Concert History
          </h1>
          
          {/* Subtitle + Browse button row */}
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm md:text-xl text-gray-600">
              {shows.length.toLocaleString()} shows • 1900-2025
            </p>
            <a
              href="/browse"
              className="text-sm md:text-lg text-blue-600 hover:text-blue-800 font-medium whitespace-nowrap"
            >
              → Browse All
            </a>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
          <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          {stats.showsPerYear && !selectedYear && (
            <StatCard label="Shows per Year" value={stats.showsPerYear} />
          )}
        </div>

        {/* Shows Chart */}
        <div className="bg-white rounded-lg shadow-lg p-4 md:p-5 mb-4 md:mb-6">
          {/* Breadcrumb */}
          {(selectedDecade !== 'all' || selectedYear || selectedMonth !== null) && (
            <div className="mb-4 flex items-center gap-2 text-xs md:text-sm">
              {breadcrumb.map((crumb, index) => (
                <div key={crumb.label} className="flex items-center gap-2">
                  {index > 0 && <span className="text-gray-400">›</span>}
                  <button
                    onClick={crumb.onClick}
                    className={`${crumb.active
                        ? 'text-gray-900 font-medium cursor-default'
                        : 'text-blue-600 hover:text-blue-800 hover:underline'
                      }`}
                    disabled={crumb.active}
                  >
                    {crumb.label}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Previous/Next Navigation + Title */}
          {navigation ? (
            <div className="mb-4 md:mb-6">
              <div className="flex items-center justify-center gap-2 md:gap-6">
                {navigation.previous ? (
                  <button
                    onClick={navigation.previous.onClick}
                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 text-xs md:text-sm"
                  >
                    ← <span className="hidden md:inline">Previous {selectedYear ? 'Year' : 'Decade'}</span>
                  </button>
                ) : (
                  <div className="w-8 md:w-32"></div>
                )}
                
                <h2 className="text-lg md:text-2xl font-bold text-gray-900 text-center">
                  {chartTitle}
                </h2>

                {navigation.next ? (
                  <button
                    onClick={navigation.next.onClick}
                    className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 text-xs md:text-sm"
                  >
                    <span className="hidden md:inline">Next {selectedYear ? 'Year' : 'Decade'}</span> →
                  </button>
                ) : (
                  <div className="w-8 md:w-32"></div>
                )}
              </div>
            </div>
          ) : (
            <h2 className="text-lg md:text-2xl font-bold text-gray-900 mb-4 md:mb-6">
              {chartTitle}
            </h2>
          )}
          
          <div style={{ height: '300px', cursor: 'pointer' }} className="md:h-[350px]">
            <Bar data={chartData} options={chartOptions} />
          </div>
          <p className="text-xs md:text-sm text-gray-500 mt-2 text-center">
            {selectedYear 
              ? 'Click a month to view shows in Browse' 
              : 'Click a bar to drill down'}
          </p>
        </div>

        {/* Decade/Year Filter - Mobile Horizontal Scroll */}
        <div className="bg-white rounded-lg shadow-lg p-4 md:p-5 mb-4 md:mb-6">
          <h2 className="text-lg md:text-xl font-bold text-gray-900 mb-3 md:mb-4">Filter by Decade</h2>
          
          {/* Horizontal scroll on mobile, wrap on desktop */}
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <div className="flex md:flex-wrap gap-2 mb-4 min-w-max md:min-w-0">
              {DECADES.map((decade) => (
                <button
                  key={decade}
                  onClick={() => {
                    setSelectedDecade(decade)
                    setSelectedYear(null)
                    setSelectedMonth(null)
                  }}
                  className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${selectedDecade === decade && !selectedYear && selectedMonth === null
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  {decade === 'all' ? 'All Time' : decade}
                </button>
              ))}
            </div>
          </div>

          {/* Year dropdown */}
          <div className="pt-4 border-t">
            <label className="block text-xs md:text-sm font-medium text-gray-900 mb-2">
              Or view a specific year:
            </label>
            <select
              value={selectedYear || ''}
              onChange={(e) => {
                const year = e.target.value ? parseInt(e.target.value) : null
                setSelectedYear(year)
                setSelectedMonth(null)
                if (year) {
                  const decade = `${Math.floor(year / 10) * 10}s` as Decade
                  setSelectedDecade(decade)
                }
              }}
              className="w-full md:w-64 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select year...</option>
              {Array.from({ length: 126 }, (_, i) => 1900 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Two columns for tables - stack on mobile */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {/* Top Artists */}
          <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 md:mb-6">
              Top {showAllArtists ? '25' : '10'} Artists
              {filterContext && (
                <span className="text-sm md:text-base font-normal text-gray-600 ml-2">({filterContext})</span>
              )}
            </h2>
            {topArtists.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topArtists.slice(0, showAllArtists ? 25 : 10).map((artist, index) => (
                    <div key={artist.artist_id} className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <span className="text-base md:text-lg font-semibold text-gray-400 w-4 md:w-6 flex-shrink-0">
                          {index + 1}
                        </span>
                        <button
                          onClick={() => router.push(`/browse?artist_id=${artist.artist_id}`)}
                          className="text-sm md:text-base text-blue-600 hover:text-blue-800 hover:underline text-left truncate"
                        >
                          {artist.artist_name}
                        </button>
                      </div>
                      <span className="text-xs md:text-base text-gray-600 font-medium whitespace-nowrap ml-2">
                        {artist.show_count} shows
                      </span>
                    </div>
                  ))}
                </div>
                {topArtists.length > 10 && (
                  <button
                    onClick={() => setShowAllArtists(!showAllArtists)}
                    className="mt-4 text-blue-600 hover:text-blue-800 text-xs md:text-sm font-medium"
                  >
                    {showAllArtists ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">No shows in this period</p>
            )}
          </div>

          {/* Top Venues */}
          <div className="bg-white rounded-lg shadow-lg p-4 md:p-6">
            <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-4 md:mb-6">
              Top {showAllVenues ? '25' : '10'} Venues
              {filterContext && (
                <span className="text-sm md:text-base font-normal text-gray-600 ml-2">({filterContext})</span>
              )}
            </h2>
            {topVenues.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topVenues.slice(0, showAllVenues ? 25 : 10).map((venue, index) => (
                    <div key={venue.venue_id} className="flex items-center justify-between border-b pb-2">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <span className="text-base md:text-lg font-semibold text-gray-400 w-4 md:w-6 flex-shrink-0">
                          {index + 1}
                        </span>
                        <button
                          onClick={() => router.push(`/browse?venue_id=${venue.venue_id}`)}
                          className="text-sm md:text-base text-blue-600 hover:text-blue-800 hover:underline text-left truncate"
                        >
                          {venue.venue_name}
                        </button>
                      </div>
                      <span className="text-xs md:text-base text-gray-600 font-medium whitespace-nowrap ml-2">
                        {venue.show_count} shows
                      </span>
                    </div>
                  ))}
                </div>
                {topVenues.length > 10 && (
                  <button
                    onClick={() => setShowAllVenues(!showAllVenues)}
                    className="mt-4 text-blue-600 hover:text-blue-800 text-xs md:text-sm font-medium"
                  >
                    {showAllVenues ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-500">No shows in this period</p>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

// Stats Card Component - Mobile Responsive
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-3 md:p-4">
      <p className="text-xs md:text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-xl md:text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
