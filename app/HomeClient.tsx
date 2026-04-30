'use client'

import { useState, useMemo, useEffect } from 'react'
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
import { useTheme } from 'next-themes'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

type Show = {
  show_id: number
  date: string
  artist_id: number
  venue_id: number
  show_type: string | null
}

type Artist = {
  artist_id: number
  artist_name: string
}

type Venue = {
  venue_id: number
  venue_name: string
  capacity_category: string | null
  status: string | null
}

type Decade = 'all' | '1900s' | '1910s' | '1920s' | '1930s' | '1940s' | '1950s' | '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'

const DECADES: Decade[] = ['all', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const CAPACITY_BUTTONS: {
  key: CapacityFilter
  label: string
  tooltip: string
  unselectedClass: string
}[] = [
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     unselectedClass: 'text-purple-600 dark:text-purple-400' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-teal-600 dark:text-teal-400' },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  unselectedClass: 'text-orange-600 dark:text-orange-400' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    unselectedClass: 'text-rose-600 dark:text-rose-400' },
  { key: 'all',     label: 'All', tooltip: 'All venues',        unselectedClass: 'text-muted-foreground' },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  unselectedClass: 'text-gray-400 dark:text-gray-500' },
]

const CAPACITY_COLORS = {
  small:   { bg: 'rgba(147, 51, 234, 0.75)',  border: 'rgba(147, 51, 234, 1)'  },
  medium:  { bg: 'rgba(13, 148, 136, 0.75)',  border: 'rgba(13, 148, 136, 1)'  },
  large:   { bg: 'rgba(234, 88, 12, 0.75)',   border: 'rgba(234, 88, 12, 1)'   },
  xlarge:  { bg: 'rgba(225, 29, 72, 0.75)',   border: 'rgba(225, 29, 72, 1)'   },
  unknown: { bg: 'rgba(156, 163, 175, 0.5)',  border: 'rgba(156, 163, 175, 1)' },
}

function capacityKey(category: string | null): CapacityFilter {
  if (!category) return 'unknown'
  const c = category.toLowerCase()
  if (c.includes('small')) return 'small'
  if (c.includes('medium')) return 'medium'
  if (c.includes('x-large')) return 'xlarge'
  if (c.includes('large')) return 'large'
  return 'unknown'
}

