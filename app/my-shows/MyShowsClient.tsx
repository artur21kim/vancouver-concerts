'use client'

import Navigation from '../components/Navigation'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
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

type SortField    = 'date' | 'artist' | 'venue' | 'added_at'
type SortDir      = 'asc' | 'desc'
type TimelineScope = 'all' | 'past' | 'upcoming'
type CapFilter    = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'
type ViewMode     = 'card' | 'table'

// ── Capacity metadata — exact colours matching Home stacked bar chart ──────────
const CAP_KEYS = ['small', 'medium', 'large', 'xlarge', 'unknown'] as const

const CAP_META: Record<string, {
  key: CapFilter
  shortLabel: string
  legendLabel: string
  color: string
  badgeBg: string
  badgeText: string
  unselectedClass: string
}> = {
  'small (<500)':      { key: 'small',   shortLabel: 'S',  legendLabel: 'Small (<500)',      color: 'rgba(139,92,246,0.85)',  badgeBg: 'bg-purple-500/20', badgeText: 'text-purple-300',              unselectedClass: 'text-purple-400 dark:text-purple-300' },
  'medium (500-1.5k)': { key: 'medium',  shortLabel: 'M',  legendLabel: 'Medium (500–1.5K)', color: 'rgba(58,143,189,0.85)',  badgeBg: 'bg-blue-500/20',   badgeText: 'text-[#3A8FBD]',               unselectedClass: 'text-[#3A8FBD]'                       },
  'large (1.5k-10k)':  { key: 'large',   shortLabel: 'L',  legendLabel: 'Large (1.5K–10K)',  color: 'rgba(234,88,12,0.85)',   badgeBg: 'bg-orange-500/20', badgeText: 'text-orange-400',              unselectedClass: 'text-orange-600 dark:text-orange-400' },
  'x-large (10k+)':    { key: 'xlarge',  shortLabel: 'XL', legendLabel: 'X-Large (10K+)',    color: 'rgba(225,29,72,0.85)',   badgeBg: 'bg-rose-500/20',   badgeText: 'text-rose-400',                unselectedClass: 'text-rose-600 dark:text-rose-400'     },
  'unknown':           { key: 'unknown', shortLabel: '?',  legendLabel: 'Unknown',           color: 'rgba(156,163,175,0.75)', badgeBg: 'bg-gray-500/20',   badgeText: 'text-gray-400 dark:text-gray-500', unselectedClass: 'text-gray-400 dark:text-gray-500' },
}

const CAP_BY_KEY: Record<string, typeof CAP_META[string]> = {}
Object.values(CAP_META).forEach(v => { CAP_BY_KEY[v.key] = v })

function getCapMeta(category: string | null) {
  if (!category) return CAP_META['unknown']
  return CAP_META[category.toLowerCase()] ?? CAP_META['unknown']
}

const CAP_BUTTONS: { key: CapFilter; label: string; tooltip: string }[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues'        },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)'     },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)' },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)'  },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)'    },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity'  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const TODAY = (() => { const d = new Date(); d.setHours(0,0,0,0); return d })()

function isFuture(date: string) {
  return new Date(date + 'T12:00:00') >= TODAY
}

function fmtDate(date: string) {
  return new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow border border-border p-3 md:p-4">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 leading-tight">{label}</p>
      <p className="text-lg md:text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}

function CapacityBadge({ category }: { category: string | null }) {
  const m = getCapMeta(category)
  if (m.key === 'unknown') return null
  return (
    <span className={`inline-flex items-center px-1 py-px rounded text-[9px] font-bold flex-shrink-0 ${m.badgeBg} ${m.badgeText}`}>
      {m.shortLabel}
    </span>
  )
}

function SpotifyLink({ artistId }: { artistId: string }) {
  return (
    <a
      href={`https://open.spotify.com/artist/${artistId}`}
      target="_blank" rel="noopener noreferrer"
      title="Open in Spotify"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    </a>
  )
}

// ── Timeline tooltip ──────────────────────────────────────────────────────────
function TimelineTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {d?.past   > 0 && <p className="text-primary">{d.past} past {d.past === 1 ? 'show' : 'shows'}</p>}
      {d?.future > 0 && <p className="text-amber-400">{d.future} upcoming {d.future === 1 ? 'show' : 'shows'}</p>}
    </div>
  )
}

