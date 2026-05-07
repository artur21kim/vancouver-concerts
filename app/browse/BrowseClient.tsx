'use client'

import { useState, useEffect, useCallback, useTransition, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import AsyncSelect from 'react-select/async'
import Select from 'react-select'
import { useAuth } from '../providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import Navigation from '../components/Navigation'
import { useTheme } from 'next-themes'

// ── Types ─────────────────────────────────────────────────────────────────────
type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  show_type: string | null
  festival_name: string | null
  artist_id: number
  venue_id: number
  artist_name: string
  monthly_listeners: number | null
  spotify_artist_id: string | null
  venue_name: string
  capacity: number | null
  capacity_category: string | null
  venue_status: string | null
  other_names: string | null
}

type Venue = {
  venue_id: number
  venue_name: string
  capacity: number | null
  capacity_category: string | null
  status: string | null
  other_names: string | null
}

type Stats = {
  total_shows: number
  unique_artists: number
  unique_venues: number
  first_show: string | null
  last_show: string | null
}

type SelectOption = { value: number | string; label: string }
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type StatusFilter = 'all' | 'open' | 'closed'
type SortField = 'date' | 'artist' | 'venue' | 'festival'

// ── Constants ────────────────────────────────────────────────────────────────
const DECADES = ['All Time', '1900s', '1910s', '1920s', '1930s', '1940s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s']

const CAPACITY_BUTTONS: { key: CapacityFilter; label: string; tooltip: string; unselectedClass: string }[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        unselectedClass: 'text-muted-foreground' },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     unselectedClass: 'text-purple-400 dark:text-purple-300' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-[#3A8FBD]' },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  unselectedClass: 'text-orange-600 dark:text-orange-400' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    unselectedClass: 'text-rose-600 dark:text-rose-400' },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  unselectedClass: 'text-gray-400 dark:text-gray-500' },
]

const STATUS_BUTTONS: { key: StatusFilter; label: string }[] = [
  { key: 'all',    label: 'All'    },
  { key: 'open',   label: 'Open'   },
  { key: 'closed', label: 'Closed' },
]

const MONTH_NAMES_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']
const TEAL = '#00BFA8'

// ── Helpers ───────────────────────────────────────────────────────────────────
function decadeToParam(label: string): string {
  return label === 'All Time' ? 'all' : label
}
function paramToDecadeLabel(param: string): string {
  return param === 'all' ? 'All Time' : param
}

function decadeContainsYear(decade: string, year: number): boolean {
  if (decade === 'all') return true
  const start = parseInt(decade.replace('s', ''))
  return year >= start && year <= start + 9
}