export default function HomeClient({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [selectedDecade, setSelectedDecade] = useState<Decade>('all')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues, setShowAllVenues] = useState(false)
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')

  useEffect(() => { setMounted(true) }, [])

  const artistMap = useMemo(() => {
    const map = new Map<number, Artist>()
    artists.forEach(a => map.set(a.artist_id, a))
    return map
  }, [artists])

  const venueMap = useMemo(() => {
    const map = new Map<number, Venue>()
    venues.forEach(v => map.set(v.venue_id, v))
    return map
  }, [venues])

  const venueFilteredIds = useMemo(() => {
    if (capacityFilter === 'all') return null
    const ids = new Set<number>()
    venues.forEach(v => {
      if (capacityKey(v.capacity_category) === capacityFilter) ids.add(v.venue_id)
    })
    return ids
  }, [venues, capacityFilter])

  const filteredShows = useMemo(() => {
    let filtered = shows
    if (venueFilteredIds !== null) {
      filtered = filtered.filter(s => venueFilteredIds.has(s.venue_id))
    }
    if (selectedMonth !== null && selectedYear) {
      return filtered.filter(show => {
        const date = new Date(show.date + 'T12:00:00')
        return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth
      })
    }
    if (selectedYear) {
      return filtered.filter(show => new Date(show.date + 'T12:00:00').getFullYear() === selectedYear)
    }
    if (selectedDecade === 'all') return filtered
    const decadeStart = parseInt(selectedDecade.substring(0, 4))
    const decadeEnd = decadeStart + 9
    return filtered.filter(show => {
      const year = new Date(show.date + 'T12:00:00').getFullYear()
      return year >= decadeStart && year <= decadeEnd
    })
  }, [shows, selectedDecade, selectedYear, selectedMonth, venueFilteredIds])

  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map(s => s.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map(s => s.venue_id)).size
    let showsPerYear = null
    if (selectedDecade !== 'all' && !selectedYear && !selectedMonth) {
      showsPerYear = parseInt((totalShows / 10).toFixed(0)).toLocaleString()
    }
    return { totalShows, uniqueArtists, uniqueVenues, showsPerYear }
  }, [filteredShows, selectedDecade, selectedYear, selectedMonth])

  const chartData = useMemo(() => {
    if (selectedMonth !== null && selectedYear) return { labels: [], datasets: [] }

    let labels: string[] = []
    let getBucket: (show: Show) => string

    if (selectedYear) {
      labels = MONTH_NAMES
      getBucket = (show) => MONTH_NAMES[parseInt(show.date.split('-')[1]) - 1]
    } else if (selectedDecade === 'all') {
      labels = DECADES.filter(d => d !== 'all')
      getBucket = (show) => {
        const year = new Date(show.date + 'T12:00:00').getFullYear()
        return `${Math.floor(year / 10) * 10}s`
      }
    } else {
      const decadeStart = parseInt(selectedDecade.substring(0, 4))
      labels = Array.from({ length: 10 }, (_, i) => (decadeStart + i).toString())
      getBucket = (show) => new Date(show.date + 'T12:00:00').getFullYear().toString()
    }

    const chartShows = selectedDecade === 'all' && !selectedYear
      ? (venueFilteredIds !== null ? shows.filter(s => venueFilteredIds.has(s.venue_id)) : shows)
      : filteredShows

    const capacityKeys: CapacityFilter[] = ['small', 'medium', 'large', 'xlarge', 'unknown']
    const counts: Record<CapacityFilter, Record<string, number>> = {
      small: {}, medium: {}, large: {}, xlarge: {}, unknown: {}, all: {}
    }
    labels.forEach(l => capacityKeys.forEach(k => { counts[k][l] = 0 }))

    chartShows.forEach(show => {
      const bucket = getBucket(show)
      if (!labels.includes(bucket)) return
      const venue = venueMap.get(show.venue_id)
      const cap = capacityKey(venue?.capacity_category ?? null)
      counts[cap][bucket] = (counts[cap][bucket] || 0) + 1
    })

    const capacityLabels: Record<CapacityFilter, string> = {
      small: 'Small (<500)', medium: 'Medium (500–1.5K)', large: 'Large (1.5K–10K)',
      xlarge: 'X-Large (10K+)', unknown: 'Unknown', all: 'All'
    }

    return {
      labels,
      datasets: capacityKeys.map(k => ({
        label: capacityLabels[k],
        data: labels.map(l => counts[k][l] || 0),
        backgroundColor: CAPACITY_COLORS[k].bg,
        borderColor: CAPACITY_COLORS[k].border,
        borderWidth: 0,
        stack: 'stack',
      }))
    }
  }, [shows, filteredShows, selectedDecade, selectedYear, selectedMonth, venueMap, venueFilteredIds])

  const topArtists = useMemo(() => {
    const counts: { [key: number]: number } = {}
    filteredShows.forEach(show => { counts[show.artist_id] = (counts[show.artist_id] || 0) + 1 })
    return Object.entries(counts)
      .map(([id, count]) => ({ artist_id: parseInt(id), artist_name: artistMap.get(parseInt(id))?.artist_name || '', show_count: count }))
      .sort((a, b) => b.show_count - a.show_count)
  }, [filteredShows, artistMap])

  const topVenues = useMemo(() => {
    const counts: { [key: number]: number } = {}
    filteredShows.forEach(show => { counts[show.venue_id] = (counts[show.venue_id] || 0) + 1 })
    return Object.entries(counts)
      .map(([id, count]) => ({ venue_id: parseInt(id), venue_name: venueMap.get(parseInt(id))?.venue_name || '', show_count: count }))
      .sort((a, b) => b.show_count - a.show_count)
  }, [filteredShows, venueMap])

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: { boxWidth: 12, padding: 10, font: { size: 10 } },
        onClick: () => {}
      },
      title: { display: false },
      tooltip: { mode: 'index' as const, intersect: false }
    },
    scales: {
      x: { stacked: true },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
    },
    onClick: (event: any, elements: any) => {
      if (elements.length > 0) {
        const index = elements[0].index
        if (selectedYear) {
          router.push(`/browse?year=${selectedYear}&month=${index + 1}`)
        } else if (selectedDecade === 'all') {
          const clickedDecade = DECADES.filter(d => d !== 'all')[index] as Decade
          setSelectedDecade(clickedDecade); setSelectedYear(null); setSelectedMonth(null)
        } else {
          setSelectedYear(parseInt(selectedDecade.substring(0, 4)) + index)
          setSelectedMonth(null)
        }
      }
    }
  }), [selectedDecade, selectedYear, router])

  const chartTitle = useMemo(() => {
    if (selectedMonth !== null && selectedYear) return `Shows in ${MONTH_NAMES[selectedMonth]} ${selectedYear}`
    if (selectedYear) return `Shows in ${selectedYear}`
    if (selectedDecade === 'all') return 'Shows by Decade'
    return `Shows in the ${selectedDecade}`
  }, [selectedDecade, selectedYear, selectedMonth])

  const filterContext = useMemo(() => {
    const parts: string[] = []
    if (selectedMonth !== null && selectedYear) parts.push(`${MONTH_NAMES[selectedMonth]} ${selectedYear}`)
    else if (selectedYear) parts.push(selectedYear.toString())
    else if (selectedDecade !== 'all') parts.push(selectedDecade)
    if (capacityFilter !== 'all') {
      const labels: Record<CapacityFilter, string> = {
        small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large', unknown: 'Unknown Capacity', all: ''
      }
      parts.push(`${labels[capacityFilter]} Venues`)
    }
    return parts.length > 0 ? parts.join(' · ') : null
  }, [selectedDecade, selectedYear, selectedMonth, capacityFilter])

  const breadcrumb = useMemo(() => {
    const crumbs: { label: string; onClick: () => void; active: boolean }[] = []
    crumbs.push({
      label: 'All Time',
      onClick: () => { setSelectedDecade('all'); setSelectedYear(null); setSelectedMonth(null) },
      active: selectedDecade === 'all' && !selectedYear && selectedMonth === null
    })
    if (selectedDecade !== 'all' || selectedYear || selectedMonth !== null) {
      const decade = selectedYear ? `${Math.floor(selectedYear / 10) * 10}s` as Decade : selectedDecade
      crumbs.push({
        label: decade,
        onClick: () => { setSelectedDecade(decade); setSelectedYear(null); setSelectedMonth(null) },
        active: selectedDecade !== 'all' && !selectedYear && selectedMonth === null
      })
    }
    if (selectedYear) {
      crumbs.push({ label: selectedYear.toString(), onClick: () => { setSelectedMonth(null) }, active: !!selectedYear && selectedMonth === null })
    }
    if (selectedMonth !== null && selectedYear) {
      crumbs.push({ label: MONTH_NAMES[selectedMonth], onClick: () => { }, active: true })
    }
    return crumbs
  }, [selectedDecade, selectedYear, selectedMonth])

  const navigation = useMemo(() => {
    if (selectedDecade === 'all' && !selectedYear) return null
    if (selectedYear && selectedMonth === null) {
      const prevYear = selectedYear - 1
      const nextYear = selectedYear + 1
      return {
        previous: prevYear >= 1900 ? { label: `← ${prevYear}`, onClick: () => { setSelectedYear(prevYear); setSelectedDecade(`${Math.floor(prevYear / 10) * 10}s` as Decade) } } : null,
        next: nextYear <= 2026 ? { label: `${nextYear} →`, onClick: () => { setSelectedYear(nextYear); setSelectedDecade(`${Math.floor(nextYear / 10) * 10}s` as Decade) } } : null
      }
    }
    if (selectedDecade !== 'all') {
      const currentDecadeStart = parseInt(selectedDecade.substring(0, 4))
      const prevDecadeStart = currentDecadeStart - 10
      const nextDecadeStart = currentDecadeStart + 10
      return {
        previous: prevDecadeStart >= 1900 ? { label: `← ${prevDecadeStart}s`, onClick: () => { setSelectedDecade(`${prevDecadeStart}s` as Decade); setSelectedYear(null) } } : null,
        next: nextDecadeStart <= 2020 ? { label: `${nextDecadeStart}s →`, onClick: () => { setSelectedDecade(`${nextDecadeStart}s` as Decade); setSelectedYear(null) } } : null
      }
    }
    return null
  }, [selectedDecade, selectedYear, selectedMonth])

  return (
    <main className="min-h-screen bg-background py-4 md:py-8 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Header — Browse All removed */}
        <div className="mb-4 md:mb-6 text-center">
          <h1 className="hidden md:block text-5xl font-bold text-foreground mb-4">
            Vancouver Concert History
          </h1>
          <p className="text-sm md:text-xl text-muted-foreground">
            {shows.length.toLocaleString()} shows • 1900-2026
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2 md:gap-4 mb-4 md:mb-6">
          <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          {stats.showsPerYear && !selectedYear ? (
            <StatCard label="Shows per Year" value={stats.showsPerYear} />
          ) : (
            <div />
          )}
        </div>

        {/* Shows Chart */}
        <div className="bg-card rounded-lg shadow-lg p-4 md:p-5 mb-4 md:mb-6">

          {/* Breadcrumb */}
          <div className="mb-3 min-h-[1.25rem] flex items-center gap-2 text-xs md:text-sm">
            {breadcrumb.map((crumb, index) => (
              <div key={crumb.label} className="flex items-center gap-2">
                {index > 0 && <span className="text-muted-foreground">›</span>}
                <button
                  onClick={crumb.onClick}
                  className={`${crumb.active ? 'text-foreground font-medium cursor-default' : 'text-primary hover:opacity-80 hover:underline'}`}
                  disabled={crumb.active}
                >
                  {crumb.label}
                </button>
              </div>
            ))}
          </div>

          {/* Title row — capacity buttons top-right, prev/next flank title */}
          <div className="mb-3 md:mb-4 min-h-[2rem]">
            {/* Capacity buttons — top right */}
            <div className="flex justify-end mb-1">
              <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                {CAPACITY_BUTTONS.map(btn => (
                  <button
                    key={btn.key}
                    onClick={() => setCapacityFilter(btn.key)}
                    title={btn.tooltip}
                    className={`px-2 py-1.5 transition-colors ${capacityFilter === btn.key
                        ? 'bg-primary text-primary-foreground'
                        : `bg-card ${btn.unselectedClass} hover:bg-muted`
                      }`}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
            {/* Prev | Title | Next — truly centered */}
            <div className="flex items-center justify-center gap-3 md:gap-6">
              <div className="w-20 md:w-32 flex justify-start">
                {navigation?.previous && (
                  <button onClick={navigation.previous.onClick}
                    className="text-primary hover:opacity-80 font-medium text-xs md:text-sm whitespace-nowrap">
                    {navigation.previous.label}
                  </button>
                )}
              </div>
              <h2 className="text-base md:text-xl font-bold text-foreground text-center">
                {chartTitle}
              </h2>
              <div className="w-20 md:w-32 flex justify-end">
                {navigation?.next && (
                  <button onClick={navigation.next.onClick}
                    className="text-primary hover:opacity-80 font-medium text-xs md:text-sm whitespace-nowrap">
                    {navigation.next.label}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ height: '280px', cursor: 'pointer' }} className="md:h-[300px]">
            <Bar data={chartData} options={chartOptions} />
          </div>
          <p className="text-xs md:text-sm text-muted-foreground mt-2 text-center">
            {selectedYear ? 'Click a month to view shows in Browse' : 'Click a bar to drill down'}
          </p>
        </div>

        {/* Decade/Year Filter */}
        <div className="bg-card rounded-lg shadow-lg p-4 md:p-5 mb-4 md:mb-6">
          <h2 className="text-lg md:text-xl font-bold text-foreground mb-3 md:mb-4">Filter by Decade</h2>
          <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
            <div className="flex md:flex-wrap gap-2 mb-4 min-w-max md:min-w-0">
              {DECADES.map((decade) => (
                <button
                  key={decade}
                  onClick={() => { setSelectedDecade(decade); setSelectedYear(null); setSelectedMonth(null) }}
                  className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                    selectedDecade === decade && !selectedYear && selectedMonth === null
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {decade === 'all' ? 'All Time' : decade}
                </button>
              ))}
            </div>
          </div>
          <div className="pt-2">
            <label className="block text-xs md:text-sm font-medium text-foreground mb-2">Or view a specific year:</label>
            <select
              value={selectedYear || ''}
              onChange={(e) => {
                const year = e.target.value ? parseInt(e.target.value) : null
                setSelectedYear(year); setSelectedMonth(null)
                if (year) setSelectedDecade(`${Math.floor(year / 10) * 10}s` as Decade)
              }}
              className="w-full md:w-64 px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select year...</option>
              {Array.from({ length: 127 }, (_, i) => 1900 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Two columns for tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
          {/* Top Artists */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-4 md:mb-6">
              Top {showAllArtists ? '25' : '10'} Artists
              {filterContext && <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">({filterContext})</span>}
            </h2>
            {topArtists.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topArtists.slice(0, showAllArtists ? 25 : 10).map((artist, index) => (
                    <div key={artist.artist_id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <span className="text-base md:text-lg font-semibold text-muted-foreground w-4 md:w-6 flex-shrink-0">{index + 1}</span>
                        <button onClick={() => router.push(`/browse?artist_id=${artist.artist_id}`)}
                          className="text-sm md:text-base text-primary hover:opacity-80 hover:underline text-left truncate">
                          {artist.artist_name}
                        </button>
                      </div>
                      <span className="text-xs md:text-base text-muted-foreground font-medium whitespace-nowrap ml-2">
                        {artist.show_count.toLocaleString()} shows
                      </span>
                    </div>
                  ))}
                </div>
                {topArtists.length > 10 && (
                  <button onClick={() => setShowAllArtists(!showAllArtists)} className="mt-4 text-primary hover:opacity-80 text-xs md:text-sm font-medium">
                    {showAllArtists ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No shows in this period</p>}
          </div>

          {/* Top Venues */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-4 md:mb-6">
              Top {showAllVenues ? '25' : '10'} Venues
              {filterContext && <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">({filterContext})</span>}
            </h2>
            {topVenues.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topVenues.slice(0, showAllVenues ? 25 : 10).map((venue, index) => (
                    <div key={venue.venue_id} className="flex items-center justify-between py-1">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0">
                        <span className="text-base md:text-lg font-semibold text-muted-foreground w-4 md:w-6 flex-shrink-0">{index + 1}</span>
                        <button onClick={() => router.push(`/browse?venue_id=${venue.venue_id}`)}
                          className="text-sm md:text-base text-primary hover:opacity-80 hover:underline text-left truncate">
                          {venue.venue_name}
                        </button>
                      </div>
                      <span className="text-xs md:text-base text-muted-foreground font-medium whitespace-nowrap ml-2">
                        {venue.show_count.toLocaleString()} shows
                      </span>
                    </div>
                  ))}
                </div>
                {topVenues.length > 10 && (
                  <button onClick={() => setShowAllVenues(!showAllVenues)} className="mt-4 text-primary hover:opacity-80 text-xs md:text-sm font-medium">
                    {showAllVenues ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No shows in this period</p>}
          </div>
        </div>
      </div>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow p-2 md:p-4">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className="text-base md:text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}