// ── Donut tooltip ─────────────────────────────────────────────────────────────
function DonutTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-foreground">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value} shows</p>
    </div>
  )
}

// ── Stacked horizontal bar for artists ────────────────────────────────────────
function ArtistBar({
  artist, max, onNavigate,
}: {
  artist: { name: string; spotifyId: string | null; total: number; byCapacity: Record<string, number> }
  max: number
  onNavigate: () => void
}) {
  const totalWidth = max > 0 ? (artist.total / max) * 100 : 0
  const segments = CAP_KEYS.map(key => {
    const count = artist.byCapacity[key] ?? 0
    return { key, count, color: CAP_BY_KEY[key]?.color ?? 'rgba(156,163,175,0.75)' }
  }).filter(s => s.count > 0)

  return (
    <div className="flex items-center gap-2 py-0.5">
      <button
        onClick={onNavigate}
        className="w-32 md:w-40 text-xs text-primary hover:opacity-80 hover:underline text-right truncate flex-shrink-0"
        title={artist.name}
      >
        {artist.name}
      </button>
      <div className="flex-1 h-4 bg-muted/40 rounded-full overflow-hidden">
        <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
          {segments.map((seg, i) => {
            const segPct = (seg.count / artist.total) * 100
            const isFirst = i === 0
            const isLast  = i === segments.length - 1
            return (
              <div
                key={seg.key}
                style={{
                  width: `${segPct}%`,
                  backgroundColor: seg.color,
                  borderRadius: isFirst && isLast ? '9999px'
                    : isFirst ? '9999px 0 0 9999px'
                    : isLast  ? '0 9999px 9999px 0'
                    : '0',
                }}
              />
            )
          })}
        </div>
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-14 flex-shrink-0">
        {artist.total} {artist.total === 1 ? 'show' : 'shows'}
      </span>
      {artist.spotifyId && <SpotifyLink artistId={artist.spotifyId} />}
    </div>
  )
}

