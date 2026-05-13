'use client'

import Navigation from '../components/Navigation'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from 'recharts'

// ── Types ─────────────────────────────────────────────────────────────────────
type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  show_type: string | null
  festival_name: string | null
  added_at: string
  notes: string | null
  source: string | null
  artist: {
    artist_id: number
    artist_name: string
    monthly_listeners: number | null
    spotify_artist_id: string | null
  }
  venue: {
    venue_id: number
    venue_name: string
    capacity: number | null
    capacity_category: string | null
  }
}

type SortField = 'date' | 'artist' | 'venue' | 'added_at'
type SortDirection = 'asc' | 'desc'
type TimelineScope = 'past' | 'upcoming' | 'all'
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'

// ── Constants ─────────────────────────────────────────────────────────────────
const TEAL_PAST   = '#0d9488'   // darker teal for past shows
const AMBER_FUTURE = '#f59e0b'  // amber for upcoming

const CAPACITY_META: Record<string, {
  key: CapacityFilter
  label: string
  shortLabel: string
  color: string
  textColor: string
  badgeBg: string
  badgeText: string
}> = {
  'small (<500)':      { key: 'small',   label: 'Small (<500)',      shortLabel: 'S',  color: '#8B5CF6', textColor: 'text-purple-400 dark:text-purple-300',  badgeBg: 'bg-purple-500/20', badgeText: 'text-purple-300' },
  'medium (500-1.5k)': { key: 'medium',  label: 'Medium (500–1.5K)', shortLabel: 'M',  color: '#3A8FBD', textColor: 'text-[#3A8FBD]',                        badgeBg: 'bg-blue-500/20',   badgeText: 'text-[#3A8FBD]'  },
  'large (1.5k-10k)':  { key: 'large',   label: 'Large (1.5K–10K)',  shortLabel: 'L',  color: '#F97316', textColor: 'text-orange-500',                        badgeBg: 'bg-orange-500/20', badgeText: 'text-orange-400' },
  'x-large (10k+)':    { key: 'xlarge',  label: 'X-Large (10K+)',    shortLabel: 'XL', color: '#F43F5E', textColor: 'text-rose-500',                          badgeBg: 'bg-rose-500/20',   badgeText: 'text-rose-400'   },
}

const CAPACITY_BUTTONS: { key: CapacityFilter; label: string; tooltip: string; unselectedClass: string }[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        unselectedClass: 'text-muted-foreground'              },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     unselectedClass: 'text-purple-400 dark:text-purple-300' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', unselectedClass: 'text-[#3A8FBD]'                       },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  unselectedClass: 'text-orange-500'                      },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    unselectedClass: 'text-rose-500'                         },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  unselectedClass: 'text-gray-400 dark:text-gray-500'      },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCapacityMeta(category: string | null) {
  if (!category) return null
  return CAPACITY_META[category.toLowerCase()] ?? null
}

function isFutureShow(date: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return new Date(date + 'T12:00:00') >= today
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow border border-border p-3 md:p-4">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className="text-lg md:text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}

function CapacityBadge({ category }: { category: string | null }) {
  const meta = getCapacityMeta(category)
  if (!meta) return null
  return (
    <span className={`inline-flex items-center px-1 py-px rounded text-[9px] font-bold flex-shrink-0 ${meta.badgeBg} ${meta.badgeText}`}>
      {meta.shortLabel}
    </span>
  )
}

