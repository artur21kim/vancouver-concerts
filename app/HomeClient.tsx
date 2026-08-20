'use client'

import dynamic from 'next/dynamic'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import type { TopArtist, TopVenue, CityStats, HomeStats } from './page'
import CountryFlag from './components/CountryFlag'
import AuthModal from './components/AuthModal'


const ProvinceMap = dynamic(() => import('./ProvinceMap'), { ssr: false })

// ── Types ─────────────────────────────────────────────────────
type CapacityBucket = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type CapacityFilter = 'all' | CapacityBucket
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

// ── Province/state full names ─────────────────────────────────
const STATE_NAMES: Record<string, string> = {
  // Canadian provinces & territories
  BC: 'British Columbia', ON: 'Ontario',       QC: 'Quebec',          AB: 'Alberta',
  MB: 'Manitoba',         SK: 'Saskatchewan',  NS: 'Nova Scotia',     NB: 'New Brunswick',
  NL: 'Newfoundland & Labrador', PE: 'Prince Edward Island',
  NT: 'Northwest Territories',   YT: 'Yukon',                         NU: 'Nunavut',
  // US states — full set to prevent abbreviated labels as city coverage expands
  WA: 'Washington',    OR: 'Oregon',      CA: 'California',    NY: 'New York',
  IL: 'Illinois',      TX: 'Texas',       FL: 'Florida',       MI: 'Michigan',
  CO: 'Colorado',      OH: 'Ohio',        PA: 'Pennsylvania',  GA: 'Georgia',
  TN: 'Tennessee',     MA: 'Massachusetts', NV: 'Nevada',      AZ: 'Arizona',
  MN: 'Minnesota',     NC: 'North Carolina', MO: 'Missouri',   WI: 'Wisconsin',
  OK: 'Oklahoma',      KY: 'Kentucky',    IN: 'Indiana',       AL: 'Alabama',
  LA: 'Louisiana',     SC: 'South Carolina', MD: 'Maryland',   DC: 'Washington D.C.',
  IA: 'Iowa',          NE: 'Nebraska',    ID: 'Idaho',         UT: 'Utah',
  NM: 'New Mexico',    VA: 'Virginia',    WV: 'West Virginia', KS: 'Kansas',
  AR: 'Arkansas',      MS: 'Mississippi', ND: 'North Dakota',  SD: 'South Dakota',
  MT: 'Montana',       WY: 'Wyoming',     NJ: 'New Jersey',    CT: 'Connecticut',
  RI: 'Rhode Island',  NH: 'New Hampshire', VT: 'Vermont',     ME: 'Maine',
  DE: 'Delaware',      HI: 'Hawaii',      AK: 'Alaska',
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
  initialArtists,
  initialVenues,
  initialCityStats,
}: {
  initialStats:     HomeStats
  initialArtists:   TopArtist[]
  initialVenues:    TopVenue[]
  initialCityStats: CityStats[]
}) {
  const router = useRouter()
  const { user } = useAuth()
  const [mounted, setMounted] = useState(false)

  // ── View state ────────────────────────────────────────────
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [cityStatsData,    setCityStatsData]    = useState<CityStats[]>(
    () => initialCityStats.map(c => ({ ...c, country: normalizeCountry(c.country) }))
  )
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues,  setShowAllVenues]  = useState(false)
  const [showAllCities,  setShowAllCities]  = useState(false)

  // ── GP-132/133: city stats + expand state ─────────────────
  const [expandedProvinces, setExpandedProvinces] = useState<Set<string>>(new Set())
  const [selectedState,     setSelectedState]     = useState<string | null>(null)
  const [stateArtists,      setStateArtists]      = useState<TopArtist[] | null>(null)
  const [stateVenues,       setStateVenues]       = useState<TopVenue[]  | null>(null)
  const [stateLoading,      setStateLoading]      = useState(false)
  const stateDrillCache = useRef<Record<string, { artists: TopArtist[]; venues: TopVenue[] }>>({})
  // ── Drill-down data state ─────────────────────────────────

  const [artists,     setArtists]     = useState<TopArtist[]>(initialArtists)
  const [venues,      setVenues]      = useState<TopVenue[]>(initialVenues)



  useEffect(() => { setMounted(true) }, [])

  // Fetch state-specific artists/venues on drill-down; cache results for instant re-visits
  useEffect(() => {
    setShowAllArtists(false)
    setShowAllVenues(false)
    setShowAllCities(false)

    if (!selectedState) {
      setStateArtists(null)
      setStateVenues(null)
      setStateLoading(false)
      return
    }

    // Return cached result immediately — no spinner, no network request
    const cached = stateDrillCache.current[selectedState]
    if (cached) {
      setStateArtists(cached.artists)
      setStateVenues(cached.venues)
      return
    }

    const controller = new AbortController()
    setStateArtists(null)
    setStateVenues(null)
    setStateLoading(true)
    fetch(`/api/home/state-drill?state=${encodeURIComponent(selectedState)}`, {
      signal: controller.signal,
    })
      .then(r => r.json())
      .then(data => {
        const artists = data.artists ?? []
        const venues  = data.venues  ?? []
        stateDrillCache.current[selectedState] = { artists, venues }
        setStateArtists(artists)
        setStateVenues(venues)
      })
      .catch(e => { if (e.name !== 'AbortError') console.error('[HomeClient] state-drill error:', e) })
      .finally(() => setStateLoading(false))

    // Cancel request if selectedState changes before fetch completes
    return () => controller.abort()
  }, [selectedState])

  // ── City stats fallback: re-fetch if ISR cache served stale data (empty or missing coords) ──
  useEffect(() => {
    const hasCoords = initialCityStats.some(c => c.latitude != null)
    if (initialCityStats.length === 0 || !hasCoords) {
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
  // ── ISR fallback: refetch artists/venues if server cache was stale ──
  useEffect(() => {
    if (initialArtists.length === 0 || initialVenues.length === 0) {
      fetch('/api/home/drill')
        .then(r => r.json())
        .then(data => {
          if (data.artists?.length) setArtists(data.artists)
          if (data.venues?.length)  setVenues(data.venues)
        })
        .catch(e => console.error('ISR fallback error:', e))
    }
  }, [initialArtists.length, initialVenues.length])

  const hasActiveFilter = capacityFilter !== 'all'

  // ── Province map CTA ─────────────────────────────────────
  const handleProvinceCta = useCallback(() => {
    if (user) {
      router.push('/discover')
    } else {
      setShowAuthModal(true)
    }
  }, [user, router])

  // ── Clear all ─────────────────────────────────────────────
  const handleClearAll = useCallback(() => {
    setCapacityFilter('all')
  }, [])

  // ── GP-132: province/state expand toggle ─────────────────
  const toggleProvince = useCallback((state: string) => {
    setExpandedProvinces(prev => {
      const next = new Set(prev)
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return next
    })
  }, [])



  // ── Filtered venues (capacity applied client-side) ────────
  const filteredVenues = useMemo(
    () => filterVenues(venues, capacityFilter),
    [venues, capacityFilter]
  )

  // ── GP-159: State-filtered derived data (client-side from map drill-down) ──
  const displayedArtists = useMemo(() => {
    if (!selectedState) return artists
    return stateArtists ?? []
  }, [artists, selectedState, stateArtists])

  const stateFilteredVenues = useMemo(() => {
    if (!selectedState) return filteredVenues
    if (stateVenues === null) return []
    return filterVenues(stateVenues, capacityFilter)
  }, [filteredVenues, selectedState, stateVenues, capacityFilter])

  const displayedCities = useMemo(() => {
    if (!selectedState) return cityStatsData
    return cityStatsData.filter(c => c.state === selectedState)
  }, [cityStatsData, selectedState])

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
  const stats = useMemo(() => ({
    totalShows:    initialStats.total_shows,
    uniqueArtists: initialStats.unique_artists,
    uniqueVenues:  initialStats.unique_venues,
    fourthCard:    { label: 'Date Range', value: '1900–2026' },
  }), [initialStats])

  // ── Filter context label ──────────────────────────────────
  const filterContext = useMemo(() => {
    const parts: string[] = []
    if (selectedState)         parts.push(STATE_NAMES[selectedState] ?? selectedState)
    if (capacityFilter !== 'all') parts.push(`${CAPACITY_DISPLAY_NAMES[capacityFilter as CapacityBucket]} Venues`)
    return parts.length > 0 ? parts.join(' · ') : null
  }, [capacityFilter, selectedState])

  // ── Render ────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-background py-4 md:py-6 px-4">
      <div className="max-w-7xl mx-auto">

        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2 md:gap-3 mb-3 md:mb-4">
          <StatCard label="Shows"      value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists"    value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues"     value={stats.uniqueVenues.toLocaleString()} />
          <StatCard label="Date Range" value={stats.fourthCard.value} compact />
        </div>
        {/* ── Province bubble map ────────────────────────────────── */}
        <div className="bg-card rounded-lg shadow-lg overflow-hidden mb-3 md:mb-4 h-[500px] md:h-[580px]">
          <ProvinceMap
            provinces={provinceStats}
            isAuthenticated={!!user}
            onCtaClick={handleProvinceCta}
            selectedState={selectedState}
            onStateChange={setSelectedState}
          />
        </div>

        {/* Filters */}
        <div className="bg-card rounded-lg shadow-lg p-3 md:p-4 mb-3 md:mb-4">
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
            {hasActiveFilter && (
              <button
                onClick={handleClearAll}
                className="text-xs border border-destructive text-destructive rounded px-2 py-1.5 hover:bg-destructive/10 transition-colors whitespace-nowrap"
              >
                Clear All
              </button>
            )}
          </div>
        </div>

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
            {(loading || stateLoading) ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : displayedArtists.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {displayedArtists.slice(0, showAllArtists ? 25 : 10).map((artist, index) => (
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {displayedArtists.length > 10 && (
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
            {(loading || stateLoading) ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : stateFilteredVenues.length > 0 ? (
              <>
                <div className="space-y-2 md:space-y-3">
                  {stateFilteredVenues.slice(0, showAllVenues ? 25 : 10).map((venue, index) => (
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
                {stateFilteredVenues.length > 10 && (
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
                {displayedCities.slice(0, showAllCities ? 25 : 10).map((city, idx) => {
                  const maxCount = Number(displayedCities[0]?.show_count ?? 1)
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
              {displayedCities.length > 10 && (
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
                        className={`w-full flex items-center justify-between py-1.5 rounded px-1 transition-colors${prov.state === selectedState ? ' ring-1 ring-primary' : ''}`}
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

      {/* ── Auth modal (triggered from province map CTA) ── */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        returnPath="/discover"
      />

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