// ── Venue bar (coloured by capacity) ─────────────────────────────────────────
function VenueBar({
  venue, max, onNavigate,
}: {
  venue: { id: number; name: string; count: number; category: string | null }
  max: number
  onNavigate: () => void
}) {
  const m     = getCapMeta(venue.category)
  const width = max > 0 ? (venue.count / max) * 100 : 0
  return (
    <div className="flex items-center gap-2 py-0.5">
      <button
        onClick={onNavigate}
        className="w-32 md:w-40 text-xs text-primary hover:opacity-80 hover:underline text-right truncate flex-shrink-0"
        title={venue.name}
      >
        {venue.name}
      </button>
      <div className="flex-1 h-4 bg-muted/40 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, backgroundColor: m.color }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-14 flex-shrink-0">
        {venue.count} {venue.count === 1 ? 'show' : 'shows'}
      </span>
      <CapacityBadge category={venue.category} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyShowsClient({ shows: initialShows }: { shows: Show[] }) {
  const router = useRouter()
  const [shows, setShows]             = useState(initialShows)
  const [sortField, setSortField]     = useState<SortField>('date')
  const [sortDir, setSortDir]         = useState<SortDir>('desc')
  const [removingSet, setRemovingSet] = useState<Set<number>>(new Set())
  const [page, setPage]               = useState(1)
  const [pageInput, setPageInput]     = useState('1')
  const [timelineScope, setTimelineScope] = useState<TimelineScope>('all')
  const [capFilter, setCapFilter]     = useState<CapFilter>('all')
  const [viewMode, setViewMode]       = useState<ViewMode>('card')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [showAllVenues,  setShowAllVenues]  = useState(false)
  const PER_PAGE = 50

  // ── Derived stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const past   = shows.filter(s => !isFuture(s.date))
    const future = shows.filter(s =>  isFuture(s.date))
    const sorted = [...past].sort((a, b) => a.date.localeCompare(b.date))
    return {
      total:   shows.length,
      artists: new Set(shows.map(s => s.artist.artist_id)).size,
      venues:  new Set(shows.map(s => s.venue.venue_id)).size,
      past, future,
      firstShow: sorted[0]                 ?? null,
      lastShow:  sorted[sorted.length - 1] ?? null,
    }
  }, [shows])

  // ── Timeline ──────────────────────────────────────────────────────────────
  const timelineData = useMemo(() => {
    const src = timelineScope === 'past'     ? stats.past
              : timelineScope === 'upcoming' ? stats.future
              : shows
    const byYear: Record<string, { past: number; future: number }> = {}
    for (const s of src) {
      const y = s.date.split('-')[0]
      if (!byYear[y]) byYear[y] = { past: 0, future: 0 }
      if (isFuture(s.date)) byYear[y].future++
      else                  byYear[y].past++
    }
    return Object.entries(byYear)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([year, c]) => ({ year, past: c.past, future: c.future }))
  }, [shows, timelineScope, stats])

  const firstYear = stats.firstShow?.date.split('-')[0]
  const lastYear  = stats.lastShow?.date.split('-')[0]

  // ── Top artists — byCapacity keyed by CapFilter key (not raw DB string) ───
  const topArtists = useMemo(() => {
    const map: Record<number, {
      name: string; spotifyId: string | null
      total: number; byCapacity: Record<string, number>
    }> = {}
    for (const s of shows) {
      const id  = s.artist.artist_id
      const key = getCapMeta(s.venue.capacity_category).key   // 'small' | 'medium' | …
      if (!map[id]) map[id] = { name: s.artist.artist_name, spotifyId: s.artist.spotify_artist_id, total: 0, byCapacity: {} }
      map[id].total++
      map[id].byCapacity[key] = (map[id].byCapacity[key] ?? 0) + 1
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [shows])

  const maxArtistShows = topArtists[0]?.total ?? 1

  // ── Top venues ────────────────────────────────────────────────────────────
  const topVenues = useMemo(() => {
    const map: Record<number, { id: number; name: string; count: number; category: string | null }> = {}
    for (const s of shows) {
      const id = s.venue.venue_id
      if (!map[id]) map[id] = { id, name: s.venue.venue_name, count: 0, category: s.venue.capacity_category }
      map[id].count++
    }
    return Object.values(map).sort((a, b) => b.count - a.count)
  }, [shows])

  const maxVenueShows = topVenues[0]?.count ?? 1

  // ── Donut ─────────────────────────────────────────────────────────────────
  const donutData = useMemo(() => {
    const counts: Record<string, number> = { small: 0, medium: 0, large: 0, xlarge: 0, unknown: 0 }
    for (const s of shows) counts[getCapMeta(s.venue.capacity_category).key]++
    return [
      { name: 'Small (<500)',      key: 'small',   value: counts.small,   color: 'rgba(139,92,246,0.85)'  },
      { name: 'Medium (500–1.5K)', key: 'medium',  value: counts.medium,  color: 'rgba(58,143,189,0.85)'  },
      { name: 'Large (1.5K–10K)',  key: 'large',   value: counts.large,   color: 'rgba(234,88,12,0.85)'   },
      { name: 'X-Large (10K+)',    key: 'xlarge',  value: counts.xlarge,  color: 'rgba(225,29,72,0.85)'   },
      { name: 'Unknown',           key: 'unknown', value: counts.unknown, color: 'rgba(156,163,175,0.75)' },
    ].filter(e => e.value > 0)
  }, [shows])

  // ── Filtered + sorted list ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (capFilter === 'all') return shows
    return shows.filter(s => getCapMeta(s.venue.capacity_category).key === capFilter)
  }, [shows, capFilter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av: string, bv: string
      switch (sortField) {
        case 'date':     av = a.date;                              bv = b.date;                              break
        case 'artist':   av = a.artist.artist_name.toLowerCase(); bv = b.artist.artist_name.toLowerCase(); break
        case 'venue':    av = a.venue.venue_name.toLowerCase();   bv = b.venue.venue_name.toLowerCase();   break
        case 'added_at': av = a.added_at;                         bv = b.added_at;                         break
        default:         av = ''; bv = ''
      }
      if (av < bv) return sortDir === 'asc' ? -1 :  1
      if (av > bv) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }, [filtered, sortField, sortDir])

  const totalPages   = Math.ceil(sorted.length / PER_PAGE)
  const currentShows = sorted.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────
  const removeShow = async (id: number) => {
    setRemovingSet(prev => new Set(prev).add(id))
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_shows').delete().eq('user_id', user.id).eq('show_id', id)
      setShows(prev => prev.filter(s => s.show_id !== id))
    } catch { console.error('Error removing show') }
    finally { setRemovingSet(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1); setPageInput('1')
  }

  const handleCap = (key: CapFilter) => {
    setCapFilter(prev => prev === key ? 'all' : key)
    setPage(1); setPageInput('1')
  }

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p); setPageInput(String(p))
  }

  const sortArrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  // ── Shared remove icon ────────────────────────────────────────────────────
  const HeartIcon = ({ size = 5 }: { size?: number }) => (
    <svg className={`w-${size} h-${size} fill-destructive text-destructive hover:opacity-70 transition-opacity`}
      stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
    </svg>
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-6 md:py-8 px-4">
        <div className="max-w-7xl mx-auto space-y-4 md:space-y-6">

          {/* Title */}
          <h1 className="text-3xl md:text-4xl font-bold text-foreground">My Shows</h1>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 md:gap-4">
            <StatCard label="Shows"   value={stats.total.toLocaleString()} />
            <StatCard label="Artists" value={stats.artists.toLocaleString()} />
            <StatCard label="Venues"  value={stats.venues.toLocaleString()} />
          </div>

          {/* ── Concert Timeline ── */}
          {timelineData.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-lg md:text-xl font-bold text-foreground">Concert Timeline</h2>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  {(['all', 'past', 'upcoming'] as TimelineScope[]).map((s, i) => (
                    <button key={s} onClick={() => setTimelineScope(s)}
                      className={`px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        timelineScope === s
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-card text-muted-foreground hover:bg-muted'
                      }`}>
                      {s === 'upcoming' ? 'Upcoming' : s === 'past' ? 'Past' : 'All'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
                {stats.past.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#0d9488' }} />
                    Past shows
                  </span>
                )}
                {stats.future.length > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#f59e0b' }} />
                    Upcoming shows
                  </span>
                )}
                {firstYear && (
                  <span className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <circle cx="6" cy="6" r="5" fill="#0d9488" stroke="var(--background)" strokeWidth="2"/>
                    </svg>
                    First show
                  </span>
                )}
                {lastYear && lastYear !== firstYear && (
                  <span className="flex items-center gap-1.5">
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <circle cx="6" cy="6" r="5" fill="#5eead4" stroke="var(--background)" strokeWidth="2"/>
                    </svg>
                    Last show
                  </span>
                )}
              </div>

              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timelineData} margin={{ top: 20, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="areaPast" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02}/>
                      </linearGradient>
                      <linearGradient id="areaFuture" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="year" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip content={<TimelineTip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                    <Area type="monotone" dataKey="past"
                      stroke="#0d9488" strokeWidth={2} fill="url(#areaPast)"
                      dot={(props: any) => {
                        const { cx, cy, payload } = props
                        if (payload.year === firstYear) return <circle key={`dot-first-${cx}`} cx={cx} cy={cy} r={5} fill="#0d9488" stroke="var(--background)" strokeWidth={2}/>
                        if (payload.year === lastYear && lastYear !== firstYear) return <circle key={`dot-last-${cx}`} cx={cx} cy={cy} r={5} fill="#5eead4" stroke="var(--background)" strokeWidth={2}/>
                        return <circle key={`dot-${cx}`} cx={cx} cy={cy} r={3} fill="#0d9488" fillOpacity={0.7}/>
                      }}
                      activeDot={{ r: 4, fill: '#0d9488' }}
                    />
                    {stats.future.length > 0 && (
                      <Area type="monotone" dataKey="future"
                        stroke="#f59e0b" strokeWidth={2} fill="url(#areaFuture)"
                        dot={{ r: 3, fill: '#f59e0b', fillOpacity: 0.8 }}
                        activeDot={{ r: 4, fill: '#f59e0b' }}
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* First / last callout */}
              {(stats.firstShow || stats.lastShow) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-muted-foreground">
                  {stats.firstShow && (
                    <span>
                      First show: <span className="text-foreground font-medium">{stats.firstShow.artist.artist_name}</span>
                      {' '}at <span className="text-primary">{stats.firstShow.venue.venue_name}</span>
                      {' '}· {fmtDate(stats.firstShow.date)}
                    </span>
                  )}
                  {stats.lastShow && lastYear !== firstYear && (
                    <>
                      <span className="text-border select-none">·</span>
                      <span>
                        Last show: <span className="text-foreground font-medium">{stats.lastShow.artist.artist_name}</span>
                        {' '}at <span className="text-primary">{stats.lastShow.venue.venue_name}</span>
                        {' '}· {fmtDate(stats.lastShow.date)}
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
                <h2 className="text-lg font-bold text-foreground mb-1">Top Artists</h2>
                <p className="text-xs text-muted-foreground mb-3">Shows by venue size</p>

                {/* Cap colour legend */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[10px] text-muted-foreground">
                  {(['small', 'medium', 'large', 'xlarge'] as const).map(key => (
                    <span key={key} className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CAP_BY_KEY[key].color }} />
                      {CAP_BY_KEY[key].legendLabel}
                    </span>
                  ))}
                </div>

                <div className="space-y-1.5">
                  {topArtists.slice(0, showAllArtists ? undefined : 5).map(artist => (
                    <ArtistBar
                      key={artist.name}
                      artist={artist}
                      max={maxArtistShows}
                      onNavigate={() => router.push(`/browse?artist=${encodeURIComponent(artist.name)}`)}
                    />
                  ))}
                </div>

                {topArtists.length > 5 && (
                  <button onClick={() => setShowAllArtists(v => !v)}
                    className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                    {showAllArtists ? '← Show less' : `View all ${topArtists.length} artists →`}
                  </button>
                )}
              </div>

              {/* Top Venues */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
                <h2 className="text-lg font-bold text-foreground mb-1">Top Venues</h2>
                <p className="text-xs text-muted-foreground mb-3">Coloured by venue size</p>

                {/* Spacer to align with artist legend */}
                <div className="h-[22px] mb-3" />

                <div className="space-y-1.5">
                  {topVenues.slice(0, showAllVenues ? undefined : 5).map(venue => (
                    <VenueBar
                      key={venue.id}
                      venue={venue}
                      max={maxVenueShows}
                      onNavigate={() => router.push(`/browse?venue_id=${venue.id}`)}
                    />
                  ))}
                </div>

                {topVenues.length > 5 && (
                  <button onClick={() => setShowAllVenues(v => !v)}
                    className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                    {showAllVenues ? '← Show less' : `View all ${topVenues.length} venues →`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Donut + filter ── */}
          {donutData.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">Shows by Venue Size</h2>
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  {CAP_BUTTONS.map((btn, i) => (
                    <button key={btn.key} title={btn.tooltip} onClick={() => handleCap(btn.key)}
                      className={`px-2.5 py-1.5 transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                        capFilter === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : `bg-card ${CAP_BY_KEY[btn.key]?.unselectedClass ?? 'text-muted-foreground'} hover:bg-muted`
                      }`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="flex-shrink-0" style={{ width: 200, height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart onClick={(data: any) => {
                      const key = data?.activePayload?.[0]?.payload?.key as CapFilter | undefined
                      if (key) handleCap(key)
                    }} style={{ cursor: 'pointer' }}>
                      <Pie data={donutData} cx="50%" cy="50%"
                        innerRadius={55} outerRadius={85}
                        paddingAngle={2} dataKey="value" stroke="none">
                        {donutData.map(entry => (
                          <Cell key={entry.key} fill={entry.color}
                            opacity={capFilter === 'all' || capFilter === entry.key ? 1 : 0.25} />
                        ))}
                      </Pie>
                      <Tooltip content={<DonutTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                <div className="flex-1 w-full">
                  <div className="space-y-2">
                    {donutData.map(entry => {
                      const pct      = Math.round((entry.value / shows.length) * 100)
                      const isActive = capFilter === 'all' || capFilter === entry.key
                      return (
                        <button key={entry.key} onClick={() => handleCap(entry.key as CapFilter)}
                          className={`w-full flex items-center gap-2.5 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                          <span className="text-sm text-foreground flex-1">{entry.name}</span>
                          <span className="text-xs text-muted-foreground tabular-nums">{entry.value} shows</span>
                          <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
                        </button>
                      )
                    })}
                  </div>
                  {capFilter !== 'all' && (
                    <p className="text-xs text-muted-foreground mt-3">
                      Showing {filtered.length} of {shows.length} shows ·{' '}
                      <button onClick={() => handleCap('all')} className="text-primary hover:underline">Clear filter</button>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Show list ── */}
          {shows.length === 0 ? (
            <div className="bg-card rounded-lg shadow border border-border p-12 text-center">
              <p className="text-muted-foreground text-lg mb-4">No shows added yet.</p>
              <button onClick={() => router.push('/browse')}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 font-medium">
                Browse Shows
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-lg shadow border border-border overflow-hidden">

              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-foreground">
                    All Shows
                    {capFilter !== 'all' && (
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        ({filtered.length} filtered)
                      </span>
                    )}
                  </h2>
                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                    {(['card', 'table'] as ViewMode[]).map((m, i) => (
                      <button key={m} onClick={() => setViewMode(m)}
                        className={`px-2.5 py-1 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          viewMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}>
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{sorted.length.toLocaleString()} shows</span>
              </div>

              {/* ── Card view ── */}
              {viewMode === 'card' && (
                <>
                  {/* Desktop column headers */}
                  <div className="hidden md:grid bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                    style={{ gridTemplateColumns: '40px 130px 1fr 70px 60px' }}>
                    <div className="px-3 py-3" />
                    <button className="px-3 py-3 text-left hover:text-foreground" onClick={() => handleSort('date')}>
                      Date{sortArrow('date')}
                    </button>
                    <div className="px-3 py-3 flex gap-3">
                      <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                      <span className="text-muted-foreground/30">/</span>
                      <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                    </div>
                    <div className="px-3 py-3 text-center">Setlist</div>
                    <div className="px-3 py-3 text-center">Spotify</div>
                  </div>

                  {/* Mobile column headers */}
                  <div className="md:hidden grid bg-muted border-b border-border px-3 py-2"
                    style={{ gridTemplateColumns: '28px 80px 1fr 44px' }}>
                    <div />
                    <button className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                      onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                    <div className="flex gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                      <span className="text-muted-foreground/30">/</span>
                      <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                    </div>
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider text-center">Links</span>
                  </div>

                  <div className="divide-y divide-border">
                    {sorted.length === 0 ? (
                      <div className="text-center py-10 text-muted-foreground">No shows match this filter.</div>
                    ) : currentShows.map(show => {
                      const removing = removingSet.has(show.show_id)
                      const future   = isFuture(show.date)
                      return (
                        <div key={show.show_id}
                          className={`hover:bg-muted/30 transition-colors ${future ? 'bg-amber-500/5' : ''}`}>

                          {/* Desktop row */}
                          <div className="hidden md:grid items-center"
                            style={{ gridTemplateColumns: '40px 130px 1fr 70px 60px' }}>
                            <div className="px-3 py-3.5 flex items-center">
                              <button onClick={() => removeShow(show.show_id)} disabled={removing}
                                className="focus:outline-none disabled:opacity-50" title="Remove">
                                {removing
                                  ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                  : <HeartIcon size={5} />
                                }
                              </button>
                            </div>
                            <div className="px-3 py-3.5">
                              <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                              {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                            </div>
                            <div className="px-3 py-3.5 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                  className="text-sm font-medium text-primary hover:opacity-80 hover:underline truncate">
                                  {show.artist.artist_name}
                                </button>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                  className="text-[13px] text-muted-foreground hover:text-primary hover:underline truncate">
                                  {show.venue.venue_name}
                                </button>
                                <CapacityBadge category={show.venue.capacity_category} />
                              </div>
                            </div>
                            <div className="px-3 py-3.5 flex items-center justify-center">
                              {show.setlist_url
                                ? <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">
                                    <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-4 h-4 dark:invert"/>
                                  </a>
                                : <span className="text-muted-foreground/40 text-sm">—</span>
                              }
                            </div>
                            <div className="px-3 py-3.5 flex items-center justify-center">
                              {show.artist.spotify_artist_id
                                ? <SpotifyLink artistId={show.artist.spotify_artist_id} />
                                : <span className="text-muted-foreground/40 text-sm">—</span>
                              }
                            </div>
                          </div>

                          {/* Mobile row */}
                          <div className="md:hidden grid items-center px-3 py-2.5"
                            style={{ gridTemplateColumns: '28px 80px 1fr 44px' }}>
                            <div className="flex items-center">
                              <button onClick={() => removeShow(show.show_id)} disabled={removing}
                                className="focus:outline-none disabled:opacity-50">
                                {removing
                                  ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                  : <HeartIcon size={4} />
                                }
                              </button>
                            </div>
                            <div>
                              <p className="text-[11px] text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                              {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1 mb-0.5">
                                <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                  className="text-[11px] font-medium text-primary hover:opacity-80 truncate">
                                  {show.artist.artist_name}
                                </button>
                              </div>
                              <div className="flex items-center gap-1">
                                <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                  className="text-[10px] text-muted-foreground hover:text-primary truncate">
                                  {show.venue.venue_name}
                                </button>
                                <CapacityBadge category={show.venue.capacity_category} />
                              </div>
                            </div>
                            <div className="flex items-center justify-center gap-2">
                              {show.setlist_url && (
                                <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70">
                                  <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-3.5 h-3.5 dark:invert"/>
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {/* ── Table view ── */}
              {viewMode === 'table' && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-3 w-10" />
                        <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground whitespace-nowrap"
                          onClick={() => handleSort('date')}>Date{sortArrow('date')}</th>
                        <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground"
                          onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</th>
                        <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground"
                          onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</th>
                        <th className="px-3 py-3 text-left">Festival</th>
                        <th className="px-3 py-3 text-center">Setlist</th>
                        <th className="px-3 py-3 text-center">Spotify</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {sorted.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No shows match this filter.</td></tr>
                      ) : currentShows.map(show => {
                        const removing = removingSet.has(show.show_id)
                        const future   = isFuture(show.date)
                        return (
                          <tr key={show.show_id}
                            className={`hover:bg-muted/30 transition-colors ${future ? 'bg-amber-500/5' : ''}`}>
                            <td className="px-3 py-3">
                              <button onClick={() => removeShow(show.show_id)} disabled={removing}
                                className="focus:outline-none disabled:opacity-50">
                                {removing
                                  ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                  : <HeartIcon size={5} />
                                }
                              </button>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap text-foreground">
                              {fmtDate(show.date)}
                              {future && <span className="ml-1.5 text-[9px] font-semibold text-amber-400 bg-amber-400/15 px-1 py-px rounded">upcoming</span>}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                  className="text-primary hover:opacity-80 hover:underline text-left">
                                  {show.artist.artist_name}
                                </button>
                                {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-1.5">
                                <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                  className="text-muted-foreground hover:text-primary hover:underline text-left">
                                  {show.venue.venue_name}
                                </button>
                                <CapacityBadge category={show.venue.capacity_category} />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-muted-foreground">
                              {show.festival_name || <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {show.setlist_url
                                ? <a href={show.setlist_url} target="_blank" rel="noopener noreferrer" className="hover:opacity-70 inline-flex justify-center">
                                    <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-4 h-4 dark:invert"/>
                                  </a>
                                : <span className="text-muted-foreground/40">—</span>
                              }
                            </td>
                            <td className="px-3 py-3 text-center">
                              {show.artist.spotify_artist_id
                                ? <span className="inline-flex justify-center"><SpotifyLink artistId={show.artist.spotify_artist_id} /></span>
                                : <span className="text-muted-foreground/40">—</span>
                              }
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-muted px-4 py-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <button onClick={() => handlePage(page - 1)} disabled={page === 1}
                      className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">
                      Previous
                    </button>
                    <form onSubmit={e => {
                      e.preventDefault()
                      const p = parseInt(pageInput)
                      if (!isNaN(p) && p >= 1 && p <= totalPages) setPage(p)
                      else setPageInput(String(page))
                    }} className="flex items-center gap-1">
                      <input type="number" min="1" max={totalPages} value={pageInput}
                        onChange={e => setPageInput(e.target.value)}
                        onBlur={() => { const p = parseInt(pageInput); if (isNaN(p) || p < 1 || p > totalPages) setPageInput(String(page)) }}
                        className="w-12 px-2 py-1 text-sm text-center bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring text-foreground"
                      />
                      <span className="text-sm text-muted-foreground">/ {totalPages}</span>
                    </form>
                    <button onClick={() => handlePage(page + 1)} disabled={page === totalPages}
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
