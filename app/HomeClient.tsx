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

type CapacityBucket = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type CapacityFilter = 'all' | CapacityBucket
type Decade = 'all' | '1900s' | '1910s' | '1920s' | '1930s' | '1940s' | '1950s' | '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'

const CAPACITY_META: Record<CapacityBucket, {
  label: string
  legendLabel: string
  tooltipLabel: string
  tooltip: string
  unselectedClass: string
  bg: string
  border: string
  hoverBg: string
}> = {
  small:   { label: 'S',  legendLabel: 'Small (<500)',      tooltipLabel: 'Small',   tooltip: 'Small (< 500)',     unselectedClass: 'text-purple-400 dark:text-purple-300',  bg: 'rgba(139, 92, 192, 0.7)',   border: 'rgba(139, 92, 192, 1)',  hoverBg: 'rgba(139, 92, 192, 0.9)' },
  medium:  { label: 'M',  legendLabel: 'Medium (500–1.5K)', tooltipLabel: 'Medium',  tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-teal-600 dark:text-teal-400',      bg: 'rgba(13, 148, 136, 0.75)',  border: 'rgba(13, 148, 136, 1)',  hoverBg: 'rgba(13, 148, 136, 0.95)' },
  large:   { label: 'L',  legendLabel: 'Large (1.5K–10K)',  tooltipLabel: 'Large',   tooltip: 'Large (1.5K–10K)',  unselectedClass: 'text-orange-600 dark:text-orange-400',  bg: 'rgba(234, 88, 12, 0.75)',   border: 'rgba(234, 88, 12, 1)',   hoverBg: 'rgba(234, 88, 12, 0.95)' },
  xlarge:  { label: 'XL', legendLabel: 'X-Large (10K+)',    tooltipLabel: 'X-Large', tooltip: 'X-Large (10K+)',    unselectedClass: 'text-rose-600 dark:text-rose-400',      bg: 'rgba(225, 29, 72, 0.75)',   border: 'rgba(225, 29, 72, 1)',   hoverBg: 'rgba(225, 29, 72, 0.95)' },
  unknown: { label: '?',  legendLabel: 'Unknown',           tooltipLabel: 'Unknown', tooltip: 'Unknown capacity',  unselectedClass: 'text-gray-400 dark:text-gray-500',      bg: 'rgba(156, 163, 175, 0.65)', border: 'rgba(156, 163, 175, 1)', hoverBg: 'rgba(156, 163, 175, 0.8)' },
}

const LEGEND_TO_TOOLTIP: Record<string, string> = Object.fromEntries(
  Object.values(CAPACITY_META).map(m => [m.legendLabel, m.tooltipLabel])
)

const CAPACITY_BUCKETS: CapacityBucket[] = ['small', 'medium', 'large', 'xlarge', 'unknown']
const CAPACITY_BUTTON_ORDER: (CapacityFilter)[] = ['small', 'medium', 'large', 'xlarge', 'all', 'unknown']

const CAPACITY_DISPLAY_NAMES: Record<CapacityBucket, string> = {
  small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large', unknown: 'Unknown'
}

const DECADES: Decade[] = ['all', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const PRE1960_LABEL = 'Pre-1960s'

function capacityKey(category: string | null): CapacityBucket {
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
  const [mounted, setMounted] = useState(false)
  const [selectedDecade, setSelectedDecade] = useState<Decade>('all')
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null)
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues, setShowAllVenues] = useState(false)
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')

  useEffect(() => { setMounted(true) }, [])

  const isDrilled = selectedDecade !== 'all' || selectedYear !== null || selectedMonth !== null
  const hasActiveFilter = isDrilled || capacityFilter !== 'all'

  const handleClearAll = () => {
    setSelectedDecade('all')
    setSelectedYear(null)
    setSelectedMonth(null)
    setCapacityFilter('all')
  }

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

    let fourthCard: { label: string; value: string } | null = null
    if (selectedYear && !selectedMonth) {
      const avg = Math.round(totalShows / 12)
      fourthCard = { label: 'Shows per Month', value: avg.toLocaleString() }
    } else if (selectedDecade !== 'all' && !selectedYear) {
      const avg = Math.round(totalShows / 10)
      fourthCard = { label: 'Shows per Year', value: avg.toLocaleString() }
    } else if (selectedDecade === 'all' && !selectedYear) {
      fourthCard = { label: 'Date Range', value: '1900–2026' }
    }

    return { totalShows, uniqueArtists, uniqueVenues, fourthCard }
  }, [filteredShows, selectedDecade, selectedYear, selectedMonth])

  const chartData = useMemo(() => {
    if (selectedMonth !== null && selectedYear) return { labels: [], datasets: [] }

    let labels: string[] = []
    let getBucket: (show: Show) => string

    if (selectedYear) {
      labels = MONTH_NAMES
      getBucket = (show) => MONTH_NAMES[parseInt(show.date.split('-')[1]) - 1]
    } else if (selectedDecade === 'all') {
      labels = [PRE1960_LABEL, '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
      getBucket = (show) => {
        const year = new Date(show.date + 'T12:00:00').getFullYear()
        if (year < 1960) return PRE1960_LABEL
        return `${Math.floor(year / 10) * 10}s`
      }
    } else {
      const decadeStart = parseInt(selectedDecade.substring(0, 4))
      labels = Array.from({ length: 10 }, (_, i) => (decadeStart + i).toString())
      getBucket = (show) => new Date(show.date + 'T12:00:00').getFullYear().toString()
    }

    const labelSet = new Set(labels)
    const chartShows = selectedDecade === 'all' && !selectedYear
      ? (venueFilteredIds !== null ? shows.filter(s => venueFilteredIds.has(s.venue_id)) : shows)
      : filteredShows

    const counts: Record<CapacityBucket, Record<string, number>> = {
      small:   Object.fromEntries(labels.map(l => [l, 0])),
      medium:  Object.fromEntries(labels.map(l => [l, 0])),
      large:   Object.fromEntries(labels.map(l => [l, 0])),
      xlarge:  Object.fromEntries(labels.map(l => [l, 0])),
      unknown: Object.fromEntries(labels.map(l => [l, 0])),
    }

    chartShows.forEach(show => {
      const bucket = getBucket(show)
      if (!labelSet.has(bucket)) return
      const venue = venueMap.get(show.venue_id)
      const cap = capacityKey(venue?.capacity_category ?? null)
      counts[cap][bucket] = (counts[cap][bucket] || 0) + 1
    })

    const columnTotals: Record<string, number> = {}
    labels.forEach(l => {
      columnTotals[l] = CAPACITY_BUCKETS.reduce((sum, k) => sum + (counts[k][l] || 0), 0)
    })

    return {
      labels,
      datasets: CAPACITY_BUCKETS.map(k => ({
        label: CAPACITY_META[k].legendLabel,
        data: labels.map(l => counts[k][l] || 0),
        backgroundColor: CAPACITY_META[k].bg,
        hoverBackgroundColor: CAPACITY_META[k].hoverBg,
        borderColor: CAPACITY_META[k].border,
        borderWidth: 0,
        hoverBorderWidth: 1,
        stack: 'stack',
        columnTotals,
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
        labels: { boxWidth: 14, padding: 12, font: { size: 12 } },
        onClick: () => {}
      },
      title: { display: false },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
        callbacks: {
          title: (items: any[]) => {
            if (!items.length) return ''
            const label = items[0].label
            if (label === PRE1960_LABEL) return `${PRE1960_LABEL} (1900–1959)`
            // Expand short month name to full name + year in year drilldown
            if (selectedYear) {
              const monthIndex = MONTH_NAMES.indexOf(label)
              if (monthIndex !== -1) return `${MONTH_NAMES_FULL[monthIndex]} ${selectedYear}`
            }
            return label
          },
          label: (item: any) => {
            const dataset = item.chart.data.datasets[item.datasetIndex]
            const columnTotals = dataset.columnTotals as Record<string, number>
            const label = item.chart.data.labels[item.dataIndex] as string
            const total = columnTotals[label] || 0
            const value = item.parsed.y
            if (value === 0) return undefined
            const pct = total > 0 ? Math.round((value / total) * 100) : 0
            const shortLabel = LEGEND_TO_TOOLTIP[item.dataset.label] ?? item.dataset.label
            return `${shortLabel}: ${pct}%`
          },
          footer: (items: any[]) => {
            if (!items.length) return ''
            const total = items.reduce((sum: number, item: any) => sum + (item.parsed.y || 0), 0)
            return `Total: ${total.toLocaleString()} shows`
          }
        }
      }
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { display: false } },
      y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { display: false }, border: { display: false } }
    },
    onClick: (event: any, elements: any) => {
      if (elements.length > 0) {
        const index = elements[0].index
        if (selectedYear) {
          router.push(`/browse?year=${selectedYear}&month=${index + 1}`)
        } else if (selectedDecade === 'all') {
          const label = chartData.labels?.[index] as string
          if (label === PRE1960_LABEL) {
            setSelectedDecade('1950s'); setSelectedYear(null); setSelectedMonth(null)
          } else {
            setSelectedDecade(label as Decade); setSelectedYear(null); setSelectedMonth(null)
          }
        } else {
          setSelectedYear(parseInt(selectedDecade.substring(0, 4)) + index)
          setSelectedMonth(null)
        }
      }
    }
  }), [selectedDecade, selectedYear, chartData, router])

  const chartNav = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return { title: `Shows in ${MONTH_NAMES[selectedMonth]} ${selectedYear}`, prev: null, next: null }
    }
    if (selectedYear) {
      const prev = selectedYear - 1
      const next = selectedYear + 1
      return {
        title: `Shows in ${selectedYear}`,
        prev: prev >= 1900 ? { label: `← ${prev}`, onClick: () => { setSelectedYear(prev); setSelectedDecade(`${Math.floor(prev / 10) * 10}s` as Decade) } } : null,
        next: next <= 2026 ? { label: `${next} →`, onClick: () => { setSelectedYear(next); setSelectedDecade(`${Math.floor(next / 10) * 10}s` as Decade) } } : null,
      }
    }
    if (selectedDecade !== 'all') {
      const s = parseInt(selectedDecade.substring(0, 4))
      return {
        title: `Shows in the ${selectedDecade}`,
        prev: s - 10 >= 1900 ? { label: `← ${s - 10}s`, onClick: () => { setSelectedDecade(`${s - 10}s` as Decade); setSelectedYear(null) } } : null,
        next: s + 10 <= 2020 ? { label: `${s + 10}s →`, onClick: () => { setSelectedDecade(`${s + 10}s` as Decade); setSelectedYear(null) } } : null,
      }
    }
    return { title: 'Shows by Decade', prev: null, next: null }
  }, [selectedDecade, selectedYear, selectedMonth])

  const filterContext = useMemo(() => {
    const parts: string[] = []
    if (selectedMonth !== null && selectedYear) parts.push(`${MONTH_NAMES[selectedMonth]} ${selectedYear}`)
    else if (selectedYear) parts.push(selectedYear.toString())
    else if (selectedDecade !== 'all') parts.push(selectedDecade)
    if (capacityFilter !== 'all') parts.push(`${CAPACITY_DISPLAY_NAMES[capacityFilter]} Venues`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [selectedDecade, selectedYear, selectedMonth, capacityFilter])

  return (
    <main className="min-h-screen bg-background py-4 md:py-6 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2 md:gap-3 mb-3 md:mb-4">
          <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          {stats.fourthCard ? (
            <StatCard label={stats.fourthCard.label} value={stats.fourthCard.value} />
          ) : (
            <div />
          )}
        </div>

        {/* Chart nav */}
        <div className="flex items-center justify-center gap-4 mb-2 min-h-[32px]">
          {chartNav.prev ? (
            <button
              onClick={chartNav.prev.onClick}
              className="text-primary hover:opacity-80 font-medium text-xs md:text-sm whitespace-nowrap"
            >
              {chartNav.prev.label}
            </button>
          ) : (
            <span className="invisible text-xs md:text-sm font-medium whitespace-nowrap select-none">
              {chartNav.next?.label ?? '​'}
            </span>
          )}

          <h2 className="text-xl md:text-2xl font-bold text-foreground whitespace-nowrap">
            {chartNav.title}
          </h2>

          {chartNav.next ? (
            <button
              onClick={chartNav.next.onClick}
              className="text-primary hover:opacity-80 font-medium text-xs md:text-sm whitespace-nowrap"
            >
              {chartNav.next.label}
            </button>
          ) : (
            <span className="invisible text-xs md:text-sm font-medium whitespace-nowrap select-none">
              {chartNav.prev?.label ?? '​'}
            </span>
          )}
        </div>

        {/* Chart card */}
        <div className="bg-card rounded-lg shadow-lg p-4 md:p-4 mb-3 md:mb-4">
          <div style={{ height: '320px', cursor: 'pointer' }} className="md:h-[420px]">
            <Bar data={chartData} options={chartOptions} />
          </div>
        </div>

        {/* Filters card */}
        <div className="bg-card rounded-lg shadow-lg p-3 md:p-4 mb-3 md:mb-4 space-y-3">

          {/* Row 1: Venue buttons + Year dropdown + Clear All */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">Venue:</span>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
              {CAPACITY_BUTTON_ORDER.map(k => {
                const isAll = k === 'all'
                const isActive = capacityFilter === k
                const unselectedClass = isAll ? 'text-muted-foreground' : CAPACITY_META[k as CapacityBucket].unselectedClass
                const label = isAll ? 'All' : CAPACITY_META[k as CapacityBucket].label
                const tooltip = isAll ? 'All venues' : CAPACITY_META[k as CapacityBucket].tooltip
                return (
                  <button
                    key={k}
                    onClick={() => setCapacityFilter(k)}
                    title={tooltip}
                    className={`px-2 py-1.5 transition-colors ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : `bg-card ${unselectedClass} hover:bg-muted`
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>

            <span className="text-border select-none hidden md:inline">|</span>

            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap hidden md:inline">Year:</span>
            <select
              value={selectedYear || ''}
              onChange={(e) => {
                const year = e.target.value ? parseInt(e.target.value) : null
                setSelectedYear(year); setSelectedMonth(null)
                if (year) setSelectedDecade(`${Math.floor(year / 10) * 10}s` as Decade)
              }}
              className="w-28 px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All years</option>
              {Array.from({ length: 127 }, (_, i) => 1900 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {hasActiveFilter && (
              <button
                onClick={handleClearAll}
                className="text-xs border border-border rounded px-2 py-1.5 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors whitespace-nowrap"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Row 2: Decade buttons — horizontal scroll only */}
          <div className="overflow-x-auto -mx-3 px-3 md:-mx-4 md:px-4">
            <div className="flex gap-2 min-w-max">
              {DECADES.map((decade) => {
                const isActive = selectedDecade === decade && !selectedYear && selectedMonth === null
                const isParentDecade = selectedYear !== null && decade !== 'all' &&
                  `${Math.floor(selectedYear / 10) * 10}s` === decade
                return (
                  <button
                    key={decade}
                    onClick={() => { setSelectedDecade(decade); setSelectedYear(null); setSelectedMonth(null) }}
                    className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : isParentDecade
                        ? 'bg-primary/20 text-primary border border-primary/40'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {decade === 'all' ? 'All Time' : decade}
                    {isParentDecade && (
                      <span className="ml-1 text-[10px] opacity-75">› {selectedYear}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

        </div>

        {/* Top tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
              Top {showAllArtists ? '25' : '10'} Artists
              {filterContext && <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">({filterContext})</span>}
            </h2>
            {topArtists.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topArtists.slice(0, showAllArtists ? 25 : 10).map((artist, index) => (
                    <div key={artist.artist_id} className="flex items-center justify-between py-0.5">
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
                  <button onClick={() => setShowAllArtists(!showAllArtists)} className="mt-3 text-primary hover:opacity-80 text-xs md:text-sm font-medium">
                    {showAllArtists ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : <p className="text-sm text-muted-foreground">No shows in this period</p>}
          </div>

          <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
              Top {showAllVenues ? '25' : '10'} Venues
              {filterContext && <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">({filterContext})</span>}
            </h2>
            {topVenues.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {topVenues.slice(0, showAllVenues ? 25 : 10).map((venue, index) => (
                    <div key={venue.venue_id} className="flex items-center justify-between py-0.5">
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
                  <button onClick={() => setShowAllVenues(!showAllVenues)} className="mt-3 text-primary hover:opacity-80 text-xs md:text-sm font-medium">
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
