'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Select from 'react-select'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import { useAuth } from '../providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import Navigation from '../components/Navigation'
import { useTheme } from 'next-themes'

// Lean show type — only IDs, no embedded artist/venue objects
type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  show_type: string | null
  festival_name: string | null
  artist_id: number
  venue_id: number
}

type Artist = {
  artist_id: number
  artist_name: string
  monthly_listeners: number | null
  spotify_artist_id: string | null
}

type Venue = {
  venue_id: number
  venue_name: string
  capacity: number | null
  capacity_category: string | null
  status: string | null
  other_names: string | null
}

type SortField = 'date' | 'artist' | 'venue' | 'festival'
type SortDirection = 'asc' | 'desc'
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type StatusFilter = 'all' | 'open' | 'closed'

const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const CAPACITY_BUTTONS: {
  key: CapacityFilter
  label: string
  tooltip: string
  unselectedClass: string
  range: [number, number]
}[] = [
    { key: 'small', label: 'S', tooltip: 'Small (< 500)', unselectedClass: 'text-purple-400 dark:text-purple-300', range: [0, 500] },
    { key: 'medium', label: 'M', tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-teal-600 dark:text-teal-400', range: [500, 1500] },
    { key: 'large', label: 'L', tooltip: 'Large (1.5K–10K)', unselectedClass: 'text-orange-600 dark:text-orange-400', range: [1500, 10000] },
    { key: 'xlarge', label: 'XL', tooltip: 'X-Large (10K+)', unselectedClass: 'text-rose-600 dark:text-rose-400', range: [10000, 65000] },
    { key: 'all', label: 'All', tooltip: 'All venues', unselectedClass: 'text-muted-foreground', range: [0, 65000] },
    { key: 'unknown', label: '?', tooltip: 'Unknown capacity', unselectedClass: 'text-gray-400 dark:text-gray-500', range: [0, 65000] },
  ]

const STATUS_BUTTONS: {
  key: StatusFilter
  label: string
  unselectedClass: string
}[] = [
  { key: 'all',    label: 'All',    unselectedClass: 'text-muted-foreground' },
  { key: 'open',   label: 'Open',   unselectedClass: 'text-muted-foreground' },
  { key: 'closed', label: 'Closed', unselectedClass: 'text-muted-foreground' },
]

const CAPACITY_LABELS: Record<CapacityFilter, string> = {
  small:   'Small Venues',
  medium:  'Medium Venues',
  large:   'Large Venues',
  xlarge:  'X-Large Venues',
  unknown: 'Unknown Capacity Venues',
  all:     '',
}

function capacityFilterKey(category: string | null): CapacityFilter {
  if (!category) return 'unknown'
  const c = category.toLowerCase()
  if (c.includes('small')) return 'small'
  if (c.includes('medium')) return 'medium'
  if (c.includes('x-large')) return 'xlarge'
  if (c.includes('large')) return 'large'
  return 'unknown'
}

function BrowseContent({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [sliderColor, setSliderColor] = useState('#2d6be4')

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!mounted) return
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-primary').trim() || '#2d6be4'
    setSliderColor(color)
  }, [mounted, resolvedTheme])

  const isDark = mounted && resolvedTheme === 'dark'

  // Build lookup maps from dim arrays — O(1) access per show
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

  const customSelectStyles = {
    control: (base: any) => ({
      ...base,
      fontSize: '0.875rem',
      backgroundColor: isDark ? 'oklch(0.2 0.02 260)' : 'white',
      borderColor: isDark ? 'oklch(0.3 0.02 260)' : '#d1d5db',
      '&:hover': { borderColor: isDark ? 'oklch(0.4 0.02 260)' : '#9ca3af' }
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: isDark ? 'oklch(0.2 0.02 260)' : 'white',
      borderColor: isDark ? 'oklch(0.3 0.02 260)' : '#d1d5db',
    }),
    singleValue: (base: any) => ({ ...base, color: isDark ? 'oklch(0.95 0 0)' : '#111827' }),
    placeholder: (base: any) => ({ ...base, color: isDark ? 'oklch(0.65 0.01 260)' : '#6B7280' }),
    option: (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused
        ? isDark ? 'oklch(0.25 0.02 260)' : '#f3f4f6'
        : isDark ? 'oklch(0.2 0.02 260)' : 'white',
      color: isDark ? 'oklch(0.95 0 0)' : '#111827',
    }),
    input: (base: any) => ({ ...base, color: isDark ? 'oklch(0.95 0 0)' : '#111827' }),
    indicatorSeparator: (base: any) => ({ ...base, backgroundColor: isDark ? 'oklch(0.3 0.02 260)' : '#d1d5db' }),
    dropdownIndicator: (base: any) => ({ ...base, color: isDark ? 'oklch(0.65 0.01 260)' : '#6B7280' }),
    clearIndicator: (base: any) => ({ ...base, color: isDark ? 'oklch(0.65 0.01 260)' : '#6B7280' }),
  }

  const initialArtistId = searchParams.get('artist_id')
  const initialVenueId = searchParams.get('venue_id')
  const urlYear = searchParams.get('year')
  const urlMonth = searchParams.get('month')

  const [selectedArtist, setSelectedArtist] = useState<{ value: number; label: string } | null>(
    initialArtistId ? { value: parseInt(initialArtistId), label: artists.find((a) => a.artist_id === parseInt(initialArtistId))?.artist_name || '' } : null
  )
  const [selectedVenue, setSelectedVenue] = useState<{ value: number; label: string } | null>(
    initialVenueId ? { value: parseInt(initialVenueId), label: venues.find((v) => v.venue_id === parseInt(initialVenueId))?.venue_name || '' } : null
  )
  const [selectedShowType, setSelectedShowType] = useState<string | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<{ value: string; label: string } | null>(null)
  const [yearRange, setYearRange] = useState<[number | string, number | string]>(() => {
    if (urlYear) { const year = parseInt(urlYear); return [year, year] }
    return [1900, 2026]
  })
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const showsPerPage = 50
  const [hasManualYearChange, setHasManualYearChange] = useState(false)
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')
  const [capacityRange, setCapacityRange] = useState<[number, number]>([0, 65000])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [userShows, setUserShows] = useState<Set<number>>(new Set())
  const [loadingShows, setLoadingShows] = useState<Set<number>>(new Set())

  const showFestivalContext = selectedShowType === 'festival' || !!selectedFestival

  const festivalBadgeClass = isDark
    ? 'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition whitespace-nowrap'
    : 'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition whitespace-nowrap'

  const festivalBadgeMobileClass = isDark
    ? 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition flex-shrink-0'
    : 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition flex-shrink-0'

  const festivalSortActiveClass = isDark
    ? 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold border bg-violet-500/30 text-violet-300 border-violet-400/50'
    : 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold border bg-violet-100 text-violet-700 border-violet-300'
  const festivalSortInactiveClass = isDark
    ? 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold border bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20 transition'
    : 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold border bg-violet-50 text-violet-500 border-violet-200 hover:bg-violet-100 transition'

  const handleCapacityButton = (key: CapacityFilter, range: [number, number]) => {
    setCapacityFilter(key)
    if (key !== 'unknown') setCapacityRange(range)
    setCurrentPage(1); setPageInput('1')
  }

  const handleCapacitySlider = (value: number | number[]) => {
    const range = Array.isArray(value) ? value : [value, value]
    setCapacityRange([range[0], range[1]])
    setCapacityFilter('all')
    setCurrentPage(1); setPageInput('1')
  }

  const handleFestivalSort = () => {
    if (sortField === 'festival') {
      if (sortDirection === 'asc') {
        setSortDirection('desc')
      } else {
        setSortField('date')
        setSortDirection('desc')
      }
    } else {
      setSortField('festival')
      setSortDirection('asc')
    }
    setCurrentPage(1); setPageInput('1')
  }

  useEffect(() => {
    if (urlYear) { const year = parseInt(urlYear); setYearRange([year, year]); return }
    if (!selectedArtist && !selectedVenue && !initialArtistId && !initialVenueId) { setYearRange([1900, 2026]); return }
    let relevantShows = shows
    if (selectedArtist) relevantShows = relevantShows.filter((s) => s.artist_id === selectedArtist.value)
    if (selectedVenue) relevantShows = relevantShows.filter((s) => s.venue_id === selectedVenue.value)
    if (relevantShows.length > 0) {
      const years = relevantShows.map(s => new Date(s.date).getFullYear())
      setYearRange([Math.min(...years), Math.max(...years)])
    }
  }, [selectedArtist, selectedVenue, shows, initialArtistId, initialVenueId, urlYear])

  useEffect(() => {
    const fetchUserShows = async () => {
      if (!user) return
      const supabase = createClient()
      const { data } = await supabase.from('user_shows').select('show_id').eq('user_id', user.id)
      if (data) setUserShows(new Set(data.map(s => s.show_id)))
    }
    fetchUserShows()
  }, [user])

  const toggleShow = async (showId: number) => {
    if (!user) { alert('Please sign in to save shows'); return }
    const supabase = createClient()
    const isAdded = userShows.has(showId)
    setLoadingShows(prev => new Set(prev).add(showId))
    try {
      if (isAdded) {
        await supabase.from('user_shows').delete().eq('user_id', user.id).eq('show_id', showId)
        setUserShows(prev => { const s = new Set(prev); s.delete(showId); return s })
      } else {
        await supabase.from('user_shows').insert({ user_id: user.id, show_id: showId, source: 'manual' })
        setUserShows(prev => new Set(prev).add(showId))
      }
    } catch (error) {
      console.error('Error toggling show:', error)
    } finally {
      setLoadingShows(prev => { const s = new Set(prev); s.delete(showId); return s })
    }
  }

  const filteredShows = useMemo(() => {
    let filtered = shows
    if (selectedShowType) {
      if (selectedShowType === 'music') filtered = filtered.filter((s) => s.show_type === 'music' || s.show_type === null)
      else filtered = filtered.filter((s) => s.show_type === selectedShowType)
    }
    if (selectedArtist) filtered = filtered.filter((s) => s.artist_id === selectedArtist.value)
    if (selectedVenue) filtered = filtered.filter((s) => s.venue_id === selectedVenue.value)
    if (selectedFestival) filtered = filtered.filter((s) => s.festival_name === selectedFestival.value)

    // Capacity filter — looks up venue from map
    filtered = filtered.filter((show) => {
      const venue = venueMap.get(show.venue_id)
      const capacity = venue?.capacity ?? null
      if (capacityFilter === 'unknown') return capacity === null
      if (capacityFilter === 'all') return true
      const key = capacityFilterKey(venue?.capacity_category ?? null)
      return key === capacityFilter
    })

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter((show) => {
        const venue = venueMap.get(show.venue_id)
        const s = (venue?.status || '').toLowerCase()
        return statusFilter === 'open' ? s === 'open' : s === 'closed'
      })
    }

    const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
    const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2026
    filtered = filtered.filter((s) => { const y = new Date(s.date).getFullYear(); return y >= startYear && y <= endYear })
    if (urlMonth && !hasManualYearChange) {
      const monthNum = parseInt(urlMonth)
      if (monthNum >= 1 && monthNum <= 12) filtered = filtered.filter((s) => parseInt(s.date.split('-')[1]) === monthNum)
    }

    filtered.sort((a, b) => {
      let aVal: any, bVal: any
      switch (sortField) {
        case 'date':
          aVal = new Date(a.date).getTime(); bVal = new Date(b.date).getTime(); break
        case 'artist':
          aVal = (artistMap.get(a.artist_id)?.artist_name || '').toLowerCase()
          bVal = (artistMap.get(b.artist_id)?.artist_name || '').toLowerCase(); break
        case 'venue':
          aVal = (venueMap.get(a.venue_id)?.venue_name || '').toLowerCase()
          bVal = (venueMap.get(b.venue_id)?.venue_name || '').toLowerCase(); break
        case 'festival':
          aVal = (a.festival_name || '').toLowerCase(); bVal = (b.festival_name || '').toLowerCase(); break
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })
    return filtered
  }, [shows, selectedShowType, selectedArtist, selectedVenue, selectedFestival, capacityFilter, capacityRange, statusFilter, yearRange, urlMonth, hasManualYearChange, sortField, sortDirection, artistMap, venueMap])

  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map((s) => s.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map((s) => s.venue_id)).size
    const selectedArtistData = selectedArtist ? artistMap.get(selectedArtist.value) : null
    const selectedVenueData = selectedVenue ? venueMap.get(selectedVenue.value) : null
    const monthlyListeners = selectedArtistData?.monthly_listeners || null
    const capacity = selectedVenueData?.capacity || null
    const sortedByDate = [...filteredShows].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    const firstShow = sortedByDate.length > 0 ? sortedByDate[0].date : null
    const lastShow = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].date : null
    return { totalShows, uniqueArtists, uniqueVenues, monthlyListeners, capacity, firstShow, lastShow }
  }, [filteredShows, selectedArtist, selectedVenue, artistMap, venueMap])

  const unknownCapacityCount = useMemo(() => {
    let pre = shows
    if (selectedShowType) {
      if (selectedShowType === 'music') pre = pre.filter(s => s.show_type === 'music' || s.show_type === null)
      else pre = pre.filter(s => s.show_type === selectedShowType)
    }
    if (selectedArtist) pre = pre.filter(s => s.artist_id === selectedArtist.value)
    if (selectedVenue) pre = pre.filter(s => s.venue_id === selectedVenue.value)
    if (selectedFestival) pre = pre.filter(s => s.festival_name === selectedFestival.value)
    if (statusFilter !== 'all') {
      pre = pre.filter(s => {
        const venue = venueMap.get(s.venue_id)
        const st = (venue?.status || '').toLowerCase()
        return statusFilter === 'open' ? st === 'open' : st === 'closed'
      })
    }
    const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
    const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2026
    pre = pre.filter(s => { const y = new Date(s.date).getFullYear(); return y >= startYear && y <= endYear })
    if (urlMonth && !hasManualYearChange) {
      const m = parseInt(urlMonth)
      if (m >= 1 && m <= 12) pre = pre.filter(s => parseInt(s.date.split('-')[1]) === m)
    }
    return pre.filter(s => (venueMap.get(s.venue_id)?.capacity ?? null) === null).length
  }, [shows, selectedShowType, selectedArtist, selectedVenue, selectedFestival, statusFilter, yearRange, urlMonth, hasManualYearChange, venueMap])

  const totalPages = Math.ceil(filteredShows.length / showsPerPage)
  const currentShows = useMemo(() => {
    const startIndex = (currentPage - 1) * showsPerPage
    return filteredShows.slice(startIndex, startIndex + showsPerPage)
  }, [filteredShows, currentPage])

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') { setSortDirection('desc') }
      else { setSortField('date'); setSortDirection('desc') }
    } else { setSortField(field); setSortDirection('asc') }
    setCurrentPage(1); setPageInput('1')
  }

  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) { setCurrentPage(page); setPageInput(page.toString()) }
  }

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const page = parseInt(pageInput)
    if (!isNaN(page) && page >= 1 && page <= totalPages) setCurrentPage(page)
    else setPageInput(currentPage.toString())
  }

  const artistOptions = artists.map((a) => ({ value: a.artist_id, label: a.artist_name }))
  const venueOptions = venues.map((v) => ({ value: v.venue_id, label: v.venue_name }))
  const festivalOptions = useMemo(() => {
    const uniqueFestivals = new Set(shows.map(s => s.festival_name).filter((n): n is string => n !== null && n !== ''))
    return Array.from(uniqueFestivals).sort().map(f => ({ value: f, label: f }))
  }, [shows])

  const pageTitle = useMemo(() => {
    if (selectedArtist && selectedVenue) return `Browse: ${selectedArtist.label} @ ${selectedVenue.label}`
    if (selectedArtist) return `Browse: ${selectedArtist.label}`
    if (selectedVenue) return `Browse: ${selectedVenue.label}`
    if (urlYear && urlMonth && !hasManualYearChange) return `Browse: ${MONTH_NAMES_FULL[parseInt(urlMonth) - 1]} ${urlYear}`
    if (selectedFestival) return `Browse: ${selectedFestival.label}`
    if (selectedShowType) {
      const names: Record<string, string> = { 'music': 'Music', 'comedy': 'Comedy', 'festival': 'Festivals' }
      return `Browse: ${names[selectedShowType]}`
    }
    if (capacityFilter !== 'all') {
      const capacityLabel = CAPACITY_LABELS[capacityFilter]
      if (statusFilter !== 'all') return `Browse: ${capacityLabel} (${statusFilter === 'open' ? 'Open' : 'Closed'})`
      return `Browse: ${capacityLabel}`
    }
    if (statusFilter !== 'all') return `Browse: ${statusFilter === 'open' ? 'Open' : 'Closed'} Venues`
    return 'Browse Shows'
  }, [selectedArtist, selectedVenue, selectedFestival, selectedShowType, urlYear, urlMonth, hasManualYearChange, capacityFilter, statusFilter])

  const dateRangeDisplay = useMemo(() => {
    if (!stats.firstShow || !stats.lastShow) return null
    const firstDate = new Date(stats.firstShow + 'T12:00:00')
    const lastDate = new Date(stats.lastShow + 'T12:00:00')
    const fmt = (d: Date) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    return stats.firstShow === stats.lastShow ? fmt(firstDate) : `${fmt(firstDate)} – ${fmt(lastDate)}`
  }, [stats.firstShow, stats.lastShow])

  const dateRangeDisplayMobile = useMemo(() => {
    if (!stats.firstShow || !stats.lastShow) return null
    const firstYear = stats.firstShow.split('-')[0]
    const lastYear = stats.lastShow.split('-')[0]
    return firstYear === lastYear ? firstYear : `${firstYear}-${lastYear}`
  }, [stats.firstShow, stats.lastShow])

  const sliderStyles = { track: { backgroundColor: sliderColor }, handle: { borderColor: sliderColor } }
  const thBase = 'bg-muted px-1 md:px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'
  const thSortable = `${thBase} cursor-pointer hover:bg-muted/80`
  const thCenter = 'bg-muted px-0 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4 md:mb-6">{pageTitle}</h1>

          {/* Stats Cards */}
          <div className="mb-4 md:mb-8">
            <div className="grid grid-cols-4 md:grid-cols-3 gap-2 md:gap-4 mb-2 md:mb-4">
              <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
              <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
              <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
              {dateRangeDisplay && (
                <div className="md:hidden bg-card rounded-lg shadow p-2">
                  <p className="text-[10px] text-muted-foreground mb-0.5 leading-tight">Date Range</p>
                  <p className="text-sm font-bold text-foreground break-words leading-tight">{dateRangeDisplayMobile}</p>
                </div>
              )}
            </div>
            {(dateRangeDisplay || selectedArtist || selectedVenue) && (
              <div className="hidden md:grid md:grid-cols-3 gap-4">
                {dateRangeDisplay && <StatCard label="Date Range" value={dateRangeDisplay} />}
                {selectedArtist && stats.monthlyListeners !== null && <StatCard label="Monthly Listeners" value={stats.monthlyListeners.toLocaleString()} />}
                {selectedVenue && stats.capacity !== null && <StatCard label="Capacity" value={stats.capacity.toLocaleString()} />}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6 mb-6">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-foreground">Filters</h2>
              <button
                onClick={() => {
                  setSelectedShowType(null); setSelectedArtist(null); setSelectedVenue(null)
                  setSelectedFestival(null); setCapacityFilter('all'); setCapacityRange([0, 65000])
                  setStatusFilter('all'); setYearRange([1900, 2026]); setHasManualYearChange(false)
                  setCurrentPage(1); setPageInput('1')
                }}
                className="text-xs border border-border rounded px-2 py-0.5 text-muted-foreground hover:border-destructive hover:text-destructive transition-colors"
              >
                Clear All
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Show Type</label>
                <select value={selectedShowType || ''}
                  onChange={(e) => { setSelectedShowType(e.target.value || null); setCurrentPage(1); setPageInput('1') }}
                  className="w-full px-3 py-2 text-sm text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="">All Shows</option>
                  <option value="music">Music</option>
                  <option value="comedy">Comedy</option>
                  <option value="festival">Festival</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Artist</label>
                <Select instanceId="artist-select" options={artistOptions} value={selectedArtist}
                  onChange={(o) => { setSelectedArtist(o); setCurrentPage(1); setPageInput('1') }}
                  isClearable placeholder="All artists..." className="text-sm" styles={customSelectStyles} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Venue</label>
                <Select instanceId="venue-select" options={venueOptions} value={selectedVenue}
                  onChange={(o) => { setSelectedVenue(o); setCurrentPage(1); setPageInput('1') }}
                  isClearable placeholder="All venues..." className="text-sm" styles={customSelectStyles} />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Festival</label>
                <Select instanceId="festival-select" options={festivalOptions} value={selectedFestival}
                  onChange={(o) => { setSelectedFestival(o); setCurrentPage(1); setPageInput('1') }}
                  isClearable placeholder="All festivals..." className="text-sm" styles={customSelectStyles} />
              </div>
            </div>

            {/* Venue Filters */}
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-3">
                <label className="text-sm font-medium text-foreground">Venue Filters</label>
                {unknownCapacityCount > 0 && capacityFilter !== 'unknown' && capacityFilter !== 'all' && (
                  <span className="text-xs text-muted-foreground">
                    ·{' '}
                    <button
                      onClick={() => handleCapacityButton('unknown', [0, 65000])}
                      className="text-primary hover:opacity-80 font-medium underline underline-offset-2"
                    >
                      {unknownCapacityCount.toLocaleString()} shows with unknown capacity hidden
                    </button>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Size</span>
                  <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                    {CAPACITY_BUTTONS.map(btn => (
                      <button key={btn.key} onClick={() => handleCapacityButton(btn.key, btn.range)} title={btn.tooltip}
                        className={`px-2.5 py-1.5 transition-colors ${capacityFilter === btn.key ? 'bg-primary text-primary-foreground' : `bg-card ${btn.unselectedClass} hover:bg-muted`}`}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                    {STATUS_BUTTONS.map(btn => (
                      <button key={btn.key} onClick={() => { setStatusFilter(btn.key); setCurrentPage(1); setPageInput('1') }}
                        className={`px-2.5 py-1.5 transition-colors ${statusFilter === btn.key ? 'bg-primary text-primary-foreground' : `bg-card ${btn.unselectedClass} hover:bg-muted`}`}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 max-w-sm">
                <Slider range min={0} max={65000}
                  value={capacityFilter === 'unknown' ? [0, 65000] : capacityRange}
                  onChange={handleCapacitySlider} disabled={capacityFilter === 'unknown'} styles={sliderStyles} />
                <div className="text-xs text-muted-foreground mt-1 text-center">
                  {capacityFilter === 'unknown' ? 'Unknown capacity' : `${capacityRange[0].toLocaleString()} – ${capacityRange[1] === 65000 ? '65,000+' : capacityRange[1].toLocaleString()}`}
                </div>
              </div>
            </div>

            {/* Year Range */}
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-2">
                <label className="block text-sm font-medium text-foreground">Year Range:</label>
                <input type="number" value={typeof yearRange[0] === 'number' ? yearRange[0] : 1900}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v >= 1900 && v <= (typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]))) {
                      setYearRange([v, yearRange[1]]); setHasManualYearChange(true); setCurrentPage(1); setPageInput('1')
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  min={1900} max={2026}
                  className="w-16 md:w-20 px-2 py-1 text-xs md:text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring" />
                <span className="text-sm text-foreground">—</span>
                <input type="number" value={typeof yearRange[1] === 'number' ? yearRange[1] : 2026}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (!isNaN(v) && v <= 2026 && v >= (typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]))) {
                      setYearRange([yearRange[0], v]); setHasManualYearChange(true); setCurrentPage(1); setPageInput('1')
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                  min={1900} max={2026}
                  className="w-16 md:w-20 px-2 py-1 text-xs md:text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring" />
              </div>
              <Slider range min={1900} max={2026}
                value={[typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900, typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2026]}
                onChange={(value) => { const v = value as number[]; setYearRange([v[0], v[1]] as [number, number]); setHasManualYearChange(true); setCurrentPage(1); setPageInput('1') }}
                marks={{
                  1900: '1900',
                  1910: { label: <span className="hidden md:inline">1910</span> },
                  1920: { label: <span className="hidden md:inline">1920</span> },
                  1930: { label: <span className="hidden md:inline">1930</span> },
                  1940: { label: <span className="hidden md:inline">1940</span> },
                  1950: { label: <span className="hidden md:inline">1950</span> },
                  1960: { label: <span className="hidden md:inline">1960</span> },
                  1970: { label: <span className="hidden md:inline">1970</span> },
                  1980: { label: <span className="hidden md:inline">1980</span> },
                  1990: { label: <span className="hidden md:inline">1990</span> },
                  2000: { label: <span className="hidden md:inline">2000</span> },
                  2010: { label: <span className="hidden md:inline">2010</span> },
                  2020: { label: <span className="hidden md:inline">2020</span> },
                  2026: '2026',
                }}
                styles={sliderStyles} />
            </div>
          </div>

          {/* Shows Table */}
          <div className="rounded-lg shadow-lg overflow-x-auto">
            <table className="min-w-full divide-y divide-border table-fixed">
              <thead className="bg-muted">
                <tr>
                  {user && <th className={`hidden md:table-cell ${thBase} w-12`}></th>}
                  <th className={`hidden md:table-cell ${thSortable} w-28 whitespace-nowrap`} onClick={() => handleSort('date')}>
                    Date {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`hidden md:table-cell ${thSortable} w-64`} onClick={() => handleSort('artist')}>
                    Artist {sortField === 'artist' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`hidden md:table-cell ${thSortable} w-56`} onClick={() => handleSort('venue')}>
                    <span className="flex items-center gap-1.5">
                      <span>Venue {sortField === 'venue' && (sortDirection === 'asc' ? '↑' : '↓')}</span>
                      {showFestivalContext && (
                        <button onClick={(e) => { e.stopPropagation(); handleFestivalSort() }}
                          className={sortField === 'festival' ? festivalSortActiveClass : festivalSortInactiveClass}
                          title="Sort by festival name">
                          {sortField === 'festival' ? (sortDirection === 'asc' ? 'F↑' : 'F↓') : 'F'}
                        </button>
                      )}
                    </span>
                  </th>
                  <th className={`hidden md:table-cell ${thCenter} w-14`}>Setlist</th>
                  <th className={`hidden md:table-cell ${thCenter} w-14`}>Spotify</th>
                  {user && <th className={`md:hidden ${thBase} w-8 px-1`}></th>}
                  <th className={`md:hidden ${thSortable} px-1`} onClick={() => handleSort('date')}>
                    Date {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className={`md:hidden ${thBase} px-1`}>
                    <span className="flex items-center gap-3">
                      <button onClick={() => handleSort('artist')} className={`hover:text-foreground transition-colors ${sortField === 'artist' ? 'text-foreground' : ''}`}>
                        Artist {sortField === 'artist' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </button>
                      <button onClick={() => handleSort('venue')} className={`hover:text-foreground transition-colors ${sortField === 'venue' ? 'text-foreground' : ''}`}>
                        Venue {sortField === 'venue' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </button>
                    </span>
                  </th>
                  <th className={`md:hidden ${thCenter}`}></th>
                </tr>
              </thead>
              <tbody className="bg-card divide-y divide-border">
                {currentShows.map((show) => {
                  const artist = artistMap.get(show.artist_id)
                  const venue = venueMap.get(show.venue_id)
                  const isAdded = userShows.has(show.show_id)
                  const isLoading = loadingShows.has(show.show_id)
                  const venueTooltip = venue?.other_names ? `Also known as: ${venue.other_names}` : (venue?.venue_name || '')

                  const heartButton = (
                    <button onClick={() => toggleShow(show.show_id)} disabled={isLoading}
                      className="focus:outline-none disabled:opacity-50"
                      title={isAdded ? 'Remove from My Shows' : 'Add to My Shows'}>
                      {isLoading ? (
                        <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin"></div>
                      ) : (
                        <svg className={`w-5 h-5 transition-colors ${isAdded ? 'fill-destructive text-destructive' : 'fill-none text-muted-foreground hover:text-destructive'}`}
                          stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                        </svg>
                      )}
                    </button>
                  )

                  const setlistIcon = show.setlist_url ? (
                    <a href={show.setlist_url} target="_blank" rel="noopener noreferrer"
                      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center" title="View on setlist.fm">
                      <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-3.5 h-3.5 md:w-4 md:h-4 dark:invert" />
                    </a>
                  ) : <span className="text-muted-foreground text-xs leading-none">–</span>

                  const spotifyIcon = artist?.spotify_artist_id ? (
                    <a href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`} target="_blank" rel="noopener noreferrer"
                      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center" title="Open in Spotify">
                      <svg className="w-3.5 h-3.5 md:w-4 md:h-4" viewBox="0 0 24 24" fill="#1DB954">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                    </a>
                  ) : <span className="text-muted-foreground text-xs leading-none">–</span>

                  return (
                    <tr key={show.show_id} className="hover:bg-muted/50">
                      {user && <td className="hidden md:table-cell px-3 py-3">{heartButton}</td>}
                      <td className="hidden md:table-cell px-3 py-3 whitespace-nowrap text-sm text-foreground">
                        {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="hidden md:table-cell px-3 py-3 max-w-[256px]">
                        <button
                          onClick={() => { setSelectedArtist({ value: show.artist_id, label: artist?.artist_name || '' }); setCurrentPage(1); setPageInput('1') }}
                          className="text-sm text-primary hover:opacity-80 hover:underline text-left w-full truncate block"
                          title={artist?.artist_name || ''}>
                          {artist?.artist_name || ''}
                        </button>
                      </td>
                      <td className="hidden md:table-cell px-3 py-3 max-w-[224px]">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => { setSelectedVenue({ value: show.venue_id, label: venue?.venue_name || '' }); setCurrentPage(1); setPageInput('1') }}
                            className="text-sm text-primary hover:opacity-80 hover:underline text-left truncate shrink-0 max-w-[140px]"
                            title={venueTooltip}>
                            {venue?.venue_name || ''}
                          </button>
                          {show.festival_name && (
                            <button
                              onClick={() => { setSelectedFestival({ value: show.festival_name!, label: show.festival_name! }); setCurrentPage(1); setPageInput('1') }}
                              className={'ml-1 ' + festivalBadgeClass} title={`Filter by ${show.festival_name}`}>
                              <span className="font-bold">F</span>
                              <span className="truncate max-w-[100px]">{'· ' + show.festival_name}</span>
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="hidden md:table-cell py-3 w-14 px-0 align-middle">
                        <div className="flex items-center justify-center">{setlistIcon}</div>
                      </td>
                      <td className="hidden md:table-cell py-3 w-14 px-0 align-middle">
                        <div className="flex items-center justify-center">{spotifyIcon}</div>
                      </td>

                      {user && <td className="md:hidden px-1 py-2 align-middle w-7">{heartButton}</td>}
                      <td className="md:hidden px-1 py-2 align-top whitespace-nowrap">
                        <span className="text-[11px] text-foreground">
                          {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </span>
                      </td>
                      <td className="md:hidden px-1 py-2">
                        <button
                          onClick={() => { setSelectedArtist({ value: show.artist_id, label: artist?.artist_name || '' }); setCurrentPage(1); setPageInput('1') }}
                          className="text-[11px] text-primary hover:opacity-80 hover:underline text-left w-full truncate block leading-snug"
                          title={artist?.artist_name || ''}>
                          {artist?.artist_name || ''}
                        </button>
                        <div className="flex items-center gap-1 mt-0.5">
                          <button
                            onClick={() => { setSelectedVenue({ value: show.venue_id, label: venue?.venue_name || '' }); setCurrentPage(1); setPageInput('1') }}
                            className="text-[10px] text-muted-foreground hover:text-primary hover:underline text-left truncate leading-snug min-w-0"
                            title={venueTooltip}>
                            {venue?.venue_name || ''}
                          </button>
                          {show.festival_name && (
                            <button
                              onClick={() => { setSelectedFestival({ value: show.festival_name!, label: show.festival_name! }); setCurrentPage(1); setPageInput('1') }}
                              className={festivalBadgeMobileClass} title={`Filter by ${show.festival_name}`}>
                              F
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="md:hidden py-2 px-1 w-10 align-middle">
                        <div className="flex items-center justify-center gap-2">{setlistIcon}{spotifyIcon}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="bg-muted px-4 py-3 border-t border-border rounded-b-lg shadow-lg">
            <div className="flex items-center justify-between">
              <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}
                className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed">
                Previous
              </button>
              <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
                <input type="number" min="1" max={totalPages} value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => { const p = parseInt(pageInput); if (isNaN(p) || p < 1 || p > totalPages) setPageInput(currentPage.toString()) }}
                  className="w-12 px-2 py-1 text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring" />
                <span className="text-sm text-muted-foreground">/ {totalPages}</span>
              </form>
              <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}
                className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed">
                Next
              </button>
            </div>
          </div>

        </div>
      </main>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow p-2 md:p-4">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className="text-sm md:text-2xl font-bold text-foreground break-words leading-tight">{value}</p>
    </div>
  )
}

export default function BrowseClient({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <BrowseContent shows={shows} artists={artists} venues={venues} />
    </Suspense>
  )
}
