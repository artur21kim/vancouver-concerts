'use client'

import { useState, useEffect, useCallback, useTransition, useMemo, useRef, Suspense } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
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
  tour_name: string | null
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
  ticketmaster_url: string | null
}

type Venue = {
  venue_id: number
  venue_name: string
  capacity: number | null
  capacity_category: string | null
  status: string | null
  other_names: string | null
  city: string | null
  state: string | null
  country: string | null
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
type SortField = 'date' | 'artist' | 'venue' | 'festival' | 'city' | 'tour'

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

const PROVINCE_NAMES: Record<string, string> = {
  BC: 'British Columbia', ON: 'Ontario', QC: 'Quebec', AB: 'Alberta',
  MB: 'Manitoba', SK: 'Saskatchewan', NS: 'Nova Scotia', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', PE: 'Prince Edward Island',
  NT: 'Northwest Territories', NU: 'Nunavut', YT: 'Yukon',
  WA: 'Washington', OR: 'Oregon', CA: 'California', ID: 'Idaho', MT: 'Montana',
}

const COUNTRY_DISPLAY: Record<string, string> = {
  CA: 'Canada', US: 'United States',
}

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

function buildCapacityLabel(cap: string): string {
  const map: Record<string, string> = {
    small: 'Small Venues', medium: 'Medium Venues',
    large: 'Large Venues', xlarge: 'XL Venues', unknown: 'Unknown Capacity',
  }
  return map[cap] ?? cap
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Main component ────────────────────────────────────────────────────────────
function BrowseContent({
  initialShows,
  initialTotal,
  initialStats,
  initialTotalPages,
  venues,
  initialParams,
  initialArtistName,
  initialFestivals,
}: {
  initialShows: Show[]
  initialTotal: number
  initialStats: Stats
  initialTotalPages: number
  venues: Venue[]
  initialParams: {
    decade: string; year?: string; month?: string
    artistId?: string; venueId?: string; showType?: string
    festival?: string; capacity?: string; status?: string; state?: string
    page: number; sort: string; dir: string
  }
  initialArtistName: string | null
  initialFestivals: SelectOption[]
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
    initialParams.artistId && initialArtistName
      ? { value: parseInt(initialParams.artistId), label: initialArtistName }
      : initialParams.artistId
      ? { value: parseInt(initialParams.artistId), label: '...' }
      : null
  )
  const [venueId,   setVenueId]   = useState<string | undefined>(initialParams.venueId)
  const [showType,  setShowType]  = useState(initialParams.showType || '')
  const [festival,  setFestival]  = useState<SelectOption | null>(null)
  const [capacity,  setCapacity]  = useState<CapacityFilter>((initialParams.capacity as CapacityFilter) || 'all')
  const [status,    setStatus]    = useState<StatusFilter>((initialParams.status as StatusFilter) || 'all')
  const [province,  setProvince]  = useState<string>(initialParams.state || '')
  const [page,      setPage]      = useState(initialParams.page)
  const [pageInput, setPageInput] = useState(String(initialParams.page))
  const [sortField, setSortField] = useState<SortField>((initialParams.sort as SortField) || 'date')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>((initialParams.dir as 'asc' | 'desc') || 'desc')
  const [yearJumpInput, setYearJumpInput] = useState('')
  const [unknownCapacityCount, setUnknownCapacityCount] = useState<number | null>(null)

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

  // ── Festival options (loaded server-side, no client fetch needed) ────────
  const [festivalOptions] = useState<SelectOption[]>(initialFestivals)

  // ── Unified search state ──────────────────────────────────────────────────
  const getInitialSearchQuery = () => {
    if (initialParams.artistId && initialArtistName) return initialArtistName
    if (initialParams.venueId) {
      const v = venues.find(v => String(v.venue_id) === initialParams.venueId)
      return v?.venue_name ?? ''
    }
    if (initialParams.festival) return initialParams.festival
    return ''
  }
  const [browseSearchQuery,   setBrowseSearchQuery]   = useState<string>(getInitialSearchQuery)
  const [browseSearchOpen,    setBrowseSearchOpen]    = useState(false)
  const [browseSearchLoading, setBrowseSearchLoading] = useState(false)
  const [browseArtistResults, setBrowseArtistResults] = useState<SelectOption[]>([])
  const browseSearchRef = useRef<HTMLDivElement>(null)

  // Debounced artist search
  useEffect(() => {
    if (!browseSearchQuery.trim()) { setBrowseArtistResults([]); setBrowseSearchLoading(false); return }
    setBrowseSearchLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/browse/artists/search?q=${encodeURIComponent(browseSearchQuery)}`)
        const data = await res.json()
        setBrowseArtistResults(data.artists || [])
      } catch { setBrowseArtistResults([]) }
      finally { setBrowseSearchLoading(false) }
    }, 300)
    return () => clearTimeout(timer)
  }, [browseSearchQuery])

  // Close on outside click, revert to active selection
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (browseSearchRef.current && !browseSearchRef.current.contains(e.target as Node)) {
        setBrowseSearchOpen(false)
        const activeLabel = artistOption?.label ||
          (venueId ? venues.find(v => String(v.venue_id) === venueId)?.venue_name : null) ||
          festival?.label || ''
        setBrowseSearchQuery(activeLabel)
      }
    }
    if (browseSearchOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [browseSearchOpen, artistOption, venueId, festival, venues])

  // Venue + festival results filtered client-side from loaded data
  const filteredVenueResults = useMemo(() => {
    if (!browseSearchQuery.trim()) return []
    const q = browseSearchQuery.toLowerCase()
    return venues.filter(v => v.venue_name.toLowerCase().includes(q)).slice(0, 5)
  }, [browseSearchQuery, venues])

  const filteredFestivalResults = useMemo(() => {
    if (!browseSearchQuery.trim()) return []
    const q = browseSearchQuery.toLowerCase()
    return festivalOptions.filter(f => f.label.toLowerCase().includes(q)).slice(0, 5)
  }, [browseSearchQuery, festivalOptions])

  // ── Location data derived from venues ────────────────────────────────────
  const availableLocations = useMemo(() => {
    const seen = new Set<string>()
    const result: { state: string; country: string }[] = []
    for (const v of venues) {
      if (!v.state || !v.country) continue
      const key = `${v.state}:${v.country}`
      if (!seen.has(key)) { seen.add(key); result.push({ state: v.state, country: v.country }) }
    }
    return result.sort((a, b) => {
      if (a.country !== b.country) return a.country === 'CA' ? -1 : b.country === 'CA' ? 1 : a.country.localeCompare(b.country)
      return (PROVINCE_NAMES[a.state] ?? a.state).localeCompare(PROVINCE_NAMES[b.state] ?? b.state)
    })
  }, [venues])

  const venueCityMap = useMemo(() => {
    const map = new Map<number, { city: string | null; state: string | null }>()
    for (const v of venues) map.set(v.venue_id, { city: v.city ?? null, state: v.state ?? null })
    return map
  }, [venues])


  // ── Core: push URL + fetch new data ──────────────────────────────────────
  const fetchData = useCallback(async (params: {
    decade: string; year?: string; month?: string
    artistId?: string; venueId?: string; showType?: string
    festival?: string; capacity?: string; status?: string; province?: string
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
    if (params.province)                               qs.set('state',    params.province)
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

      // Fetch unknown capacity count for the same filters (excluding capacity filter itself)
      if (params.capacity && params.capacity !== 'all' && params.capacity !== 'unknown') {
        const uqs = new URLSearchParams(qs)
        uqs.set('capacity', 'unknown')
        uqs.delete('page')
        const uRes = await fetch(`/api/browse/shows?${uqs.toString()}`)
        const uData = await uRes.json()
        setUnknownCapacityCount(uData.stats?.total_shows ?? null)
      } else {
        setUnknownCapacityCount(null)
      }
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
    capacity, status, province: province || undefined, page, sort: sortField, dir: sortDir,
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

  const handleYearJump = (e: React.FormEvent) => {
    e.preventDefault()
    const y = parseInt(yearJumpInput)
    if (isNaN(y) || y < 1900 || y > 2099) return
    // If decade is set and year is outside it, switch decade automatically
    const decadeStart = decade !== 'all' ? parseInt(decade.replace('s', '')) : null
    const targetDecade = `${Math.floor(y / 10) * 10}s`
    const newDecade = (decadeStart !== null && (y < decadeStart || y > decadeStart + 9))
      ? targetDecade
      : decade
    setDecade(newDecade)
    setYear(String(y)); setMonth(undefined)
    setYearJumpInput('')
    applyFilter({ decade: newDecade, year: String(y), month: undefined })
  }

  const handleBrowseSearchSelect = (
    type: 'artist' | 'venue' | 'festival',
    id: number | string,
    label: string
  ) => {
    setBrowseSearchQuery(label)
    setBrowseSearchOpen(false)
    setBrowseArtistResults([])
    if (type === 'artist') {
      const newId = String(id)
      setArtistId(newId); setArtistOption({ value: id as number, label })
      setVenueId(undefined); setFestival(null)
      applyFilter({ artistId: newId, venueId: undefined, festival: undefined })
    } else if (type === 'venue') {
      const newId = String(id)
      setVenueId(newId)
      setArtistId(undefined); setArtistOption(null); setFestival(null)
      applyFilter({ venueId: newId, artistId: undefined, festival: undefined })
    } else {
      const opt = { value: id as string, label }
      setFestival(opt)
      setArtistId(undefined); setArtistOption(null); setVenueId(undefined)
      applyFilter({ festival: id as string, artistId: undefined, venueId: undefined })
    }
  }

  const handleBrowseSearchClear = () => {
    setBrowseSearchQuery(''); setBrowseArtistResults([]); setBrowseSearchOpen(false)
    setArtistId(undefined); setArtistOption(null); setVenueId(undefined); setFestival(null)
    applyFilter({ artistId: undefined, venueId: undefined, festival: undefined })
  }

  const handleShowTypeChange = (val: string) => {
    setShowType(val)
    applyFilter({ showType: val || undefined })
  }

  const handleCapacityClick = (cap: CapacityFilter) => {
    setCapacity(cap)
    applyFilter({ capacity: cap })
  }

  const handleStatusClick = (s: StatusFilter) => {
    setStatus(s)
    applyFilter({ status: s })
  }

  const handleProvinceChange = (val: string) => {
    setProvince(val)
    applyFilter({ province: val || undefined })
  }

  const handleClearAll = () => {
    setDecade('2020s'); setYear(undefined); setMonth(undefined)
    setArtistId(undefined); setArtistOption(null)
    setVenueId(undefined)
    setShowType('')
    setFestival(null)
    setCapacity('all')
    setStatus('all')
    setProvince('')
    setBrowseSearchQuery(''); setBrowseArtistResults([]); setBrowseSearchOpen(false)
    setSortField('date'); setSortDir('desc')
    fetchData({ decade: '2020s', page: 1, sort: 'date', dir: 'desc' })
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (field === 'date') {
        // Date toggles desc ↔ asc indefinitely
        const newDir = sortDir === 'desc' ? 'asc' : 'desc'
        setSortDir(newDir)
        fetchData({ ...currentParams(), sort: field, dir: newDir, page: 1 })
      } else {
        if (sortDir === 'asc') {
          // Second click: flip to desc
          setSortDir('desc')
          fetchData({ ...currentParams(), sort: field, dir: 'desc', page: 1 })
        } else {
          // Third click: reset to date desc
          setSortField('date'); setSortDir('desc')
          fetchData({ ...currentParams(), sort: 'date', dir: 'desc', page: 1 })
        }
      }
    } else {
      // New field: start asc
      setSortField(field); setSortDir('asc')
      fetchData({ ...currentParams(), sort: field, dir: 'asc', page: 1 })
    }
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
    const artistName = artistOption && artistId ? artistOption.label : null
    const venueName  = venueId ? (venues.find(v => v.venue_id === parseInt(venueId))?.venue_name ?? null) : null

    // Entity filters: artist and/or venue take top priority
    if (artistName && venueName) return `Browse: ${artistName} @ ${venueName}`
    if (artistName) {
      // Append capacity/status context if set alongside artist
      const extras: string[] = []
      if (capacity && capacity !== 'all') extras.push(buildCapacityLabel(capacity))
      if (status   && status   !== 'all') extras.push(`(${capitalize(status)})`)
      return extras.length > 0 ? `Browse: ${artistName} · ${extras.join(' ')}` : `Browse: ${artistName}`
    }
    if (venueName) return `Browse: ${venueName}`

    // No entity filter — build from scope filters
    const parts: string[] = []

    // Capacity + status
    const capLabel = capacity && capacity !== 'all' ? buildCapacityLabel(capacity) : null
    const stLabel  = status   && status   !== 'all' ? `(${capitalize(status)})`   : null
    if (capLabel || stLabel) {
      parts.push([capLabel, stLabel].filter(Boolean).join(' '))
    }

    // Date scope
    if (month && year) {
      parts.push(`${MONTH_NAMES_FULL[parseInt(month) - 1]} ${year}`)
    } else if (year) {
      parts.push(`${activeDecadeLabel} › ${year}`)
    } else if (decade !== 'all') {
      parts.push(activeDecadeLabel)
    } else {
      parts.push('All Time')
    }

    // Show type / festival
    if (festival)               parts.push(festival.label)
    if (showType === 'comedy')  parts.push('Comedy')
    if (showType === 'festival') parts.push('Festivals')

    return `Browse: ${parts.join(' · ')}`
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

  // Capacity badge config — inline styles to avoid Tailwind purge
  const capBadgeStyle: Record<string, React.CSSProperties> = {
    'small (<500)':      isDark ? { background: 'rgba(168,85,247,0.2)', color: '#c4b5fd' } : { background: '#f3e8ff', color: '#7e22ce' },
    'medium (500-1.5k)': isDark ? { background: 'rgba(59,130,246,0.2)', color: '#93c5fd' } : { background: '#dbeafe', color: '#1d4ed8' },
    'large (1.5k-10k)':  isDark ? { background: 'rgba(249,115,22,0.2)', color: '#fdba74' } : { background: '#ffedd5', color: '#c2410c' },
    'x-large (10k+)':    isDark ? { background: 'rgba(244,63,94,0.2)',  color: '#fda4af' } : { background: '#ffe4e6', color: '#be123c' },
  }
  const capLabelMap: Record<string, string> = {
    'small (<500)':      'S',
    'medium (500-1.5k)': 'M',
    'large (1.5k-10k)':  'L',
    'x-large (10k+)':    'XL',
  }
  const showFestivalContext = showType === 'festival' || !!festival
  const thBase     = 'text-left text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-3'
  const thSortable = `${thBase} cursor-pointer hover:text-foreground transition-colors`
  const thCenter   = 'text-center text-xs font-medium text-muted-foreground uppercase tracking-wider py-3 px-4'

  const festivalBadgeClass = isDark
    ? 'inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-medium bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 hover:bg-fuchsia-500/30 transition whitespace-nowrap'
    : 'inline-flex items-center gap-0.5 px-1.5 py-px rounded text-[9px] font-medium bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-300 hover:bg-fuchsia-200 transition whitespace-nowrap'

  const festivalBadgeMobileClass = isDark
    ? 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/30 hover:bg-fuchsia-500/30 transition flex-shrink-0'
    : 'inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-300 hover:bg-fuchsia-200 transition flex-shrink-0'

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-4 md:mb-6">{pageTitle}</h1>

          {/* Stats mega card */}
          <div className="bg-card rounded-lg shadow-lg mb-4 md:mb-6">
            <div className="grid grid-cols-2 md:grid-cols-4">
              <div className="p-3 md:p-5 border-r border-b md:border-b-0 border-border">
                <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5 leading-tight uppercase tracking-wide">Shows</p>
                <p className="text-xl md:text-3xl font-bold text-foreground leading-tight">{stats.total_shows.toLocaleString()}</p>
              </div>
              <div className="p-3 md:p-5 border-b md:border-b-0 md:border-r border-border">
                <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5 leading-tight uppercase tracking-wide">Artists</p>
                <p className="text-xl md:text-3xl font-bold text-foreground leading-tight">{stats.unique_artists.toLocaleString()}</p>
              </div>
              <div className="p-3 md:p-5 border-r border-border">
                <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5 leading-tight uppercase tracking-wide">Venues</p>
                <p className="text-xl md:text-3xl font-bold text-foreground leading-tight">{stats.unique_venues.toLocaleString()}</p>
              </div>
              <div className="p-3 md:p-5">
                <p className="text-[10px] md:text-xs text-muted-foreground mb-0.5 leading-tight uppercase tracking-wide">Date Range</p>
                <p className="text-xl md:text-3xl font-bold text-foreground leading-tight">
                  {dateRangeDisplayMobile ?? '–'}
                </p>
              </div>
            </div>
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-6">
              {/* Unified search: Artists, Venues, Festivals — first and prominent */}
              <div className="col-span-2 md:col-span-1 relative" ref={browseSearchRef}>
                <label className="block text-sm font-medium text-foreground mb-2">Search</label>
                <div className="relative">
                  <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={browseSearchQuery}
                    onChange={e => {
                      setBrowseSearchQuery(e.target.value)
                      setBrowseSearchOpen(true)
                      if (!e.target.value.trim()) handleBrowseSearchClear()
                    }}
                    onFocus={() => setBrowseSearchOpen(true)}
                    placeholder="Artists, venues, festivals…"
                    className={`w-full pl-8 pr-7 py-1.5 md:py-2 text-sm text-foreground bg-card rounded-md focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${(artistId || venueId || festival) ? 'border-[1.5px] border-primary' : 'border border-border'}`}
                  />
                  {(browseSearchQuery || artistId || venueId || festival) && (
                    <button
                      onClick={handleBrowseSearchClear}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      title="Clear"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Results dropdown */}
                {browseSearchOpen && browseSearchQuery.trim().length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-card border border-border rounded-md shadow-xl max-h-72 overflow-y-auto">
                    {browseSearchLoading && (
                      <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
                        <div className="w-3 h-3 border-2 border-primary/30 border-t-primary rounded-full animate-spin flex-shrink-0" />
                        Searching…
                      </div>
                    )}

                    {!browseSearchLoading && browseArtistResults.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-teal-400 uppercase tracking-wider">Artists</div>
                        {browseArtistResults.map(a => (
                          <button
                            key={a.value}
                            onMouseDown={e => { e.preventDefault(); handleBrowseSearchSelect('artist', a.value as number, a.label) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{a.label}</span>
                            {(a as any).monthly_listeners && (
                              <span className="text-xs text-muted-foreground flex-shrink-0">
                                {(a as any).monthly_listeners >= 1_000_000
                                  ? `${((a as any).monthly_listeners / 1_000_000).toFixed(1)}M`
                                  : `${Math.round((a as any).monthly_listeners / 1000)}K`}
                              </span>
                            )}
                          </button>
                        ))}
                      </>
                    )}

                    {filteredVenueResults.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-teal-400 uppercase tracking-wider">Venues</div>
                        {filteredVenueResults.map(v => {
                          const loc = venueCityMap.get(v.venue_id)
                          return (
                            <button
                              key={v.venue_id}
                              onMouseDown={e => { e.preventDefault(); handleBrowseSearchSelect('venue', v.venue_id, v.venue_name) }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center justify-between gap-2"
                            >
                              <span className="truncate">{v.venue_name}</span>
                              {loc?.city && loc?.state && (
                                <span className="text-xs text-muted-foreground flex-shrink-0">{loc.city}, {loc.state}</span>
                              )}
                            </button>
                          )
                        })}
                      </>
                    )}

                    {filteredFestivalResults.length > 0 && (
                      <>
                        <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-teal-400 uppercase tracking-wider">Festivals</div>
                        {filteredFestivalResults.map(f => (
                          <button
                            key={f.value as string}
                            onMouseDown={e => { e.preventDefault(); handleBrowseSearchSelect('festival', f.value as string, f.label) }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                          >
                            {f.label}
                          </button>
                        ))}
                      </>
                    )}

                    {!browseSearchLoading && browseArtistResults.length === 0 && filteredVenueResults.length === 0 && filteredFestivalResults.length === 0 && (
                      <div className="px-3 py-3 text-sm text-muted-foreground">No results for "{browseSearchQuery}"</div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">Location</label>
                <select
                  value={province}
                  onChange={e => handleProvinceChange(e.target.value)}
                  className={`w-full px-3 py-1.5 md:py-2 text-sm text-foreground bg-card rounded-md focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${province ? 'border-[1.5px] border-primary' : 'border border-border'}`}
                >
                  <option value="">All Locations</option>
                  {Array.from(
                    availableLocations.reduce((acc, loc) => {
                      if (!acc.has(loc.country)) acc.set(loc.country, [])
                      acc.get(loc.country)!.push(loc.state)
                      return acc
                    }, new Map<string, string[]>())
                  ).map(([country, states]) => (
                    <optgroup key={country} label={COUNTRY_DISPLAY[country] ?? country}>
                      {states.map(s => (
                        <option key={s} value={s}>{PROVINCE_NAMES[s] ?? s}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

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
            </div>

            {/* Row 2: capacity + status pills + year jump inline */}
            <div className="mb-3">
              <div className="flex items-center gap-3 flex-wrap">
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

                <div className="flex rounded-lg border border-border overflow-hidden text-xs md:text-sm font-semibold">
                  {STATUS_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.key}
                      onClick={() => handleStatusClick(btn.key)}
                      className={`px-2 py-1.5 md:px-2.5 md:py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        status === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>

                {/* Year jump — sits immediately after status pill, same row */}
                {decade !== 'all' && (
                  <form onSubmit={handleYearJump} className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min="1900"
                      max="2099"
                      placeholder={`Year in ${decade}…`}
                      value={yearJumpInput}
                      onChange={e => setYearJumpInput(e.target.value)}
                      className="w-28 px-2.5 py-1.5 text-xs text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                    />
                    <button
                      type="submit"
                      className="text-xs px-2.5 py-1.5 rounded-md bg-muted text-muted-foreground hover:text-foreground border border-border transition-colors"
                    >
                      Go
                    </button>
                    {year && (
                      <button
                        type="button"
                        onClick={() => { setYear(undefined); setMonth(undefined); applyFilter({ year: undefined, month: undefined }) }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                      >
                        Clear year
                      </button>
                    )}
                  </form>
                )}
              </div>

              {/* Unknown capacity note — shown when filtering by a specific size */}
              {capacity && capacity !== 'all' && capacity !== 'unknown' && (
                <p className="mt-2 text-xs">
                  <button
                    onClick={() => handleCapacityClick('unknown')}
                    className="text-primary hover:underline transition-colors"
                  >
                    View {unknownCapacityCount != null ? unknownCapacityCount.toLocaleString() : '…'} shows with unknown capacity
                  </button>
                </p>
              )}
            </div>

            {/* Row 3: decade buttons */}
            <div className="overflow-x-auto -mx-3 px-3 md:-mx-4 md:px-4">
              <div className="flex gap-2 min-w-max">
                {DECADES.map(label => {
                  const decadeParam = decadeToParam(label)
                  const isActive = decade === decadeParam && !year
                  const isParent = !!year && decadeParam !== 'all' && decadeContainsYear(decadeParam, parseInt(year || '0'))
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

          {/* Shows Table — Discover-style card layout */}
          {!loading && (
            <div className="rounded-lg shadow-lg overflow-hidden">
              {/* Desktop header */}
              <div className="hidden md:grid bg-muted border-b border-border" style={{ gridTemplateColumns: `${user ? '48px ' : ''}110px 220px 175px 90px minmax(120px,1fr) 72px 76px`, columnGap: '8px' }}>
                {user && <div className="w-12" />}
                <button onClick={() => handleSort('date')} className={thSortable}>
                  Date {sortField === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
                <button onClick={() => handleSort('artist')} className={thSortable}>
                  Artist {sortField === 'artist' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
                <button onClick={() => handleSort('venue')} className={thSortable}>
                  Venue {sortField === 'venue' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
                <button onClick={() => handleSort('city')} className={thSortable}>
                  City {sortField === 'city' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
                <div className={thBase}>Tour / Festival</div>
                <div className={thCenter}>Tickets</div>
                <div className={thCenter}>Setlist</div>
              </div>

              {/* Mobile header */}
              <div className="md:hidden grid bg-muted px-2 py-2 border-b border-border" style={{ gridTemplateColumns: `${user ? '28px ' : ''}80px 1fr 56px` }}>
                {user && <div className="w-7" />}
                <button onClick={() => handleSort('date')} className="text-left text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-2 cursor-pointer hover:text-foreground transition-colors">
                  Date {sortField === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                </button>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-2">Artist / Venue</span>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider py-2 whitespace-nowrap">Tix/Set</span>
              </div>

              {shows.length === 0 && (
                <div className="text-center py-12 text-muted-foreground bg-card">
                  No shows found matching your filters.
                </div>
              )}

              <div className="bg-card divide-y divide-border">
                {shows.map(show => {
                  const isAdded   = userShows.has(show.show_id)
                  const isLoading = loadingShows.has(show.show_id)
                  const venueTooltip = show.other_names ? `Also known as: ${show.other_names}` : show.venue_name
                  const capKey = show.capacity_category?.toLowerCase() ?? null
                  const capLabel = capKey ? (capLabelMap[capKey] ?? null) : null
                  const capStyle = capKey ? (capBadgeStyle[capKey] ?? null) : null

                  const heartButton = (
                    <button onClick={() => toggleShow(show.show_id)} disabled={isLoading} className="focus:outline-none disabled:opacity-50 flex-shrink-0" title={isAdded ? 'Remove from My Shows' : 'Add to My Shows'}>
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
                        <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-4 h-4 dark:invert" />
                      </a>
                    : <span className="text-muted-foreground text-sm">–</span>

                  return (
                    <div key={show.show_id} className="hover:bg-muted/30 transition-colors">
                      {/* Desktop row */}
                      <div className="hidden md:grid items-center" style={{ gridTemplateColumns: `${user ? '48px ' : ''}110px 220px 175px 90px minmax(120px,1fr) 72px 76px`, columnGap: '8px' }}>
                        {user && <div className="w-12 flex items-center pl-3">{heartButton}</div>}

                        {/* Date */}
                        <div className="text-sm text-foreground whitespace-nowrap px-3 py-3">
                          {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>

                        {/* Artist */}
                        <div className="min-w-0 flex items-center gap-1.5 px-3 py-3">
                          <button
                            onClick={() => handleBrowseSearchSelect('artist', show.artist_id, show.artist_name)}
                            className="text-sm font-medium text-primary hover:opacity-80 hover:underline text-left truncate"
                            title={show.artist_name}
                          >
                            {show.artist_name}
                          </button>
                          {show.spotify_artist_id && (
                            <a
                              href={`https://open.spotify.com/artist/${show.spotify_artist_id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open in Spotify"
                              className="flex-shrink-0 hover:opacity-70 transition-opacity"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1DB954">
                                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                              </svg>
                            </a>
                          )}
                        </div>

                        {/* Venue */}
                        <div className="min-w-0 flex items-center gap-1.5 px-3 py-3">
                          <button
                            onClick={() => handleBrowseSearchSelect('venue', show.venue_id, show.venue_name)}
                            className="text-sm text-muted-foreground hover:text-primary hover:underline text-left truncate"
                            title={venueTooltip}
                          >
                            {show.venue_name}
                          </button>
                          {capLabel && capStyle && (
                            <span
                              style={capStyle}
                              className="inline-flex items-center px-1 py-px rounded text-[9px] font-bold flex-shrink-0 cursor-default"
                              title={show.capacity ? `${show.capacity.toLocaleString()} capacity` : undefined}
                            >
                              {capLabel}
                            </span>
                          )}
                        </div>

                        {/* City */}
                        <div className="flex items-center px-3 py-3">
                          {(() => {
                            const loc = venueCityMap.get(show.venue_id)
                            return loc?.city && loc?.state
                              ? <button
                                  onClick={() => handleProvinceChange(loc.state!)}
                                  className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors whitespace-nowrap text-left"
                                  title={`Filter: ${PROVINCE_NAMES[loc.state!] ?? loc.state}`}
                                >
                                  {loc.city}, {loc.state}
                                </button>
                              : <span className="text-sm text-muted-foreground">–</span>
                          })()}
                        </div>

                        {/* Tour / Festival */}
                        <div className="flex items-center px-3 py-3 min-w-0">
                          {show.tour_name
                            ? <span className="text-sm text-muted-foreground truncate" title={show.tour_name}>{show.tour_name}</span>
                            : show.festival_name
                              ? <button
                                  onClick={() => handleBrowseSearchSelect('festival', show.festival_name!, show.festival_name!)}
                                  className="text-sm text-muted-foreground hover:text-primary hover:underline transition-colors text-left truncate"
                                  title={`Filter by ${show.festival_name}`}
                                >
                                  {show.festival_name}
                                </button>
                              : null
                          }
                        </div>

                        {/* Tickets */}
                        <div className="flex items-center justify-center px-4 py-3">
                          {show.ticketmaster_url
                            ? <a href={show.ticketmaster_url} target="_blank" rel="noopener noreferrer" title="Buy tickets on Ticketmaster" className="hover:opacity-70 transition-opacity inline-flex items-center justify-center ml-1">
                                <img src="https://www.ticketmaster.ca/favicon.ico" alt="Ticketmaster" className="w-4 h-4" />
                              </a>
                            : <span className="text-muted-foreground text-sm ml-1">–</span>
                          }
                        </div>

                        {/* Setlist */}
                        <div className="flex items-center justify-center px-4 py-3">{setlistIcon}</div>
                      </div>

                      {/* Mobile row */}
                      <div className="md:hidden grid items-center px-2 py-2.5 gap-1.5" style={{ gridTemplateColumns: `${user ? '28px ' : ''}80px 1fr 56px` }}>
                        {user && <div className="w-7 flex items-center">{heartButton}</div>}
                        <div className="text-[11px] text-foreground whitespace-nowrap">
                          {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 mb-0.5">
                            <button
                              onClick={() => handleBrowseSearchSelect('artist', show.artist_id, show.artist_name)}
                              className="text-[11px] font-medium text-primary hover:opacity-80 hover:underline text-left truncate leading-snug"
                              title={show.artist_name}
                            >
                              {show.artist_name}
                            </button>
                            {show.spotify_artist_id && (
                              <a href={`https://open.spotify.com/artist/${show.spotify_artist_id}`} target="_blank" rel="noopener noreferrer" title="Open in Spotify" className="flex-shrink-0 hover:opacity-70">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="#1DB954">
                                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                                </svg>
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <button
                              onClick={() => handleBrowseSearchSelect('venue', show.venue_id, show.venue_name)}
                              className="text-[10px] text-muted-foreground hover:text-primary hover:underline text-left truncate leading-snug min-w-0"
                              title={venueTooltip}
                            >
                              {show.venue_name}
                            </button>
                            {capLabel && capStyle && (
                              <span
                                style={capStyle}
                                className="inline-flex items-center px-1 py-px rounded text-[8px] font-bold flex-shrink-0 cursor-default"
                                title={show.capacity ? `${show.capacity.toLocaleString()} capacity` : undefined}
                              >
                                {capLabel}
                              </span>
                            )}
                            {show.festival_name && (
                              <button
                                onClick={() => handleBrowseSearchSelect('festival', show.festival_name!, show.festival_name!)}
                                className={festivalBadgeMobileClass}
                                title={`Filter by ${show.festival_name}`}
                              >F</button>
                            )}
                          </div>
                          {(() => {
                            const loc = venueCityMap.get(show.venue_id)
                            return loc?.city && loc?.state
                              ? <span className="text-[9px] text-muted-foreground/60 leading-tight">{loc.city}, {loc.state}</span>
                              : null
                          })()}
                          {(show.tour_name || show.festival_name) && (
                            <span className="text-[9px] text-muted-foreground/50 leading-tight truncate" title={show.tour_name ?? show.festival_name ?? undefined}>
                              {show.tour_name ?? show.festival_name}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center justify-start gap-2">
                          {show.ticketmaster_url && (
                            <a href={show.ticketmaster_url} target="_blank" rel="noopener noreferrer" title="Buy tickets on Ticketmaster" className="hover:opacity-70 transition-opacity inline-flex items-center">
                              <img src="https://www.ticketmaster.ca/favicon.ico" alt="Ticketmaster" className="w-3.5 h-3.5" />
                            </a>
                          )}
                          {setlistIcon}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
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