// ── Main component ────────────────────────────────────────────────────────────
function BrowseContent({
  initialShows,
  initialTotal,
  initialStats,
  initialTotalPages,
  venues,
  initialParams,
}: {
  initialShows: Show[]
  initialTotal: number
  initialStats: Stats
  initialTotalPages: number
  venues: Venue[]
  initialParams: {
    decade: string; year?: string; month?: string
    artistId?: string; venueId?: string; showType?: string
    festival?: string; capacity?: string; status?: string
    page: number; sort: string; dir: string
  }
}) {
  const router   = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { setMounted(true) }, [])
  const isDark = mounted && resolvedTheme === 'dark'

  // ── Client-side data state (loaded from server, refreshed on filter change)
  const [shows,      setShows]      = useState<Show[]>(initialShows)
  const [total,      setTotal]      = useState(initialTotal)
  const [totalPages, setTotalPages] = useState(initialTotalPages)
  const [stats,      setStats]      = useState<Stats>(initialStats)
  const [loading,    setLoading]    = useState(false)

  // ── Filter state (mirrors URL) ────────────────────────────────────────────
  const [decade,    setDecade]    = useState(initialParams.decade)
  const [year,      setYear]      = useState<string | undefined>(initialParams.year)
  const [month,     setMonth]     = useState<string | undefined>(initialParams.month)
  const [artistId,  setArtistId]  = useState<string | undefined>(initialParams.artistId)
  const [artistOption, setArtistOption] = useState<SelectOption | null>(
    initialParams.artistId ? { value: parseInt(initialParams.artistId), label: '...' } : null
  )
  const [venueId,   setVenueId]   = useState<string | undefined>(initialParams.venueId)
  const [showType,  setShowType]  = useState(initialParams.showType || '')
  const [festival,  setFestival]  = useState<SelectOption | null>(null)
  const [capacity,  setCapacity]  = useState<CapacityFilter>((initialParams.capacity as CapacityFilter) || 'all')
  const [status,    setStatus]    = useState<StatusFilter>((initialParams.status as StatusFilter) || 'all')
  const [page,      setPage]      = useState(initialParams.page)
  const [pageInput, setPageInput] = useState(String(initialParams.page))
  const [sortField, setSortField] = useState<SortField>((initialParams.sort as SortField) || 'date')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>((initialParams.dir as 'asc' | 'desc') || 'desc')

  // ── User shows (heart buttons) ────────────────────────────────────────────
  const [userShows,    setUserShows]    = useState<Set<number>>(new Set())
  const [loadingShows, setLoadingShows] = useState<Set<number>>(new Set())

  useEffect(() => {
    const fetchUserShows = async () => {
      if (!user) return
      const supabase = createClient()
      const { data } = await supabase.from('user_shows').select('show_id').eq('user_id', user.id)
      if (data) setUserShows(new Set(data.map((s: any) => s.show_id)))
    }
    fetchUserShows()
  }, [user])

  // ── Venues list (passed from server, used for venue dropdown) ─────────────
  const venueOptions: SelectOption[] = venues.map(v => ({
    value: v.venue_id,
    label: v.venue_name,
  }))

  const selectedVenueOption = venueId
    ? venueOptions.find(o => o.value === parseInt(venueId)) ?? null
    : null

  // ── Festival options (loaded once) ────────────────────────────────────────
  const [festivalOptions, setFestivalOptions] = useState<SelectOption[]>([])
  useEffect(() => {
    fetch('/api/browse/festivals')
      .then(r => r.json())
      .then(d => setFestivalOptions(d.festivals || []))
      .catch(() => {})
  }, [])

  // ── Artist async search ───────────────────────────────────────────────────
  const loadArtistOptions = useCallback(
    async (inputValue: string) => {
      if (inputValue.length < 1) return []
      const res = await fetch(`/api/browse/artists/search?q=${encodeURIComponent(inputValue)}`)
      const data = await res.json()
      return data.artists || []
    },
    []
  )

  // If we have an initial artistId from URL, resolve the name
  useEffect(() => {
    if (initialParams.artistId && artistOption?.label === '...') {
      fetch(`/api/browse/artists/search?q=`)
        .then(() => {})
        .catch(() => {})
      // Fetch the specific artist name
      const supabase = createClient()
      supabase
        .from('dim_artist')
        .select('artist_id, artist_name')
        .eq('artist_id', parseInt(initialParams.artistId))
        .single()
        .then(({ data }) => {
          if (data) setArtistOption({ value: data.artist_id, label: data.artist_name })
        })
    }
  }, [])

  // ── Core: push URL + fetch new data ──────────────────────────────────────
  const fetchData = useCallback(async (params: {
    decade: string; year?: string; month?: string
    artistId?: string; venueId?: string; showType?: string
    festival?: string; capacity?: string; status?: string
    page: number; sort: string; dir: string
  }) => {
    setLoading(true)

    const qs = new URLSearchParams()
    qs.set('decade', params.decade)
    if (params.year)     qs.set('year',      params.year)
    if (params.month)    qs.set('month',     params.month)
    if (params.artistId) qs.set('artist_id', params.artistId)
    if (params.venueId)  qs.set('venue_id',  params.venueId)
    if (params.showType) qs.set('show_type', params.showType)
    if (params.festival) qs.set('festival',  params.festival)
    if (params.capacity && params.capacity !== 'all') qs.set('capacity', params.capacity)
    if (params.status && params.status !== 'all')     qs.set('status',   params.status)
    qs.set('page', String(params.page))
    qs.set('sort', params.sort)
    qs.set('dir',  params.dir)

    // Update URL without full navigation
    startTransition(() => {
      router.push(`${pathname}?${qs.toString()}`, { scroll: false })
    })

    try {
      const res  = await fetch(`/api/browse/shows?${qs.toString()}`)
      const data = await res.json()
      setShows(data.shows || [])
      setTotal(data.total || 0)
      setTotalPages(data.total_pages || 1)
      setStats(data.stats || { total_shows: 0, unique_artists: 0, unique_venues: 0, first_show: null, last_show: null })
      setPage(params.page)
      setPageInput(String(params.page))
    } catch (e) {
      console.error('Browse fetch error:', e)
    } finally {
      setLoading(false)
    }
  }, [router, pathname])

  // ── Filter change handlers ────────────────────────────────────────────────
  const currentParams = () => ({
    decade, year, month, artistId, venueId,
    showType: showType || undefined,
    festival: (festival?.value as string) || undefined,
    capacity, status, page, sort: sortField, dir: sortDir,
  })

  const applyFilter = (overrides: Partial<ReturnType<typeof currentParams>>) => {
    const next = { ...currentParams(), ...overrides, page: 1 }
    fetchData(next)
  }

  const handleDecadeClick = (label: string) => {
    const d = decadeToParam(label)
    setDecade(d); setYear(undefined); setMonth(undefined)
    applyFilter({ decade: d, year: undefined, month: undefined })
  }

  const handleYearClick = (y: number) => {
    setYear(String(y)); setMonth(undefined)
    applyFilter({ year: String(y), month: undefined })
  }

  const handleArtistChange = (option: SelectOption | null) => {
    setArtistOption(option)
    const id = option ? String(option.value) : undefined
    setArtistId(id)
    applyFilter({ artistId: id })
  }

  const handleVenueChange = (option: SelectOption | null) => {
    const id = option ? String(option.value) : undefined
    setVenueId(id)
    applyFilter({ venueId: id })
  }

  const handleShowTypeChange = (val: string) => {
    setShowType(val)
    applyFilter({ showType: val || undefined })
  }

  const handleFestivalChange = (option: SelectOption | null) => {
    setFestival(option)
    applyFilter({ festival: (option?.value as string) || undefined })
  }

  const handleCapacityClick = (cap: CapacityFilter) => {
    setCapacity(cap)
    applyFilter({ capacity: cap })
  }

  const handleStatusClick = (s: StatusFilter) => {
    setStatus(s)
    applyFilter({ status: s })
  }

  const handleClearAll = () => {
    setDecade('2020s'); setYear(undefined); setMonth(undefined)
    setArtistId(undefined); setArtistOption(null)
    setVenueId(undefined)
    setShowType('')
    setFestival(null)
    setCapacity('all')
    setStatus('all')
    setSortField('date'); setSortDir('desc')
    fetchData({ decade: '2020s', page: 1, sort: 'date', dir: 'desc' })
  }

  const handleSort = (field: SortField) => {
    let newDir: 'asc' | 'desc' = 'asc'
    if (sortField === field) {
      if (sortDir === 'asc') { newDir = 'desc' }
      else { setSortField('date'); setSortDir('desc'); fetchData({ ...currentParams(), sort: 'date', dir: 'desc', page: 1 }); return }
    }
    setSortField(field); setSortDir(newDir)
    fetchData({ ...currentParams(), sort: field, dir: newDir, page: 1 })
  }

  const handlePageChange = (p: number) => {
    if (p < 1 || p > totalPages) return
    fetchData({ ...currentParams(), page: p })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = parseInt(pageInput)
    if (!isNaN(p) && p >= 1 && p <= totalPages) handlePageChange(p)
    else setPageInput(String(page))
  }

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
    } catch { console.error('Error toggling show') }
    finally {
      setLoadingShows(prev => { const s = new Set(prev); s.delete(showId); return s })
    }
  }

  // ── Derived UI values ─────────────────────────────────────────────────────
  const activeDecadeLabel = paramToDecadeLabel(decade)

  const pageTitle = (() => {
    const parts: string[] = []
    if (artistOption && artistId) parts.push(artistOption.label)
    if (venueId) {
      const v = venues.find(v => v.venue_id === parseInt(venueId))
      if (v) parts.push(v.venue_name)
    }
    if (month && year) parts.push(`${MONTH_NAMES_FULL[parseInt(month) - 1]} ${year}`)
    else if (year)     parts.push(year)
    else if (decade !== 'all') parts.push(activeDecadeLabel)
    if (festival)  parts.push(festival.label)
    if (showType === 'comedy')  parts.push('Comedy')
    if (showType === 'festival') parts.push('Festivals')
    return parts.length > 0 ? `Browse: ${parts.join(' · ')}` : 'Browse Shows'
  })()

  const dateRangeDisplay = (() => {
    if (!stats.first_show || !stats.last_show) return null
    const fmt = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    return stats.first_show === stats.last_show ? fmt(stats.first_show) : `${fmt(stats.first_show)} – ${fmt(stats.last_show)}`
  })()

  const dateRangeDisplayMobile = (() => {
    if (!stats.first_show || !stats.last_show) return null
    const y1 = stats.first_show.split('-')[0]
    const y2 = stats.last_show.split('-')[0]
    return y1 === y2 ? y1 : `${y1}–${y2}`
  })()

  // ── react-select styles ───────────────────────────────────────────────────
  const customSelectStyles = {
    control: (base: any, state: any) => ({
      ...base,
      fontSize: '0.875rem',
      backgroundColor: isDark ? 'oklch(0.200 0.03 260)' : 'oklch(0.951 0.02 85)',
      borderColor: state.hasValue ? TEAL : isDark ? 'oklch(0.248 0.03 260)' : 'oklch(0.873 0.02 85)',
      borderWidth: state.hasValue ? '1.5px' : '1px',
      boxShadow: 'none',
      '&:hover': { borderColor: state.hasValue ? TEAL : isDark ? 'oklch(0.38 0.03 260)' : 'oklch(0.820 0.02 85)' }
    }),
    menu: (base: any) => ({
      ...base,
      backgroundColor: isDark ? 'oklch(0.200 0.03 260)' : 'oklch(0.951 0.02 85)',
      borderColor: isDark ? 'oklch(0.248 0.03 260)' : 'oklch(0.873 0.02 85)',
    }),
    singleValue:       (base: any) => ({ ...base, color: isDark ? 'oklch(0.95 0 0)' : 'oklch(0.145 0 0)' }),
    placeholder:       (base: any) => ({ ...base, color: isDark ? 'oklch(0.55 0.04 220)' : 'oklch(0.45 0.02 85)' }),
    option:            (base: any, state: any) => ({
      ...base,
      backgroundColor: state.isFocused ? (isDark ? 'oklch(0.228 0.03 260)' : 'oklch(0.910 0.02 85)') : (isDark ? 'oklch(0.200 0.03 260)' : 'oklch(0.951 0.02 85)'),
      color: isDark ? 'oklch(0.95 0 0)' : 'oklch(0.145 0 0)',
    }),
    input:             (base: any) => ({ ...base, color: isDark ? 'oklch(0.95 0 0)' : 'oklch(0.145 0 0)' }),
    indicatorSeparator:(base: any) => ({ ...base, backgroundColor: isDark ? 'oklch(0.248 0.03 260)' : 'oklch(0.873 0.02 85)' }),
    dropdownIndicator: (base: any) => ({ ...base, color: isDark ? 'oklch(0.55 0.04 220)' : 'oklch(0.45 0.02 85)' }),
    clearIndicator:    (base: any) => ({ ...base, color: isDark ? 'oklch(0.55 0.04 220)' : 'oklch(0.45 0.02 85)' }),
    loadingMessage:    (base: any) => ({ ...base, color: isDark ? 'oklch(0.55 0.04 220)' : 'oklch(0.45 0.02 85)' }),
    noOptionsMessage:  (base: any) => ({ ...base, color: isDark ? 'oklch(0.55 0.04 220)' : 'oklch(0.45 0.02 85)' }),
  }

  const showFestivalContext = showType === 'festival' || !!festival
  const thBase     = 'bg-muted px-1 md:px-3 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider'
  const thSortable = `${thBase} cursor-pointer hover:bg-muted/80`
  const thCenter   = 'bg-muted px-0 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider'

  const festivalBadgeClass = isDark
    ? 'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition whitespace-nowrap'
    : 'inline-flex items-center gap-0.5 px-1 py-px rounded text-[9px] font-medium bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition whitespace-nowrap'

  const festivalBadgeMobileClass = isDark
    ? 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30 transition flex-shrink-0'
    : 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-violet-50 text-violet-600 border border-violet-200 hover:bg-violet-100 transition flex-shrink-0'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4 md:mb-6">{pageTitle}</h1>

          {/* Stats Cards */}
          <div className="mb-4 md:mb-8">
            <div className="grid grid-cols-4 md:grid-cols-3 gap-2 md:gap-4 mb-2 md:mb-4">
              <StatCard label="Shows"   value={stats.total_shows.toLocaleString()} />
              <StatCard label="Artists" value={stats.unique_artists.toLocaleString()} />
              <StatCard label="Venues"  value={stats.unique_venues.toLocaleString()} />
              {dateRangeDisplay && (
                <div className="md:hidden bg-card rounded-lg shadow p-2">
                  <p className="text-[10px] text-muted-foreground mb-0.5 leading-tight">Date Range</p>
                  <p className="text-sm font-bold text-foreground break-words leading-tight">{dateRangeDisplayMobile}</p>
                </div>
              )}
            </div>
            {dateRangeDisplay && (
              <div className="hidden md:grid md:grid-cols-3 gap-4">
                <StatCard label="Date Range" value={dateRangeDisplay} />
                {artistId && (shows[0]?.monthly_listeners != null) && (
                  <StatCard label="Monthly Listeners" value={shows[0].monthly_listeners!.toLocaleString()} />
                )}
                {venueId && (shows[0]?.capacity != null) && (
                  <StatCard label="Capacity" value={shows[0].capacity!.toLocaleString()} />
                )}
              </div>
            )}
          </div>

          {/* Filters */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6 mb-6">
            <div className="flex items-baseline gap-3 mb-4">
              <h2 className="text-lg md:text-xl font-bold text-foreground">Filters</h2>
              <button
                onClick={handleClearAll}
                className="text-xs border border-red-500/40 text-red-400 rounded px-2 py-0.5 hover:bg-red-500/10 hover:border-red-500 transition-colors"
              >
                Clear All
              </button>
            </div>

            {/* Row 1: dropdowns */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Show Type</label>
                <select
                  value={showType}
                  onChange={e => handleShowTypeChange(e.target.value)}
                  className={`w-full px-3 py-1.5 md:py-2 text-sm text-foreground bg-card rounded-md focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${showType ? 'border-[1.5px] border-primary' : 'border border-border'}`}
                >
                  <option value="">All Shows</option>
                  <option value="music">Music</option>
                  <option value="comedy">Comedy</option>
                  <option value="festival">Festival</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Artist</label>
                <AsyncSelect
                  instanceId="artist-select"
                  loadOptions={loadArtistOptions}
                  value={artistOption}
                  onChange={handleArtistChange}
                  isClearable
                  placeholder="Search artists..."
                  noOptionsMessage={({ inputValue }) => inputValue.length < 1 ? 'Type to search…' : 'No artists found'}
                  loadingMessage={() => 'Searching…'}
                  className="text-sm"
                  styles={customSelectStyles}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Venue</label>
                <Select
                  instanceId="venue-select"
                  options={venueOptions}
                  value={selectedVenueOption}
                  onChange={handleVenueChange}
                  isClearable
                  placeholder="All venues..."
                  className="text-sm"
                  styles={customSelectStyles}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Festival</label>
                <Select
                  instanceId="festival-select"
                  options={festivalOptions}
                  value={festival}
                  onChange={handleFestivalChange}
                  isClearable
                  placeholder="All festivals..."
                  className="text-sm"
                  styles={customSelectStyles}
                />
              </div>
            </div>

            {/* Row 2: capacity + status pills */}
            <div className="mb-5">
              <div className="flex items-center gap-x-3 gap-y-3">
                <div className="flex rounded-lg border border-border overflow-hidden text-xs md:text-sm font-semibold">
                  {CAPACITY_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.key}
                      onClick={() => handleCapacityClick(btn.key)}
                      title={btn.tooltip}
                      className={`px-2 py-1.5 md:px-2.5 md:py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        capacity === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : `bg-card ${btn.unselectedClass} hover:bg-muted`
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-1 md:flex-none rounded-lg border border-border overflow-hidden text-xs md:text-sm font-semibold">
                  {STATUS_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.key}
                      onClick={() => handleStatusClick(btn.key)}
                      className={`flex-1 md:flex-none px-2 py-1.5 md:px-2.5 md:py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        status === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Row 3: decade buttons */}
            <div className="overflow-x-auto -mx-3 px-3 md:-mx-4 md:px-4">
              <div className="flex gap-2 min-w-max">
                {DECADES.map(label => {
                  const decadeParam = decadeToParam(label)
                  const isActive = decade === decadeParam && !year
                  const isParent = !!year && decadeContainsYear(decadeParam, parseInt(year || '0'))
                  return (
                    <button
                      key={label}
                      onClick={() => handleDecadeClick(label)}
                      className={`px-3 md:px-4 py-2 rounded-md text-xs md:text-sm font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-primary text-primary-foreground'
                          : isParent
                          ? 'bg-primary/20 text-primary border border-primary/40'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {label}
                      {isParent && <span className="ml-1 text-[10px] opacity-75">› {year}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Loading overlay */}
          {loading && (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          )}

          {/* Shows Table */}
          {!loading && (
            <div className="rounded-lg shadow-lg overflow-x-auto">
              <table className="min-w-full divide-y divide-border table-fixed">
                <thead className="bg-muted">
                  <tr>
                    {user && <th className={`hidden md:table-cell ${thBase} w-12`} />}
                    <th className={`hidden md:table-cell ${thSortable} w-28 whitespace-nowrap`} onClick={() => handleSort('date')}>
                      Date {sortField === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className={`hidden md:table-cell ${thSortable} w-64`} onClick={() => handleSort('artist')}>
                      Artist {sortField === 'artist' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className={`hidden md:table-cell ${thSortable} w-56`} onClick={() => handleSort('venue')}>
                      <span className="flex items-center gap-1.5">
                        <span>Venue {sortField === 'venue' && (sortDir === 'asc' ? '↑' : '↓')}</span>
                        {showFestivalContext && (
                          <button
                            onClick={e => { e.stopPropagation(); handleSort('festival') }}
                            className={`text-[10px] font-bold px-1 py-px rounded border ${
                              sortField === 'festival'
                                ? isDark ? 'bg-violet-500/30 text-violet-300 border-violet-400/50' : 'bg-violet-100 text-violet-700 border-violet-300'
                                : isDark ? 'bg-violet-500/10 text-violet-400 border-violet-500/20 hover:bg-violet-500/20' : 'bg-violet-50 text-violet-500 border-violet-200 hover:bg-violet-100'
                            }`}
                            title="Sort by festival name"
                          >
                            {sortField === 'festival' ? (sortDir === 'asc' ? 'F↑' : 'F↓') : 'F'}
                          </button>
                        )}
                      </span>
                    </th>
                    <th className={`hidden md:table-cell ${thCenter} w-14`}>Setlist</th>
                    <th className={`hidden md:table-cell ${thCenter} w-14`}>Spotify</th>
                    {user && <th className={`md:hidden ${thBase} w-8 px-1`} />}
                    <th className={`md:hidden ${thSortable} px-1`} onClick={() => handleSort('date')}>
                      Date {sortField === 'date' && (sortDir === 'asc' ? '↑' : '↓')}
                    </th>
                    <th className={`md:hidden ${thBase} px-1`}>
                      <span className="flex items-center gap-3">
                        <button onClick={() => handleSort('artist')} className={`hover:text-foreground transition-colors ${sortField === 'artist' ? 'text-foreground' : ''}`}>
                          Artist {sortField === 'artist' && (sortDir === 'asc' ? '↑' : '↓')}
                        </button>
                        <button onClick={() => handleSort('venue')} className={`hover:text-foreground transition-colors ${sortField === 'venue' ? 'text-foreground' : ''}`}>
                          Venue {sortField === 'venue' && (sortDir === 'asc' ? '↑' : '↓')}
                        </button>
                      </span>
                    </th>
                    <th className={`md:hidden ${thCenter}`} />
                  </tr>
                </thead>
                <tbody className="bg-card divide-y divide-border">
                  {shows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-muted-foreground">
                        No shows found matching your filters.
                      </td>
                    </tr>
                  )}
                  {shows.map(show => {
                    const isAdded   = userShows.has(show.show_id)
                    const isLoading = loadingShows.has(show.show_id)
                    const venueTooltip = show.other_names ? `Also known as: ${show.other_names}` : show.venue_name

                    const heartButton = (
                      <button onClick={() => toggleShow(show.show_id)} disabled={isLoading} className="focus:outline-none disabled:opacity-50" title={isAdded ? 'Remove from My Shows' : 'Add to My Shows'}>
                        {isLoading
                          ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                          : <svg className={`w-5 h-5 transition-colors ${isAdded ? 'fill-destructive text-destructive' : 'fill-none text-muted-foreground hover:text-destructive'}`} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                            </svg>
                        }
                      </button>
                    )

                    const setlistIcon = show.setlist_url
                      ? <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity inline-flex items-center justify-center" title="View on setlist.fm">
                          <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-3.5 h-3.5 md:w-4 md:h-4 dark:invert" />
                        </a>
                      : <span className="text-muted-foreground text-xs leading-none">–</span>

                    const spotifyIcon = show.spotify_artist_id
                      ? <a href={`https://open.spotify.com/artist/${show.spotify_artist_id}`} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 transition-opacity inline-flex items-center justify-center" title="Open in Spotify">
                          <svg className="w-3.5 h-3.5 md:w-4 md:h-4" viewBox="0 0 24 24" fill="#1DB954">
                            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                          </svg>
                        </a>
                      : <span className="text-muted-foreground text-xs leading-none">–</span>

                    return (
                      <tr key={show.show_id} className="hover:bg-muted/50">
                        {user && <td className="hidden md:table-cell px-3 py-3">{heartButton}</td>}
                        <td className="hidden md:table-cell px-3 py-3 whitespace-nowrap text-sm text-foreground">
                          {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="hidden md:table-cell px-3 py-3 max-w-[256px]">
                          <button
                            onClick={() => handleArtistChange({ value: show.artist_id, label: show.artist_name })}
                            className="text-sm text-primary hover:opacity-80 hover:underline text-left w-full truncate block"
                            title={show.artist_name}
                          >
                            {show.artist_name}
                          </button>
                        </td>
                        <td className="hidden md:table-cell px-3 py-3 max-w-[224px]">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleVenueChange({ value: show.venue_id, label: show.venue_name })}
                              className="text-sm text-primary hover:opacity-80 hover:underline text-left truncate shrink-0 max-w-[140px]"
                              title={venueTooltip}
                            >
                              {show.venue_name}
                            </button>
                            {show.festival_name && (
                              <button
                                onClick={() => handleFestivalChange({ value: show.festival_name!, label: show.festival_name! })}
                                className={'ml-1 ' + festivalBadgeClass}
                                title={`Filter by ${show.festival_name}`}
                              >
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

                        {/* Mobile */}
                        {user && <td className="md:hidden px-1 py-2 align-middle w-7">{heartButton}</td>}
                        <td className="md:hidden px-1 py-2 align-top whitespace-nowrap">
                          <span className="text-[11px] text-foreground">
                            {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                          </span>
                        </td>
                        <td className="md:hidden px-1 py-2">
                          <button
                            onClick={() => handleArtistChange({ value: show.artist_id, label: show.artist_name })}
                            className="text-[11px] text-primary hover:opacity-80 hover:underline text-left w-full truncate block leading-snug"
                            title={show.artist_name}
                          >
                            {show.artist_name}
                          </button>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              onClick={() => handleVenueChange({ value: show.venue_id, label: show.venue_name })}
                              className="text-[10px] text-muted-foreground hover:text-primary hover:underline text-left truncate leading-snug min-w-0"
                              title={venueTooltip}
                            >
                              {show.venue_name}
                            </button>
                            {show.festival_name && (
                              <button
                                onClick={() => handleFestivalChange({ value: show.festival_name!, label: show.festival_name! })}
                                className={festivalBadgeMobileClass}
                                title={`Filter by ${show.festival_name}`}
                              >F</button>
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
          )}

          {/* Pagination */}
          {!loading && totalPages > 0 && (
            <div className="bg-muted px-4 py-3 border-t border-border rounded-b-lg shadow-lg">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page === 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
                  <input
                    type="number" min="1" max={totalPages} value={pageInput}
                    onChange={e => setPageInput(e.target.value)}
                    onBlur={() => { const p = parseInt(pageInput); if (isNaN(p) || p < 1 || p > totalPages) setPageInput(String(page)) }}
                    className="w-12 px-2 py-1 text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <span className="text-sm text-muted-foreground">/ {totalPages}</span>
                </form>
                <button
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}

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

export default function BrowseClient(props: Parameters<typeof BrowseContent>[0]) {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    }>
      <BrowseContent {...props} />
    </Suspense>
  )
}
