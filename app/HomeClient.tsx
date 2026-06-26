'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
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
import type { ChartRow, TopArtist, TopVenue, CityStats, HomeStats, DrillStats } from './page'
import CountryFlag from './components/CountryFlag'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const ProvinceMap = dynamic(() => import('./ProvinceMap'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────
type CapacityBucket = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type CapacityFilter = 'all' | CapacityBucket
type Decade = 'all' | '1900s' | '1910s' | '1920s' | '1930s' | '1940s' | '1950s' | '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s'

// ── Capacity metadata (unchanged from original) ───────────────
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
  medium:  { label: 'M',  legendLabel: 'Medium (500–1.5K)', tooltipLabel: 'Medium',  tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-[#3A8FBD]',                        bg: 'rgba(58, 143, 189, 0.75)',  border: 'rgba(58, 143, 189, 1)',  hoverBg: 'rgba(58, 143, 189, 0.95)' },
  large:   { label: 'L',  legendLabel: 'Large (1.5K–10K)',  tooltipLabel: 'Large',   tooltip: 'Large (1.5K–10K)',  unselectedClass: 'text-orange-600 dark:text-orange-400',  bg: 'rgba(234, 88, 12, 0.75)',   border: 'rgba(234, 88, 12, 1)',   hoverBg: 'rgba(234, 88, 12, 0.95)' },
  xlarge:  { label: 'XL', legendLabel: 'X-Large (10K+)',    tooltipLabel: 'X-Large', tooltip: 'X-Large (10K+)',    unselectedClass: 'text-rose-600 dark:text-rose-400',      bg: 'rgba(225, 29, 72, 0.75)',   border: 'rgba(225, 29, 72, 1)',   hoverBg: 'rgba(225, 29, 72, 0.95)' },
  unknown: { label: '?',  legendLabel: 'Unknown',           tooltipLabel: 'Unknown', tooltip: 'Unknown capacity',  unselectedClass: 'text-gray-400 dark:text-gray-500',      bg: 'rgba(156, 163, 175, 0.65)', border: 'rgba(156, 163, 175, 1)', hoverBg: 'rgba(156, 163, 175, 0.8)' },
}

const LEGEND_TO_TOOLTIP: Record<string, string> = Object.fromEntries(
  Object.values(CAPACITY_META).map(m => [m.legendLabel, m.tooltipLabel])
)

const CAPACITY_BUCKETS: CapacityBucket[]             = ['small', 'medium', 'large', 'xlarge', 'unknown']
const CAPACITY_BUTTON_ORDER: CapacityFilter[]         = ['all', 'small', 'medium', 'large', 'xlarge', 'unknown']
const CAPACITY_DISPLAY_NAMES: Record<CapacityBucket, string> = {
  small: 'Small', medium: 'Medium', large: 'Large', xlarge: 'X-Large', unknown: 'Unknown'
}

// Inline badge styles for venue rows — matches VenueMap.tsx Discover page style
const CAPACITY_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  'Small (<500)':      { bg: 'rgba(139,92,246,0.18)', color: '#a78bfa', label: 'S'  },
  'Medium (500-1.5K)': { bg: 'rgba(58,143,189,0.18)', color: '#3A8FBD', label: 'M'  },
  'Large (1.5K-10K)':  { bg: 'rgba(234,88,12,0.18)',  color: '#f97316', label: 'L'  },
  'X-Large (10K+)':    { bg: 'rgba(225,29,72,0.18)',  color: '#fb7185', label: 'XL' },
}

// ── Artist city breakdown row (lazy-loaded on expand) ────────
type ArtistCityRow = { city: string; state: string | null; show_count: number }

// ── Province/state full names ─────────────────────────────────
const STATE_NAMES: Record<string, string> = {
  BC: 'British Columbia', ON: 'Ontario',    QC: 'Quebec',            AB: 'Alberta',
  MB: 'Manitoba',         SK: 'Saskatchewan', NS: 'Nova Scotia',     NB: 'New Brunswick',
  NL: 'Newfoundland & Labrador', PE: 'Prince Edward Island',
  NT: 'Northwest Territories',   YT: 'Yukon',                        NU: 'Nunavut',
  WA: 'Washington',       OR: 'Oregon',     CA: 'California',        NY: 'New York',
  IL: 'Illinois',         TX: 'Texas',      FL: 'Florida',           MI: 'Michigan',
  CO: 'Colorado',         OH: 'Ohio',       PA: 'Pennsylvania',      GA: 'Georgia',
  TN: 'Tennessee',        MA: 'Massachusetts', NV: 'Nevada',         AZ: 'Arizona',
  MN: 'Minnesota',        NC: 'North Carolina', MO: 'Missouri',      WI: 'Wisconsin',
  OK: 'Oklahoma',
}
const DECADES: Decade[] = ['all', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']
const MONTH_NAMES       = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES_FULL  = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const PRE1960_LABEL     = 'Pre-1960s'

// ── Helper: decade string → RPC p_decade param ────────────────
function decadeToParam(d: Decade): string | null {
  if (d === 'all') return null
  // Always pass the actual decade string (e.g. '1920s') so the RPC
  // filters to that specific decade. 'pre1960s' is only used by the
  // all-time chart aggregation bucket label, never for drill-down.
  return d
}

// ── Helper: capacity filter applied to ChartRow[] ────────────
function filterChartRows(rows: ChartRow[], cap: CapacityFilter): ChartRow[] {
  if (cap === 'all') return rows
  return rows.map(r => ({
    ...r,
    small:   cap === 'small'   ? r.small   : 0,
    medium:  cap === 'medium'  ? r.medium  : 0,
    large:   cap === 'large'   ? r.large   : 0,
    xlarge:  cap === 'xlarge'  ? r.xlarge  : 0,
    unknown: cap === 'unknown' ? r.unknown : 0,
  }))
}

// ── Helper: filter top lists by capacity ─────────────────────
function filterVenues(venues: TopVenue[], cap: CapacityFilter): TopVenue[] {
  if (cap === 'all') return venues
  const catMap: Record<CapacityBucket, string> = {
    small:   'Small (<500)',
    medium:  'Medium (500-1.5K)',
    large:   'Large (1.5K-10K)',
    xlarge:  'X-Large (10K+)',
    unknown: '',
  }
  return venues.filter(v =>
    cap === 'unknown'
      ? v.capacity_category === null
      : v.capacity_category === catMap[cap as CapacityBucket]
  )
}


// ── Country code normalizer (RPC returns full names; flags map on ISO codes) ─
function normalizeCountry(c: string | null): string | null {
  if (!c) return c
  const l = c.toLowerCase()
  if (l === 'canada')                    return 'CA'
  if (l === 'united states' || l === 'us' || l === 'usa') return 'US'
  return c
}

// ── Main component ────────────────────────────────────────────
export default function HomeClient({
  initialStats,
  initialChart,
  initialArtists,
  initialVenues,
  initialCityStats,
}: {
  initialStats:     HomeStats
  initialChart:     ChartRow[]
  initialArtists:   TopArtist[]
  initialVenues:    TopVenue[]
  initialCityStats: CityStats[]
}) {
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  // ── View state ────────────────────────────────────────────
  const [viewMode,         setViewMode]         = useState<'map' | 'chart'>('map')
  const [showSignUpBanner, setShowSignUpBanner] = useState(false)
  const [cityStatsData,    setCityStatsData]    = useState<CityStats[]>(
    () => initialCityStats.map(c => ({ ...c, country: normalizeCountry(c.country) }))
  )
  const [selectedDecade, setSelectedDecade] = useState<Decade>('all')
  const [selectedYear,   setSelectedYear]   = useState<number | null>(null)
  const [selectedMonth,  setSelectedMonth]  = useState<number | null>(null)
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues,  setShowAllVenues]  = useState(false)
  const [showAllCities,  setShowAllCities]  = useState(false)

  // ── GP-132/133: city stats + expand state ─────────────────
  const [expandedProvinces, setExpandedProvinces] = useState<Set<string>>(new Set())
  const [expandedArtists,   setExpandedArtists]   = useState<Set<number>>(new Set())
  const [artistCityData,    setArtistCityData]     = useState<Record<number, ArtistCityRow[]>>({})
  const [loadingArtistCity, setLoadingArtistCity]  = useState<Set<number>>(new Set())

  // ── Drill-down data state ─────────────────────────────────
  const [chartRows,   setChartRows]   = useState<ChartRow[]>(initialChart)
  const [artists,     setArtists]     = useState<TopArtist[]>(initialArtists)
  const [venues,      setVenues]      = useState<TopVenue[]>(initialVenues)
  const [drillStats,  setDrillStats]  = useState<DrillStats | null>(null)
  const [loading,     setLoading]     = useState(false)


  useEffect(() => { setMounted(true) }, [])

  // ── City stats fallback: re-fetch client-side if ISR cache served stale empty data ──
  useEffect(() => {
    if (initialCityStats.length === 0) {
      fetch('/api/home/city-stats')
        .then(r => {
          if (!r.ok) throw new Error(`city-stats ${r.status}`)
          return r.json()
        })
        .then(d => {
          const stats: CityStats[] = (d.cityStats ?? []).map((c: CityStats) => ({
            ...c,
            country: normalizeCountry(c.country),
          }))
          if (stats.length) setCityStatsData(stats)
        })
        .catch(err => console.error('[HomeClient] city-stats fallback failed:', err))
    }
  }, [initialCityStats.length])

  // ── Fetch drill-down data ─────────────────────────────────
  const fetchDrillData = useCallback(async (
    decade: Decade,
    year:   number | null,
    month:  number | null,
  ) => {
    const isAllTime = decade === 'all' && year === null && month === null

    if (isAllTime && initialChart.length > 0) {
      // Restore initial server-fetched data (ISR cache was fresh)
      setChartRows(initialChart)
      setArtists(initialArtists)
      setVenues(initialVenues)
      setDrillStats(null)
      return
    }
    // isAllTime + initialChart.length === 0: fall through to API
    // (stale ISR cache — fetch current all-time data from server)

    setLoading(true)
    const params = new URLSearchParams()
    if (decade !== 'all') params.set('decade', decadeToParam(decade) ?? '')
    if (year  !== null)   params.set('year',   String(year))
    if (month !== null)   params.set('month',  String(month))

    try {
      const res  = await fetch(`/api/home/drill?${params.toString()}`)
      const data = await res.json()
      setChartRows(data.chart   ?? [])
      setArtists(data.artists   ?? [])
      setVenues(data.venues     ?? [])
      setDrillStats(data.stats  ?? null)
    } catch (e) {
      console.error('Drill-down fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [initialChart, initialArtists, initialVenues])

  // ── Chart + stats fallback: trigger all-time fetch if ISR cache was stale ──
  // Covers two failure modes: chart RPC failed (length 0) OR stats RPC failed (total 0)
  useEffect(() => {
    if (initialChart.length === 0 || initialStats.total_shows === 0) {
      fetchDrillData('all', null, null)
    }
  }, [initialChart.length, initialStats.total_shows, fetchDrillData])

  const isDrilled       = selectedDecade !== 'all' || selectedYear !== null || selectedMonth !== null
  const hasActiveFilter = isDrilled || capacityFilter !== 'all'

  // ── Province map CTA ─────────────────────────────────────
  const handleProvinceCta = useCallback(() => {
    if (user) {
      router.push('/my-grooveprint')
    } else {
      setShowSignUpBanner(true)
    }
  }, [user, router])

  // ── Clear all ─────────────────────────────────────────────
  const handleClearAll = useCallback(() => {
    setSelectedDecade('all')
    setSelectedYear(null)
    setSelectedMonth(null)
    setCapacityFilter('all')
    fetchDrillData('all', null, null)
  }, [fetchDrillData])

  // ── GP-132: province/state expand toggle ─────────────────
  const toggleProvince = useCallback((state: string) => {
    setExpandedProvinces(prev => {
      const next = new Set(prev)
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return next
    })
  }, [])

  // ── GP-133: artist row expand + lazy city breakdown ──────
  const toggleArtistExpand = useCallback(async (artistId: number) => {
    const isExpanding = !expandedArtists.has(artistId)
    setExpandedArtists(prev => {
      const next = new Set(prev)
      if (isExpanding) next.add(artistId)
      else next.delete(artistId)
      return next
    })
    if (isExpanding && !artistCityData[artistId] && !loadingArtistCity.has(artistId)) {
      setLoadingArtistCity(prev => new Set([...prev, artistId]))
      try {
        const res  = await fetch(`/api/home/artist-city?artist_id=${artistId}`)
        const data = await res.json()
        setArtistCityData(prev => ({ ...prev, [artistId]: data.cities ?? [] }))
      } catch (e) {
        console.error('Artist city breakdown fetch error:', e)
      } finally {
        setLoadingArtistCity(prev => {
          const next = new Set(prev)
          next.delete(artistId)
          return next
        })
      }
    }
  }, [expandedArtists, artistCityData, loadingArtistCity])

  // ── Decade click ─────────────────────────────────────────
  const handleDecadeClick = useCallback((decade: Decade) => {
    setSelectedDecade(decade)
    setSelectedYear(null)
    setSelectedMonth(null)
    fetchDrillData(decade, null, null)
  }, [fetchDrillData])

  // ── Year click (from chart bar click) ────────────────────
  const handleYearClick = useCallback((year: number, decade: Decade) => {
    setSelectedDecade(decade)
    setSelectedYear(year)
    setSelectedMonth(null)
    fetchDrillData(decade, year, null)
  }, [fetchDrillData])

  // ── Month click (from chart bar click in year view) ──────
  const handleMonthClick = useCallback((monthIndex: number) => {
    // monthIndex is 0-based (Jan=0); API expects 1-based
    setSelectedMonth(monthIndex)
    fetchDrillData(selectedDecade, selectedYear, monthIndex + 1)
  }, [fetchDrillData, selectedDecade, selectedYear])

  // ── Chart nav prev/next ───────────────────────────────────
  const handleNavDecade = useCallback((newDecade: Decade) => {
    setSelectedDecade(newDecade)
    setSelectedYear(null)
    setSelectedMonth(null)
    fetchDrillData(newDecade, null, null)
  }, [fetchDrillData])

  const handleNavYear = useCallback((newYear: number) => {
    const newDecade = `${Math.floor(newYear / 10) * 10}s` as Decade
    setSelectedDecade(newDecade)
    setSelectedYear(newYear)
    setSelectedMonth(null)
    fetchDrillData(newDecade, newYear, null)
  }, [fetchDrillData])

  // ── Filtered chart rows (capacity applied client-side) ────
  const filteredChartRows = useMemo(
    () => filterChartRows(chartRows, capacityFilter),
    [chartRows, capacityFilter]
  )

  // ── Filtered venues (capacity applied client-side) ────────
  const filteredVenues = useMemo(
    () => filterVenues(venues, capacityFilter),
    [venues, capacityFilter]
  )

  // ── GP-132: province/state rollup (client-side from city stats) ──
  const provinceStats = useMemo(() => {
    const map = new Map<string, { state: string; country: string; total: number; cities: CityStats[] }>()
    for (const city of cityStatsData) {
      const key = city.state ?? '__none__'
      if (!map.has(key)) {
        map.set(key, { state: city.state ?? '', country: city.country ?? '', total: 0, cities: [] })
      }
      const entry = map.get(key)!
      entry.total += Number(city.show_count)
      entry.cities.push(city)
    }
    return Array.from(map.values())
      .filter(p => p.state)
      .sort((a, b) => b.total - a.total)
  }, [cityStatsData])

  // ── Stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const isDrilled = selectedDecade !== 'all' || selectedYear !== null || selectedMonth !== null

    // All-time view: use server-fetched baseline stats
    // Drilled view: use exact counts from get_home_drill_stats RPC
    const totalShows    = isDrilled && drillStats ? drillStats.total_shows    : (initialStats.total_shows    > 0 ? initialStats.total_shows    : drillStats?.total_shows    ?? 0)
    const uniqueArtists = isDrilled && drillStats ? drillStats.unique_artists : (initialStats.unique_artists > 0 ? initialStats.unique_artists : drillStats?.unique_artists ?? 0)
    const uniqueVenues  = isDrilled && drillStats ? drillStats.unique_venues  : (initialStats.unique_venues  > 0 ? initialStats.unique_venues  : drillStats?.unique_venues  ?? 0)

    let fourthCard: { label: string; value: string } | null = null
    if (selectedYear && !selectedMonth) {
      fourthCard = { label: 'Shows per Month', value: Math.round(totalShows / 12).toLocaleString() }
    } else if (selectedDecade !== 'all' && !selectedYear) {
      fourthCard = { label: 'Shows per Year', value: Math.round(totalShows / 10).toLocaleString() }
    } else if (selectedDecade === 'all' && !selectedYear) {
      fourthCard = { label: 'Date Range', value: '1900–2026' }
    }

    return { totalShows, uniqueArtists, uniqueVenues, fourthCard }
  }, [initialStats, drillStats, selectedYear, selectedMonth, selectedDecade])

  // ── Chart data ────────────────────────────────────────────
  const chartData = useMemo(() => {
    if (selectedMonth !== null) return { labels: [], datasets: [] }

    const labels = filteredChartRows.map(r => r.bucket)

    const columnTotals: Record<string, number> = {}
    filteredChartRows.forEach(r => {
      columnTotals[r.bucket] = r.small + r.medium + r.large + r.xlarge + r.unknown
    })

    return {
      labels,
      datasets: CAPACITY_BUCKETS.map(k => ({
        label:                  CAPACITY_META[k].legendLabel,
        data:                   filteredChartRows.map(r => r[k]),
        backgroundColor:        CAPACITY_META[k].bg,
        hoverBackgroundColor:   CAPACITY_META[k].hoverBg,
        borderColor:            CAPACITY_META[k].border,
        borderWidth:            0,
        hoverBorderWidth:       1,
        stack:                  'stack',
        columnTotals,
      }))
    }
  }, [filteredChartRows, selectedMonth])

  // ── Chart nav metadata ────────────────────────────────────
  const chartNav = useMemo(() => {
    if (selectedMonth !== null && selectedYear) {
      return { title: `Shows in ${MONTH_NAMES[selectedMonth]} ${selectedYear}`, prev: null, next: null }
    }
    if (selectedYear) {
      const prev = selectedYear - 1
      const next = selectedYear + 1
      return {
        title: `Shows in ${selectedYear}`,
        prev: prev >= 1900 ? { label: `← ${prev}`, onClick: () => handleNavYear(prev) } : null,
        next: next <= 2026 ? { label: `${next} →`, onClick: () => handleNavYear(next) } : null,
      }
    }
    if (selectedDecade !== 'all') {
      const s = parseInt(selectedDecade.substring(0, 4))
      return {
        title: `Shows in the ${selectedDecade}`,
        prev: s - 10 >= 1900 ? { label: `← ${s - 10}s`, onClick: () => handleNavDecade(`${s - 10}s` as Decade) } : null,
        next: s + 10 <= 2020 ? { label: `${s + 10}s →`, onClick: () => handleNavDecade(`${s + 10}s` as Decade) } : null,
      }
    }
    return { title: 'Shows by Decade', prev: null, next: null }
  }, [selectedDecade, selectedYear, selectedMonth, handleNavYear, handleNavDecade])

  // ── Filter context label ──────────────────────────────────
  const filterContext = useMemo(() => {
    const parts: string[] = []
    if (selectedMonth !== null && selectedYear) parts.push(`${MONTH_NAMES[selectedMonth]} ${selectedYear}`)
    else if (selectedYear)                       parts.push(selectedYear.toString())
    else if (selectedDecade !== 'all')           parts.push(selectedDecade)
    if (capacityFilter !== 'all')                parts.push(`${CAPACITY_DISPLAY_NAMES[capacityFilter as CapacityBucket]} Venues`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [selectedDecade, selectedYear, selectedMonth, capacityFilter])

  // ── Chart options ─────────────────────────────────────────
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          boxWidth: 14,
          padding:  12,
          font: { size: 12 },
          color: resolvedTheme === 'dark' ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)',
        },
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
            if (selectedYear) {
              const monthIndex = MONTH_NAMES.indexOf(label)
              if (monthIndex !== -1) return `${MONTH_NAMES_FULL[monthIndex]} ${selectedYear}`
            }
            return label
          },
          label: (item: any) => {
            const dataset      = item.chart.data.datasets[item.datasetIndex]
            const columnTotals = dataset.columnTotals as Record<string, number>
            const label        = item.chart.data.labels[item.dataIndex] as string
            const total        = columnTotals[label] || 0
            const value        = item.parsed.y
            if (value === 0) return undefined
            const pct       = total > 0 ? Math.round((value / total) * 100) : 0
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
    onClick: (_event: any, elements: any) => {
      if (!elements.length) return
      const index = elements[0].index
      const label = chartData.labels?.[index] as string

      if (selectedYear) {
        // Year view → clicking a month navigates to browse
        router.push(`/browse?year=${selectedYear}&month=${index + 1}`)
      } else if (selectedDecade === 'all') {
        // All-time view → drill into decade
        if (label === PRE1960_LABEL) {
          handleDecadeClick('1950s')
        } else {
          handleDecadeClick(label as Decade)
        }
      } else {
        // Decade view → drill into year
        const year        = filteredChartRows[index]?.sort_key
        const clickDecade = selectedDecade
        if (year) handleYearClick(year, clickDecade)
      }
    }
  }), [selectedDecade, selectedYear, chartData, router, resolvedTheme, filteredChartRows, handleDecadeClick, handleYearClick])

  // ── Render ────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background py-4 md:py-6 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2 md:gap-3 mb-3 md:mb-4">
          <StatCard label="Shows"   value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues"  value={stats.uniqueVenues.toLocaleString()} />
          {stats.fourthCard ? (
            <StatCard
              label={stats.fourthCard.label}
              value={stats.fourthCard.value}
              compact={stats.fourthCard.label === 'Date Range'}
            />
          ) : (
            <div />
          )}
        </div>

        {/* ── View toggle ────────────────────────────────────────── */}
        <div className="flex justify-end mb-2 md:mb-3">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setViewMode('map')}
              className={`px-4 py-2 transition-colors ${
                viewMode === 'map'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setViewMode('chart')}
              className={`px-4 py-2 transition-colors border-l border-border ${
                viewMode === 'chart'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-muted'
              }`}
            >
              Chart
            </button>
          </div>
        </div>

        {/* ── Province bubble map ────────────────────────────────── */}
        {viewMode === 'map' && (
          <div className="bg-card rounded-lg shadow-lg overflow-hidden mb-3 md:mb-4 h-[420px] md:h-[480px]">
            <ProvinceMap
              provinces={provinceStats}
              isAuthenticated={!!user}
              onCtaClick={handleProvinceCta}
            />
          </div>
        )}

        {viewMode === 'chart' && (<>

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
        <div className="bg-card rounded-lg shadow-lg p-4 md:p-4 mb-3 md:mb-4 relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-card/70 rounded-lg z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          )}
          <div style={{ height: '320px', cursor: 'pointer' }} className="md:h-[420px]">
            {selectedMonth !== null ? (
              <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                Select a month from the chart to view individual shows.
              </div>
            ) : (
              <Bar data={chartData} options={chartOptions} />
            )}
          </div>
        </div>

        {/* Filters card */}
        <div className="bg-card rounded-lg shadow-lg p-3 md:p-4 mb-3 md:mb-4 space-y-3">

          {/* Row 1: Venue size pill + Year dropdown + Clear All */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
              {CAPACITY_BUTTON_ORDER.map((k, i) => {
                const isAll    = k === 'all'
                const isActive = capacityFilter === k
                const unselectedClass = isAll ? 'text-muted-foreground' : CAPACITY_META[k as CapacityBucket].unselectedClass
                const label           = isAll ? 'All Venues' : CAPACITY_META[k as CapacityBucket].label
                const tooltip         = isAll ? 'All venues' : CAPACITY_META[k as CapacityBucket].tooltip
                return (
                  <button
                    key={k}
                    onClick={() => setCapacityFilter(k)}
                    title={tooltip}
                    className={`px-2 py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
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

            <select
              value={selectedYear || ''}
              onChange={(e) => {
                const year = e.target.value ? parseInt(e.target.value) : null
                if (year) {
                  const decade = `${Math.floor(year / 10) * 10}s` as Decade
                  setSelectedDecade(decade)
                  setSelectedYear(year)
                  setSelectedMonth(null)
                  fetchDrillData(decade, year, null)
                } else {
                  handleClearAll()
                }
              }}
              className="w-28 px-2 py-1 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All Years</option>
              {Array.from({ length: 127 }, (_, i) => 1900 + i).map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>

            {hasActiveFilter && (
              <button
                onClick={handleClearAll}
                className="text-xs border border-destructive text-destructive rounded px-2 py-1.5 hover:bg-destructive/10 transition-colors whitespace-nowrap"
              >
                Clear All
              </button>
            )}
          </div>

          <div className="border-t border-border" />

          {/* Row 2: Decade buttons */}
          <div className="overflow-x-auto -mx-3 px-3 md:-mx-4 md:px-4">
            <div className="flex gap-2 min-w-max">
              {DECADES.map((decade) => {
                const isActive = selectedDecade === decade && !selectedYear && selectedMonth === null
                const isParentDecade = selectedYear !== null && decade !== 'all' &&
                  `${Math.floor(selectedYear / 10) * 10}s` === decade
                return (
                  <button
                    key={decade}
                    onClick={() => handleDecadeClick(decade)}
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

        </>)}

        {/* Top tables */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">

          {/* Top Artists */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
              Top {showAllArtists ? '25' : '10'} Artists
              {filterContext && (
                <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">
                  ({filterContext})
                </span>
              )}
            </h2>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : artists.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {artists.slice(0, showAllArtists ? 25 : 10).map((artist, index) => (
                    <div key={artist.artist_id} className="py-0.5">
                      {/* Main row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 md:gap-2 min-w-0 flex-1">
                          <span className="text-base md:text-lg font-semibold text-muted-foreground w-4 md:w-6 flex-shrink-0">
                            {index + 1}
                          </span>
                          <button
                            onClick={() => router.push(`/browse?artist_id=${artist.artist_id}`)}
                            className="text-sm md:text-base text-primary hover:opacity-80 hover:underline text-left truncate"
                          >
                            {artist.artist_name}
                          </button>
                          {artist.spotify_url && (
                            <a
                              href={artist.spotify_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open on Spotify"
                              onClick={e => e.stopPropagation()}
                              className="flex-shrink-0 hover:opacity-75 transition-opacity"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="#1DB954">
                                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                              </svg>
                            </a>
                          )}
                          {/* State pills — only when artist spans multiple states */}
                          {artist.state_counts && artist.state_counts.length > 1 && (
                            <div className="hidden sm:flex gap-1 flex-shrink-0">
                              {artist.state_counts.slice(0, 3).map(sc => (
                                <span
                                  key={sc.state}
                                  className="text-[10px] px-1 py-0.5 rounded leading-none font-medium"
                                  style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488' }}
                                >
                                  {sc.state}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-xs md:text-base text-muted-foreground font-medium whitespace-nowrap ml-2">
                            {artist.show_count.toLocaleString()} shows
                          </span>
                          {/* Expand chevron — only when multi-city */}
                          {artist.state_counts && artist.state_counts.length > 0 && (
                            <button
                              onClick={() => toggleArtistExpand(artist.artist_id)}
                              title={expandedArtists.has(artist.artist_id) ? 'Collapse' : 'Show city breakdown'}
                              className="text-muted-foreground hover:text-foreground p-0.5 transition-colors"
                            >
                              <svg
                                width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
                                style={{ transform: expandedArtists.has(artist.artist_id) ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
                              >
                                <path d="M3 2l4 3-4 3V2z"/>
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Expanded city breakdown */}
                      {expandedArtists.has(artist.artist_id) && (
                        <div className="mt-1 ml-5 md:ml-7 space-y-0.5">
                          {loadingArtistCity.has(artist.artist_id) ? (
                            <div className="space-y-1.5 py-0.5">
                              {[55, 40, 28].map(w => (
                                <div key={w} className="flex items-center justify-between">
                                  <div className="h-2.5 rounded animate-pulse bg-muted" style={{ width: `${w}%` }} />
                                  <div className="h-2.5 rounded animate-pulse bg-muted w-14 ml-4" />
                                </div>
                              ))}
                            </div>
                          ) : (
                            (artistCityData[artist.artist_id] ?? []).map(row => (
                              <div
                                key={`${row.city}-${row.state}`}
                                className="flex items-center justify-between py-0.5"
                              >
                                <span className="text-xs text-muted-foreground">
                                  {row.city}{row.state ? `, ${row.state}` : ''}
                                </span>
                                <span className="text-xs text-muted-foreground font-medium ml-4 whitespace-nowrap">
                                  {Number(row.show_count).toLocaleString()} shows
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {artists.length > 10 && (
                  <button
                    onClick={() => setShowAllArtists(!showAllArtists)}
                    className="mt-3 text-primary hover:opacity-80 text-xs md:text-sm font-medium"
                  >
                    {showAllArtists ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No shows in this period</p>
            )}
          </div>

          {/* Top Venues */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
            <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
              Top {showAllVenues ? '25' : '10'} Venues
              {filterContext && (
                <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">
                  ({filterContext})
                </span>
              )}
            </h2>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : filteredVenues.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {filteredVenues.slice(0, showAllVenues ? 25 : 10).map((venue, index) => (
                    <div key={venue.venue_id} className="flex items-center justify-between py-0.5">
                      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                        <span className="text-base md:text-lg font-semibold text-muted-foreground w-4 md:w-6 flex-shrink-0">
                          {index + 1}
                        </span>
                        <button
                          onClick={() => router.push(`/browse?venue_id=${venue.venue_id}`)}
                          className="text-sm md:text-base text-primary hover:opacity-80 hover:underline text-left truncate"
                        >
                          {venue.venue_name}
                        </button>
                        {venue.city && venue.state && (
                          <span className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 leading-none font-medium"
                            style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488' }}>
                            {venue.city}, {venue.state}
                          </span>
                        )}
                        {venue.capacity_category && CAPACITY_BADGE[venue.capacity_category] && (
                          <span
                            className="hidden sm:inline-flex text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap flex-shrink-0 leading-none font-bold"
                            style={{
                              backgroundColor: CAPACITY_BADGE[venue.capacity_category].bg,
                              color: CAPACITY_BADGE[venue.capacity_category].color,
                            }}
                            title={venue.capacity != null
                              ? `${venue.capacity.toLocaleString()} capacity`
                              : venue.capacity_category
                            }
                          >
                            {CAPACITY_BADGE[venue.capacity_category].label}
                          </span>
                        )}
                      </div>
                      <span className="text-xs md:text-base text-muted-foreground font-medium whitespace-nowrap ml-2">
                        {venue.show_count.toLocaleString()} shows
                      </span>
                    </div>
                  ))}
                </div>
                {filteredVenues.length > 10 && (
                  <button
                    onClick={() => setShowAllVenues(!showAllVenues)}
                    className="mt-3 text-primary hover:opacity-80 text-xs md:text-sm font-medium"
                  >
                    {showAllVenues ? '← Show less' : 'View more →'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No shows in this period</p>
            )}
          </div>

        </div>

        {/* ── GP-132: Top Cities + Provinces/States ───────────────── */}
        {cityStatsData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mt-4 md:mt-6">

            {/* Top Cities */}
            <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
              <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
                Top Cities
              </h2>
              <div className="space-y-1">
                {cityStatsData.slice(0, showAllCities ? 25 : 10).map((city, idx) => {
                  const maxCount = Number(cityStatsData[0]?.show_count ?? 1)
                  const pct      = Math.round((Number(city.show_count) / maxCount) * 100)
                  const sharePct = initialStats.total_shows > 0
                    ? ((Number(city.show_count) / initialStats.total_shows) * 100).toFixed(1)
                    : '0'
                  return (
                    <div
                      key={`${city.city}-${city.state}`}
                      className="flex items-center justify-between py-1 px-1 rounded"
                      style={{ background: `linear-gradient(to right, rgba(0,191,168,0.22) ${pct}%, transparent ${pct}%)` }}
                      title={`${city.city}${city.state ? `, ${city.state}` : ''}: ${Number(city.show_count).toLocaleString()} shows · ${sharePct}% of total`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-bold w-4 md:w-5 flex-shrink-0 text-right" style={{ color: '#0d9488' }}>
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-foreground truncate">
                          {city.city}{city.state ? `, ${city.state}` : ''}
                        </span>
                        {city.country && (
                          <CountryFlag code={city.country} className="inline-block w-4 h-auto rounded-[1px] flex-shrink-0 align-[-2px]" />
                        )}
                      </div>
                      <span className="text-xs md:text-sm font-semibold whitespace-nowrap ml-2 text-foreground">
                        {Number(city.show_count).toLocaleString()} shows
                      </span>
                    </div>
                  )
                })}
              </div>
              {cityStatsData.length > 10 && (
                <button
                  onClick={() => setShowAllCities(!showAllCities)}
                  className="mt-3 text-primary hover:opacity-80 text-xs md:text-sm font-medium"
                >
                  {showAllCities ? '← Show less' : 'View more →'}
                </button>
              )}
            </div>

            {/* Top Provinces / States */}
            <div className="bg-card rounded-lg shadow-lg p-4 md:p-5">
              <h2 className="text-xl md:text-2xl font-bold text-foreground mb-3 md:mb-4">
                Top Provinces &amp; States
              </h2>
              <div className="space-y-0.5">
                {provinceStats.map(prov => {
                  const maxTotal  = provinceStats[0]?.total ?? 1
                  const pct       = Math.round((prov.total / maxTotal) * 100)
                  const sharePct  = initialStats.total_shows > 0
                    ? ((prov.total / initialStats.total_shows) * 100).toFixed(1)
                    : '0'
                  return (
                    <div key={prov.state}>
                      <button
                        onClick={() => toggleProvince(prov.state)}
                        className="w-full flex items-center justify-between py-1.5 rounded px-1 transition-colors"
                        style={{ background: `linear-gradient(to right, rgba(0,191,168,0.22) ${pct}%, transparent ${pct}%)` }}
                        title={`${STATE_NAMES[prov.state] ?? prov.state}: ${prov.total.toLocaleString()} shows · ${sharePct}% of total`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <svg
                            width="8" height="8" viewBox="0 0 8 8" fill="currentColor"
                            style={{
                              color: '#0d9488',
                              transform: expandedProvinces.has(prov.state) ? 'rotate(90deg)' : 'none',
                              transition: 'transform 150ms',
                              flexShrink: 0,
                            }}
                          >
                            <path d="M2 1.5l4 2.5-4 2.5V1.5z"/>
                          </svg>
                          <span className="text-sm font-medium text-foreground">
                            {STATE_NAMES[prov.state] ?? prov.state}
                          </span>
                          {prov.country && (
                            <CountryFlag code={prov.country} className="inline-block w-4 h-auto rounded-[1px] align-[-2px]" />
                          )}
                        </div>
                        <span className="text-xs md:text-sm font-semibold whitespace-nowrap ml-2 text-foreground">
                          {prov.total.toLocaleString()} shows
                        </span>
                      </button>
                      {expandedProvinces.has(prov.state) && (
                        <div className="ml-5 mb-1 space-y-0.5">
                          {prov.cities.map(city => (
                            <div
                              key={city.city}
                              className="flex items-center justify-between py-0.5"
                            >
                              <span className="text-xs pl-1" style={{ color: '#0d9488' }}>{city.city}</span>
                              <span className="text-xs text-muted-foreground font-medium ml-4 whitespace-nowrap">
                                {Number(city.show_count).toLocaleString()} shows
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

          </div>
        )}

      </div>

      {/* ── Sign-up banner (triggered from province map CTA) ── */}
      {showSignUpBanner && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowSignUpBanner(false)}
        >
          <div
            className="bg-card rounded-xl shadow-2xl p-6 max-w-sm w-full"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-foreground mb-2">
              See your concert history
            </h3>
            <p className="text-sm text-muted-foreground mb-5">
              Sign up to track concerts you&apos;ve attended, discover your Spotify matches,
              and explore which venues you&apos;ve visited across every city.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => router.push('/my-grooveprint')}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                style={{ background: '#00BFA8' }}
              >
                Sign up free →
              </button>
              <button
                onClick={() => setShowSignUpBanner(false)}
                className="px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

function StatCard({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className="bg-card rounded-lg shadow p-2 md:p-4">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className={`${compact ? 'text-xs' : 'text-base'} md:text-2xl font-bold text-foreground whitespace-nowrap`}>{value}</p>
    </div>
  )
}