function SpotifyIcon({ artistId }: { artistId: string }) {
  return (
    <a
      href={`https://open.spotify.com/artist/${artistId}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Spotify"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity inline-flex items-center"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    </a>
  )
}

// ── Custom tooltip for timeline ───────────────────────────────────────────────
function TimelineTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const count = payload[0]?.value ?? 0
  const isFuture = payload[0]?.payload?.isFuture
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      <p className={isFuture ? 'text-amber-400' : 'text-primary'}>
        {count} {count === 1 ? 'show' : 'shows'}
      </p>
    </div>
  )
}

// ── Custom tooltip for donut ──────────────────────────────────────────────────
function DonutTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const { name, value } = payload[0]
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{name}</p>
      <p className="text-muted-foreground">{value} {value === 1 ? 'show' : 'shows'}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyShowsClient({ shows: initialShows }: { shows: Show[] }) {
  const router = useRouter()
  const [shows, setShows] = useState(initialShows)
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [removingShows, setRemovingShows] = useState<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [timelineScope, setTimelineScope] = useState<TimelineScope>('all')
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues, setShowAllVenues] = useState(false)
  const showsPerPage = 50

  const today = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])

  // ── Derived data ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalShows    = shows.length
    const uniqueArtists = new Set(shows.map(s => s.artist.artist_id)).size
    const uniqueVenues  = new Set(shows.map(s => s.venue.venue_id)).size
    const pastShows     = shows.filter(s => !isFutureShow(s.date))
    const futureShows   = shows.filter(s => isFutureShow(s.date))
    const sortedByDate  = [...shows].sort((a, b) => a.date.localeCompare(b.date))
    const firstShow     = pastShows.length > 0
      ? [...pastShows].sort((a, b) => a.date.localeCompare(b.date))[0]
      : null
    const lastShow      = pastShows.length > 0
      ? [...pastShows].sort((a, b) => b.date.localeCompare(a.date))[0]
      : null
    return { totalShows, uniqueArtists, uniqueVenues, pastShows, futureShows, firstShow, lastShow, sortedByDate }
  }, [shows])

  // ── Timeline data ─────────────────────────────────────────────────────────
  const timelineData = useMemo(() => {
    const filtered = timelineScope === 'past'
      ? shows.filter(s => !isFutureShow(s.date))
      : timelineScope === 'upcoming'
      ? shows.filter(s => isFutureShow(s.date))
      : shows

    const byYear: Record<string, { past: number; future: number }> = {}
    for (const s of filtered) {
      const year = s.date.split('-')[0]
      if (!byYear[year]) byYear[year] = { past: 0, future: 0 }
      if (isFutureShow(s.date)) byYear[year].future++
      else byYear[year].past++
    }

    return Object.entries(byYear)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, counts]) => ({
        year,
        count: counts.past + counts.future,
        past: counts.past,
        future: counts.future,
        isFuture: counts.future > 0 && counts.past === 0,
      }))
  }, [shows, timelineScope])

  const firstShowYear = stats.firstShow?.date.split('-')[0]
  const lastShowYear  = stats.lastShow?.date.split('-')[0]

  // ── Top artists / venues ──────────────────────────────────────────────────
  const topArtists = useMemo(() => {
    const counts: Record<number, { name: string; count: number; spotifyId: string | null }> = {}
    for (const s of shows) {
      const id = s.artist.artist_id
      if (!counts[id]) counts[id] = { name: s.artist.artist_name, count: 0, spotifyId: s.artist.spotify_artist_id }
      counts[id].count++
    }
    return Object.values(counts).sort((a, b) => b.count - a.count)
  }, [shows])

  const topVenues = useMemo(() => {
    const counts: Record<number, { id: number; name: string; count: number; category: string | null }> = {}
    for (const s of shows) {
      const id = s.venue.venue_id
      if (!counts[id]) counts[id] = { id, name: s.venue.venue_name, count: 0, category: s.venue.capacity_category }
      counts[id].count++
    }
    return Object.values(counts).sort((a, b) => b.count - a.count)
  }, [shows])

  // ── Donut data ────────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0, xlarge: 0, unknown: 0 }
    for (const s of shows) {
      const cat = s.venue.capacity_category?.toLowerCase() ?? ''
      if      (cat === 'small (<500)')      counts.small++
      else if (cat === 'medium (500-1.5k)') counts.medium++
      else if (cat === 'large (1.5k-10k)')  counts.large++
      else if (cat === 'x-large (10k+)')    counts.xlarge++
      else                                  counts.unknown++
    }
    const entries = [
      { name: 'Small (<500)',      value: counts.small,   key: 'small',   color: '#8B5CF6' },
      { name: 'Medium (500–1.5K)', value: counts.medium,  key: 'medium',  color: '#3A8FBD' },
      { name: 'Large (1.5K–10K)',  value: counts.large,   key: 'large',   color: '#F97316' },
      { name: 'X-Large (10K+)',    value: counts.xlarge,  key: 'xlarge',  color: '#F43F5E' },
      { name: 'Unknown',           value: counts.unknown, key: 'unknown', color: '#6B7280' },
    ]
    return entries.filter(e => e.value > 0)
  }, [shows])

  // ── Filtered + sorted show list ───────────────────────────────────────────
  const filteredShows = useMemo(() => {
    return shows.filter(s => {
      if (capacityFilter === 'all') return true
      const cat = s.venue.capacity_category?.toLowerCase() ?? ''
      if (capacityFilter === 'unknown') return !cat || !Object.keys(CAPACITY_META).includes(cat)
      return getCapacityMeta(s.venue.capacity_category)?.key === capacityFilter
    })
  }, [shows, capacityFilter])

  const sortedShows = useMemo(() => {
    return [...filteredShows].sort((a, b) => {
      let aVal: any, bVal: any
      switch (sortField) {
        case 'date':     aVal = a.date;                     bVal = b.date;                     break
        case 'artist':   aVal = a.artist.artist_name.toLowerCase(); bVal = b.artist.artist_name.toLowerCase(); break
        case 'venue':    aVal = a.venue.venue_name.toLowerCase();   bVal = b.venue.venue_name.toLowerCase();   break
        case 'added_at': aVal = a.added_at;                bVal = b.added_at;                 break
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ?  1 : -1
      return 0
    })
  }, [filteredShows, sortField, sortDirection])

  const totalPages   = Math.ceil(sortedShows.length / showsPerPage)
  const currentShows = sortedShows.slice((currentPage - 1) * showsPerPage, currentPage * showsPerPage)

  // ── Actions ───────────────────────────────────────────────────────────────
  const removeShow = async (showId: number) => {
    setRemovingShows(prev => new Set(prev).add(showId))
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_shows').delete().eq('user_id', user.id).eq('show_id', showId)
      setShows(shows.filter(s => s.show_id !== showId))
    } catch { console.error('Error removing show') }
    finally {
      setRemovingShows(prev => { const s = new Set(prev); s.delete(showId); return s })
    }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDirection(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDirection('asc') }
    setCurrentPage(1); setPageInput('1')
  }

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return
    setCurrentPage(p); setPageInput(String(p))
  }

  const handlePageSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const p = parseInt(pageInput)
    if (!isNaN(p) && p >= 1 && p <= totalPages) setCurrentPage(p)
    else setPageInput(String(currentPage))
  }

  const handleCapacityClick = (key: CapacityFilter) => {
    setCapacityFilter(key === capacityFilter ? 'all' : key)
    setCurrentPage(1); setPageInput('1')
  }

  const handleDonutClick = (data: any) => {
    const key = data?.activePayload?.[0]?.payload?.key as CapacityFilter | undefined
    if (!key) return
    setCapacityFilter(prev => prev === key ? 'all' : key)
    setCurrentPage(1); setPageInput('1')
  }

  // ── Sort indicator ────────────────────────────────────────────────────────
  const sortArrow = (field: SortField) =>
    sortField === field ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''

  // ── Custom bar shape: colour each bar individually ────────────────────────
  const TimelineBar = (props: any) => {
    const { x, y, width, height, payload } = props
    const past   = payload?.past   ?? 0
    const future = payload?.future ?? 0
    const total  = past + future
    if (total === 0 || height <= 0) return null

    const pastH   = total > 0 ? (past / total)   * height : 0
    const futureH = total > 0 ? (future / total) * height : 0

    // first show / last show markers
    const isFirst = payload?.year === firstShowYear
    const isLast  = payload?.year === lastShowYear && lastShowYear !== firstShowYear

    return (
      <g>
        {/* future segment (bottom if mixed, otherwise full) */}
        {future > 0 && (
          <rect x={x} y={y + pastH} width={width} height={futureH}
            fill={AMBER_FUTURE} rx={future > 0 && past === 0 ? 3 : 0} />
        )}
        {/* past segment (top) */}
        {past > 0 && (
          <rect x={x} y={y} width={width} height={pastH}
            fill={TEAL_PAST} rx={3} />
        )}
        {/* first show dot */}
        {isFirst && (
          <circle cx={x + width / 2} cy={y - 8} r={4} fill={TEAL_PAST} />
        )}
        {/* last show dot */}
        {isLast && (
          <circle cx={x + width / 2} cy={y - 8} r={4} fill={TEAL_PAST} stroke="var(--background)" strokeWidth={1.5} />
        )}
      </g>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-6 md:py-8 px-4">
        <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">

          {/* Header */}
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">My Shows</h1>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <StatCard label="Shows"   value={stats.totalShows.toLocaleString()} />
            <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
            <StatCard label="Venues"  value={stats.uniqueVenues.toLocaleString()} />
          </div>

          {/* ── Concert Timeline ── */}
          {timelineData.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-lg md:text-xl font-bold text-foreground">Concert Timeline</h2>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  {(['all', 'past', 'upcoming'] as TimelineScope[]).map((s, i) => (
                    <button
                      key={s}
                      onClick={() => setTimelineScope(s)}
                      className={`px-3 py-1.5 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        timelineScope === s ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {s === 'upcoming' ? 'Upcoming' : s === 'past' ? 'Past' : 'All'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
                {stats.pastShows.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: TEAL_PAST }} />
                    Past shows
                  </span>
                )}
                {stats.futureShows.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: AMBER_FUTURE }} />
                    Upcoming shows
                  </span>
                )}
                {firstShowYear && (
                  <span className="flex items-center gap-1.5">
                    <svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill={TEAL_PAST}/></svg>
                    First / last show
                  </span>
                )}
              </div>

              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timelineData} margin={{ top: 16, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%">
                    <XAxis dataKey="year" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<TimelineTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
                    <Bar dataKey="count" shape={<TimelineBar />} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* First / Last show callout */}
              {(stats.firstShow || stats.lastShow) && (
                <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                  {stats.firstShow && (
                    <span>
                      First show: <span className="text-foreground font-medium">{stats.firstShow.artist.artist_name}</span>
                      {' '}at <span className="text-primary">{stats.firstShow.venue.venue_name}</span>
                      {' '}· {formatDate(stats.firstShow.date)}
                    </span>
                  )}
                  {stats.lastShow && (
                    <>
                      <span className="text-border select-none">·</span>
                      <span>
                        Last show: <span className="text-foreground font-medium">{stats.lastShow.artist.artist_name}</span>
                        {' '}at <span className="text-primary">{stats.lastShow.venue.venue_name}</span>
                        {' '}· {formatDate(stats.lastShow.date)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Top Artists + Top Venues ── */}
          {shows.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Top Artists */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
                <h2 className="text-lg font-bold text-foreground mb-3">Top Artists</h2>
                <div className="space-y-2">
                  {topArtists.slice(0, showAllArtists ? undefined : 5).map((artist, i) => (
                    <div key={artist.name} className="flex items-center gap-2 py-0.5">
                      <span className="text-sm font-semibold text-muted-foreground w-5 flex-shrink-0">{i + 1}</span>
                      <button
                        onClick={() => router.push(`/browse?artist=${encodeURIComponent(artist.name)}`)}
                        className="text-sm text-primary hover:opacity-80 hover:underline text-left truncate flex-1"
                      >
                        {artist.name}
                      </button>
                      {artist.spotifyId && <SpotifyIcon artistId={artist.spotifyId} />}
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {artist.count} {artist.count === 1 ? 'show' : 'shows'}
                      </span>
                    </div>
                  ))}
                </div>
                {topArtists.length > 5 && (
                  <button
                    onClick={() => setShowAllArtists(v => !v)}
                    className="mt-3 text-xs text-primary hover:opacity-80 font-medium"
                  >
                    {showAllArtists ? '← Show less' : `View all ${topArtists.length} artists →`}
                  </button>
                )}
              </div>

              {/* Top Venues */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
                <h2 className="text-lg font-bold text-foreground mb-3">Top Venues</h2>
                <div className="space-y-2">
                  {topVenues.slice(0, showAllVenues ? undefined : 5).map((venue, i) => (
                    <div key={venue.name} className="flex items-center gap-2 py-0.5">
                      <span className="text-sm font-semibold text-muted-foreground w-5 flex-shrink-0">{i + 1}</span>
                      <button
                        onClick={() => router.push(`/browse?venue_id=${venue.id}`)}
                        className="text-sm text-primary hover:opacity-80 hover:underline text-left truncate flex-1"
                      >
                        {venue.name}
                      </button>
                      <CapacityBadge category={venue.category} />
                      <span className="text-xs text-muted-foreground flex-shrink-0">
                        {venue.count} {venue.count === 1 ? 'show' : 'shows'}
                      </span>
                    </div>
                  ))}
                </div>
                {topVenues.length > 5 && (
                  <button
                    onClick={() => setShowAllVenues(v => !v)}
                    className="mt-3 text-xs text-primary hover:opacity-80 font-medium"
                  >
                    {showAllVenues ? '← Show less' : `View all ${topVenues.length} venues →`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Donut + Capacity filter ── */}
          {donutData.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">Shows by Venue Size</h2>
                {/* Capacity pill filter */}
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  {CAPACITY_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.key}
                      title={btn.tooltip}
                      onClick={() => handleCapacityClick(btn.key)}
                      className={`px-2.5 py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        capacityFilter === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : `bg-card ${btn.unselectedClass} hover:bg-muted`
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-6">
                <div style={{ height: 200, width: '100%', maxWidth: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart onClick={handleDonutClick} style={{ cursor: 'pointer' }}>
                      <Pie
                        data={donutData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={85}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {donutData.map((entry) => (
                          <Cell
                            key={entry.key}
                            fill={entry.color}
                            opacity={capacityFilter === 'all' || capacityFilter === entry.key ? 1 : 0.3}
                          />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend */}
                <div className="flex flex-col gap-2 flex-1">
                  {donutData.map(entry => {
                    const pct = Math.round((entry.value / shows.length) * 100)
                    const isActive = capacityFilter === 'all' || capacityFilter === entry.key
                    return (
                      <button
                        key={entry.key}
                        onClick={() => handleCapacityClick(entry.key as CapacityFilter)}
                        className={`flex items-center gap-2.5 text-left transition-opacity ${isActive ? '' : 'opacity-40'}`}
                      >
                        <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                        <span className="text-sm text-foreground flex-1">{entry.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{entry.value} shows</span>
                        <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {capacityFilter !== 'all' && (
                <p className="text-xs text-muted-foreground mt-3">
                  Showing {filteredShows.length} of {shows.length} shows ·{' '}
                  <button onClick={() => { setCapacityFilter('all'); setCurrentPage(1) }} className="text-primary hover:underline">
                    Clear filter
                  </button>
                </p>
              )}
            </div>
          )}

          {/* ── Show list ── */}
          {shows.length === 0 ? (
            <div className="bg-card rounded-lg shadow border border-border p-12 text-center">
              <p className="text-muted-foreground text-lg mb-4">No shows added yet.</p>
              <button
                onClick={() => router.push('/browse')}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 font-medium transition-opacity"
              >
                Browse Shows
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-lg shadow border border-border overflow-hidden">

              {/* Table header label + count */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <h2 className="text-base font-semibold text-foreground">
                  All Shows
                  {capacityFilter !== 'all' && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({filteredShows.length} filtered)
                    </span>
                  )}
                </h2>
                {sortedShows.length > 0 && (
                  <span className="text-xs text-muted-foreground">{sortedShows.length.toLocaleString()} shows</span>
                )}
              </div>

              {/* Desktop header */}
              <div className="hidden md:grid bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                style={{ gridTemplateColumns: '40px 120px 1fr 1fr 140px 60px 60px' }}>
                <div className="px-3 py-3" />
                <button className="px-3 py-3 text-left hover:text-foreground transition-colors" onClick={() => handleSort('date')}>
                  Date{sortArrow('date')}
                </button>
                <button className="px-3 py-3 text-left hover:text-foreground transition-colors" onClick={() => handleSort('artist')}>
                  Artist{sortArrow('artist')}
                </button>
                <button className="px-3 py-3 text-left hover:text-foreground transition-colors" onClick={() => handleSort('venue')}>
                  Venue{sortArrow('venue')}
                </button>
                <div className="px-3 py-3">Festival</div>
                <div className="px-3 py-3 text-center">Setlist</div>
                <div className="px-3 py-3 text-center">Spotify</div>
              </div>

              {/* Mobile header */}
              <div className="md:hidden grid bg-muted border-b border-border px-3 py-2.5"
                style={{ gridTemplateColumns: '28px 80px 1fr 48px' }}>
                <div />
                <button className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground" onClick={() => handleSort('date')}>
                  Date{sortArrow('date')}
                </button>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Artist / Venue
                </span>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Links</span>
              </div>

              {filteredShows.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No shows match this filter.</div>
              ) : (
                <div className="divide-y divide-border">
                  {currentShows.map(show => {
                    const isRemoving = removingShows.has(show.show_id)
                    const isFuture   = isFutureShow(show.date)

                    return (
                      <div key={show.show_id} className={`hover:bg-muted/30 transition-colors ${isFuture ? 'bg-amber-500/5' : ''}`}>

                        {/* Desktop row */}
                        <div className="hidden md:grid items-center"
                          style={{ gridTemplateColumns: '40px 120px 1fr 1fr 140px 60px 60px' }}>

                          {/* Remove button */}
                          <div className="px-3 py-3 flex items-center">
                            <button
                              onClick={() => removeShow(show.show_id)}
                              disabled={isRemoving}
                              title="Remove from My Shows"
                              className="focus:outline-none disabled:opacity-50"
                            >
                              {isRemoving
                                ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                : <svg className="w-5 h-5 fill-destructive text-destructive hover:opacity-70 transition-opacity" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                  </svg>
                              }
                            </button>
                          </div>

                          {/* Date */}
                          <div className="px-3 py-3 text-sm text-foreground whitespace-nowrap">
                            <span>{formatDate(show.date)}</span>
                            {isFuture && <span className="ml-1.5 text-[9px] font-semibold text-amber-400 bg-amber-400/15 px-1 py-px rounded">upcoming</span>}
                          </div>

                          {/* Artist */}
                          <div className="px-3 py-3 min-w-0 flex items-center gap-1.5">
                            <button
                              onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                              className="text-sm font-medium text-primary hover:opacity-80 hover:underline text-left truncate"
                            >
                              {show.artist.artist_name}
                            </button>
                            {show.artist.spotify_artist_id && <SpotifyIcon artistId={show.artist.spotify_artist_id} />}
                          </div>

                          {/* Venue */}
                          <div className="px-3 py-3 min-w-0 flex items-center gap-1.5">
                            <button
                              onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                              className="text-sm text-muted-foreground hover:text-primary hover:underline text-left truncate"
                            >
                              {show.venue.venue_name}
                            </button>
                            <CapacityBadge category={show.venue.capacity_category} />
                          </div>

                          {/* Festival */}
                          <div className="px-3 py-3 text-sm text-muted-foreground truncate">
                            {show.festival_name || <span className="text-muted-foreground/40">—</span>}
                          </div>

                          {/* Setlist */}
                          <div className="px-3 py-3 flex items-center justify-center">
                            {show.setlist_url
                              ? <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" title="View on setlist.fm" className="hover:opacity-70 transition-opacity">
                                  <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-4 h-4 dark:invert" />
                                </a>
                              : <span className="text-muted-foreground/40 text-sm">—</span>
                            }
                          </div>

                          {/* Spotify */}
                          <div className="px-3 py-3 flex items-center justify-center">
                            {show.artist.spotify_artist_id
                              ? <SpotifyIcon artistId={show.artist.spotify_artist_id} />
                              : <span className="text-muted-foreground/40 text-sm">—</span>
                            }
                          </div>
                        </div>

                        {/* Mobile row */}
                        <div className="md:hidden grid items-center px-3 py-2.5 gap-1"
                          style={{ gridTemplateColumns: '28px 80px 1fr 48px' }}>
                          {/* Remove */}
                          <div className="flex items-center">
                            <button onClick={() => removeShow(show.show_id)} disabled={isRemoving} className="focus:outline-none disabled:opacity-50">
                              {isRemoving
                                ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                : <svg className="w-4 h-4 fill-destructive text-destructive" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                  </svg>
                              }
                            </button>
                          </div>
                          {/* Date */}
                          <div>
                            <span className="text-[11px] text-foreground whitespace-nowrap">{formatDate(show.date)}</span>
                            {isFuture && <div className="text-[9px] font-semibold text-amber-400">upcoming</div>}
                          </div>
                          {/* Artist + Venue */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1 mb-0.5">
                              <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                className="text-[11px] font-medium text-primary hover:opacity-80 truncate">
                                {show.artist.artist_name}
                              </button>
                              {show.artist.spotify_artist_id && <SpotifyIcon artistId={show.artist.spotify_artist_id} />}
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                className="text-[10px] text-muted-foreground hover:text-primary truncate">
                                {show.venue.venue_name}
                              </button>
                              <CapacityBadge category={show.venue.capacity_category} />
                            </div>
                          </div>
                          {/* Links */}
                          <div className="flex items-center justify-center gap-2">
                            {show.setlist_url && (
                              <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">
                                <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-3.5 h-3.5 dark:invert" />
                              </a>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-muted px-4 py-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <button onClick={() => handlePage(currentPage - 1)} disabled={currentPage === 1}
                      className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">
                      Previous
                    </button>
                    <form onSubmit={handlePageSubmit} className="flex items-center gap-1">
                      <input type="number" min="1" max={totalPages} value={pageInput}
                        onChange={e => setPageInput(e.target.value)}
                        onBlur={() => { const p = parseInt(pageInput); if (isNaN(p) || p < 1 || p > totalPages) setPageInput(String(currentPage)) }}
                        className="w-12 px-2 py-1 text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <span className="text-sm text-muted-foreground">/ {totalPages}</span>
                    </form>
                    <button onClick={() => handlePage(currentPage + 1)} disabled={currentPage === totalPages}
                      className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>
    </>
  )
}
