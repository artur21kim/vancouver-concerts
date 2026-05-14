'use client'

import Navigation from '../components/Navigation'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, PieChart, Pie, Cell,
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
  match_score?: number | null
}

type UnaddedArtist = {
  show_id: number
  artist_name: string
  spotify_artist_id: string | null
  date: string
  venue_name: string
}

type SortField     = 'date' | 'artist' | 'venue' | 'added_at'
type SortDir       = 'asc' | 'desc'
type ViewMode      = 'shows' | 'sets' | 'festivals'
type SetsSubView   = 'card' | 'table'
type CapFilter     = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown'

// ── Capacity metadata ─────────────────────────────────────────────────────────
const CAP_KEYS = ['small', 'medium', 'large', 'xlarge', 'unknown'] as const

const CAP_META: Record<string, {
  key: CapFilter; shortLabel: string; legendLabel: string
  color: string; badgeBg: string; badgeText: string
}> = {
  'small (<500)':      { key: 'small',   shortLabel: 'S',  legendLabel: 'Small (<500)',      color: 'rgba(139,92,246,0.85)',  badgeBg: 'bg-purple-500/20', badgeText: 'text-purple-300'  },
  'medium (500-1.5k)': { key: 'medium',  shortLabel: 'M',  legendLabel: 'Medium (500–1.5K)', color: 'rgba(58,143,189,0.85)',  badgeBg: 'bg-blue-500/20',   badgeText: 'text-[#3A8FBD]'  },
  'large (1.5k-10k)':  { key: 'large',   shortLabel: 'L',  legendLabel: 'Large (1.5K–10K)',  color: 'rgba(234,88,12,0.85)',   badgeBg: 'bg-orange-500/20', badgeText: 'text-orange-400' },
  'x-large (10k+)':    { key: 'xlarge',  shortLabel: 'XL', legendLabel: 'X-Large (10K+)',    color: 'rgba(225,29,72,0.85)',   badgeBg: 'bg-rose-500/20',   badgeText: 'text-rose-400'   },
  'unknown':           { key: 'unknown', shortLabel: '?',  legendLabel: 'Unknown',           color: 'rgba(156,163,175,0.75)', badgeBg: 'bg-gray-500/20',   badgeText: 'text-gray-400'   },
}

const CAP_BY_KEY: Record<string, typeof CAP_META[string]> = {}
Object.values(CAP_META).forEach(v => { CAP_BY_KEY[v.key] = v })

function getCapMeta(category: string | null) {
  if (!category) return CAP_META['unknown']
  return CAP_META[category.toLowerCase()] ?? CAP_META['unknown']
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SPOTIFY_GREEN = '#1DB954'
const TEAL = '#0d9488'

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

function isFestivalShow(show: Show) {
  return show.show_type === 'festival' || !!show.festival_name
}

// Headliner score: match_score > monthly_listeners > vancouver fallback > alpha
function headlinerScore(show: Show): number {
  if (show.match_score != null && show.match_score > 0) return show.match_score * 1_000_000
  if (show.artist.monthly_listeners != null) return show.artist.monthly_listeners
  return 0
}

// ── Bill group: shows sharing same date+venue ─────────────────────────────────
type BillGroup = {
  key: string
  date: string
  venue_id: number
  venue_name: string
  capacity_category: string | null
  shows: Show[]
  headliner: Show
  isFestival: boolean
  festival_name: string | null
}

function buildBillGroups(shows: Show[]): BillGroup[] {
  const map = new Map<string, Show[]>()
  for (const s of shows) {
    const key = `${s.date}__${s.venue.venue_id}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  const groups: BillGroup[] = []
  for (const [key, groupShows] of map) {
    const sorted = [...groupShows].sort((a, b) => headlinerScore(b) - headlinerScore(a))
    const headliner = sorted[0]
    groups.push({
      key,
      date: headliner.date,
      venue_id: headliner.venue.venue_id,
      venue_name: headliner.venue.venue_name,
      capacity_category: headliner.venue.capacity_category,
      shows: sorted,
      headliner,
      isFestival: groupShows.some(isFestivalShow),
      festival_name: groupShows.find(s => s.festival_name)?.festival_name ?? null,
    })
  }
  return groups.sort((a, b) => b.date.localeCompare(a.date))
}

// ── Sub-components ────────────────────────────────────────────────────────────
function CapacityBadge({ category }: { category: string | null }) {
  const m = getCapMeta(category)
  if (m.key === 'unknown') return null
  return (
    <span className={`inline-flex items-center px-1 py-px rounded text-[9px] font-bold flex-shrink-0 ${m.badgeBg} ${m.badgeText}`}>
      {m.shortLabel}
    </span>
  )
}

function SpotifyLink({ artistId, name }: { artistId: string; name?: string }) {
  if (name) {
    return (
      <a href={`https://open.spotify.com/artist/${artistId}`}
        target="_blank" rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="text-primary hover:opacity-70 hover:underline transition-opacity font-medium">
        {name}
      </a>
    )
  }
  return (
    <a href={`https://open.spotify.com/artist/${artistId}`}
      target="_blank" rel="noopener noreferrer" title="Open in Spotify"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity">
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill={SPOTIFY_GREEN}>
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
      </svg>
    </a>
  )
}

function SetlistLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="View setlist"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity">
      <img src="https://www.setlist.fm/favicon.ico" alt="setlist.fm" className="w-3 h-3 dark:invert" />
    </a>
  )
}

// ── Timeline tooltips ─────────────────────────────────────────────────────────
function YearTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const shows = payload.find((p: any) => p.dataKey === 'shows')?.value
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {shows != null && shows > 0 && <p className="text-primary">{shows} {shows === 1 ? 'show' : 'shows'}</p>}
    </div>
  )
}

function MonthTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const shows  = payload.find((p: any) => p.dataKey === 'shows')?.value  ?? 0
  const future = payload.find((p: any) => p.dataKey === 'future')?.value ?? 0
  const songs  = payload.find((p: any) => p.dataKey === 'songs')?.value
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {shows  > 0 && <p className="text-primary">{shows} {shows === 1 ? 'show' : 'shows'}</p>}
      {future > 0 && <p className="text-amber-400">{future} upcoming</p>}
      {songs != null && songs > 0 && <p style={{ color: SPOTIFY_GREEN }}>{songs} songs added</p>}
    </div>
  )
}

// ── Artist bar tooltip: venue breakdown ───────────────────────────────────────
function ArtistBarTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const data = payload[0]?.payload
  if (!data?.venueBreakdown) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2.5 text-xs shadow-lg pointer-events-none min-w-[180px]">
      <p className="font-semibold text-foreground mb-1.5">{data.name}</p>
      {data.venueBreakdown.map((v: { name: string; count: number }) => (
        <div key={v.name} className="flex items-center justify-between gap-4 mb-0.5">
          <span className="text-muted-foreground truncate">{v.name}</span>
          <span className="text-primary font-medium tabular-nums flex-shrink-0">{v.count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Donut tooltip ─────────────────────────────────────────────────────────────
function DonutTip({ active, payload, venueBreakdown }: any) {
  if (!active || !payload?.length) return null
  const entry  = payload[0]?.payload
  const venues = venueBreakdown[entry?.key] ?? []
  const total  = entry?.value ?? 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2.5 text-xs shadow-lg pointer-events-none min-w-[180px]">
      <p className="font-semibold text-foreground mb-1.5">{entry?.name}</p>
      {venues.map((v: { name: string; count: number }) => (
        <div key={v.name} className="flex items-center justify-between gap-4 mb-0.5">
          <span className="text-muted-foreground truncate">{v.name}</span>
          <span className="text-foreground font-medium tabular-nums flex-shrink-0">
            {v.count} <span className="text-muted-foreground font-normal">({Math.round((v.count / total) * 100)}%)</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Stacked horizontal bar for artists ────────────────────────────────────────
function ArtistBar({ artist, max, onNavigate }: {
  artist: {
    name: string; spotifyId: string | null; total: number
    byCapacity: Record<string, number>
    venueBreakdown: { name: string; count: number }[]
  }
  max: number; onNavigate: () => void
}) {
  const totalWidth = max > 0 ? (artist.total / max) * 100 : 0
  const segments = CAP_KEYS.map(key => ({
    key, count: artist.byCapacity[key] ?? 0,
    color: CAP_BY_KEY[key]?.color ?? 'rgba(156,163,175,0.75)',
  })).filter(s => s.count > 0)

  // Build recharts-compatible data for tooltip
  const chartData = [{ name: artist.name, value: artist.total, venueBreakdown: artist.venueBreakdown, ...Object.fromEntries(segments.map(s => [s.key, s.count])) }]

  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
        <button onClick={onNavigate}
          className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right"
          title={artist.name}>{artist.name}</button>
        {artist.spotifyId && <SpotifyLink artistId={artist.spotifyId} />}
      </div>
      {/* Custom bar with recharts tooltip overlay */}
      <div className="flex-1 relative" style={{ height: '16px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <Tooltip content={<ArtistBarTip />} cursor={false} />
            <Area type="monotone" dataKey="value" stroke="transparent" fill="transparent" />
          </AreaChart>
        </ResponsiveContainer>
        {/* Actual visual bar rendered below the recharts layer */}
        <div className="absolute inset-0 flex items-center pointer-events-none">
          <div className="h-4 bg-muted/40 rounded-full overflow-hidden w-full">
            <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
              {segments.map((seg, i) => {
                const isFirst = i === 0, isLast = i === segments.length - 1
                return (
                  <div key={seg.key} style={{
                    width: `${(seg.count / artist.total) * 100}%`,
                    backgroundColor: seg.color,
                    borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                  }} />
                )
              })}
            </div>
          </div>
        </div>
      </div>
      <span className="text-xs tabular-nums flex-shrink-0" style={{ color: TEAL }}>
        {artist.total} {artist.total === 1 ? 'show' : 'shows'}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyShowsClient({
  shows: initialShows,
  spotifySongs,
}: {
  shows: Show[]
  spotifySongs: { added_at: string }[]
}) {
  const router = useRouter()
  const supabase = createClient()

  const [shows, setShows]                   = useState(initialShows)
  const [viewMode, setViewMode]             = useState<ViewMode>('shows')
  const [setsSubView, setSetsSubView]       = useState<SetsSubView>('card')
  const [sortField, setSortField]           = useState<SortField>('date')
  const [sortDir, setSortDir]               = useState<SortDir>('desc')
  const [removingSet, setRemovingSet]       = useState<Set<number>>(new Set())
  const [page, setPage]                     = useState(1)
  const [pageInput, setPageInput]           = useState('1')
  const [selectedYear, setSelectedYear]     = useState<string | null>(null)
  const [capFilter, setCapFilter]           = useState<CapFilter>('all')
  const [showAllArtists, setShowAllArtists] = useState(false)
  const [expandedBills, setExpandedBills]   = useState<Set<string>>(new Set())

  // Unadded artists CTA
  const [unaddedArtists, setUnaddedArtists]         = useState<UnaddedArtist[]>([])
  const [unaddedDismissed, setUnaddedDismissed]     = useState(false)
  const [unaddedExpanded, setUnaddedExpanded]       = useState(false)
  const [addingUnadded, setAddingUnadded]           = useState(false)
  const [sessionShowsModified, setSessionShowsModified] = useState(false)

  const PER_PAGE = 50
  const hasSpotify = spotifySongs.length > 0
  const anyFilterActive = selectedYear !== null || capFilter !== 'all'

  // ── Check for unadded co-billed artists ───────────────────────────────────
  const checkUnaddedArtists = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const addedShowIds = shows.map(s => s.show_id)
      if (addedShowIds.length === 0) return

      // Find all shows at same date+venue as shows user has added, excluding comedy
      const { data: coBilled } = await supabase
        .from('fact_shows')
        .select(`
          show_id, date, venue_id,
          dim_artist ( artist_id, artist_name, spotify_artist_id ),
          dim_venue ( venue_name ),
          show_type
        `)
        .neq('show_type', 'comedy')
        .not('show_id', 'in', `(${addedShowIds.join(',')})`)

      if (!coBilled || coBilled.length === 0) return

      // Build set of (date, venue_id) pairs from user's shows
      const userBills = new Set(shows.map(s => `${s.date}__${s.venue.venue_id}`))

      const unadded: UnaddedArtist[] = []
      for (const show of coBilled) {
        const key = `${show.date}__${show.venue_id}`
        if (!userBills.has(key)) continue
        const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
        const venue = Array.isArray(show.dim_venue) ? show.dim_venue[0] : show.dim_venue
        if (!artist) continue
        unadded.push({
          show_id: show.show_id,
          artist_name: artist.artist_name,
          spotify_artist_id: artist.spotify_artist_id ?? null,
          date: show.date,
          venue_name: venue?.venue_name ?? '',
        })
      }

      setUnaddedArtists(unadded)
    } catch (e) {
      console.error('Error checking unadded artists:', e)
    }
  }, [shows, supabase])

  useEffect(() => {
    checkUnaddedArtists()
  }, [])

  // Re-check if shows were modified this session
  useEffect(() => {
    if (sessionShowsModified) {
      checkUnaddedArtists()
      setSessionShowsModified(false)
    }
  }, [sessionShowsModified])

  // ── Base stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const past   = shows.filter(s => !isFuture(s.date))
    const future = shows.filter(s =>  isFuture(s.date))
    const sortedPast = [...past].sort((a, b) => a.date.localeCompare(b.date))
    return {
      total:   shows.length,
      artists: new Set(shows.map(s => s.artist.artist_id)).size,
      venues:  new Set(shows.map(s => s.venue.venue_id)).size,
      past, future,
      firstShow: sortedPast[0]                     ?? null,
      lastShow:  sortedPast[sortedPast.length - 1] ?? null,
    }
  }, [shows])

  // ── Spotify songs per month ───────────────────────────────────────────────
  const spotifyByYearMonth = useMemo(() => {
    const result: Record<string, Record<number, number>> = {}
    for (const s of spotifySongs) {
      const dt = new Date(s.added_at)
      const y  = String(dt.getFullYear())
      const m  = dt.getMonth()
      if (!result[y]) result[y] = {}
      result[y][m] = (result[y][m] ?? 0) + 1
    }
    return result
  }, [spotifySongs])

  const firstSpotifyYear = useMemo(() => {
    const years = Object.keys(spotifyByYearMonth).sort()
    return years[0] ?? null
  }, [spotifyByYearMonth])

  // ── Timeline data ─────────────────────────────────────────────────────────
  const yearTimelineData = useMemo(() => {
    const src = viewMode === 'festivals' ? shows.filter(isFestivalShow) : shows
    const byYear: Record<string, { past: number; future: number }> = {}
    for (const s of src) {
      const y = s.date.split('-')[0]
      if (!byYear[y]) byYear[y] = { past: 0, future: 0 }
      if (isFuture(s.date)) byYear[y].future++
      else                  byYear[y].past++
    }
    return Object.entries(byYear)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([year, c]) => ({ year, shows: c.past + c.future, past: c.past, future: c.future }))
  }, [shows, viewMode])

  const monthTimelineData = useMemo(() => {
    if (!selectedYear) return []
    const src = viewMode === 'festivals' ? shows.filter(isFestivalShow) : shows
    const inYear = src.filter(s => s.date.split('-')[0] === selectedYear)
    const byMonth: Record<number, { past: number; future: number }> = {}
    for (let m = 0; m < 12; m++) byMonth[m] = { past: 0, future: 0 }
    for (const s of inYear) {
      const m = parseInt(s.date.split('-')[1]) - 1
      if (isFuture(s.date)) byMonth[m].future++
      else                  byMonth[m].past++
    }
    const songsByMonth = spotifyByYearMonth[selectedYear] ?? {}
    const hasSongsThisYear = Object.keys(songsByMonth).length > 0
    return Array.from({ length: 12 }, (_, m) => ({
      month: MONTHS[m],
      shows: byMonth[m].past,
      future: byMonth[m].future,
      ...(hasSpotify && hasSongsThisYear ? { songs: songsByMonth[m] ?? 0 } : {}),
    }))
  }, [shows, selectedYear, viewMode, spotifyByYearMonth, hasSpotify])

  const firstYear = stats.firstShow?.date.split('-')[0]
  const lastYear  = stats.lastShow?.date.split('-')[0]
  const drilldownHasSpotify = selectedYear
    ? hasSpotify && Object.keys(spotifyByYearMonth[selectedYear] ?? {}).length > 0
    : false

  // ── Year-filtered set ─────────────────────────────────────────────────────
  const yearFiltered = useMemo(() => {
    if (!selectedYear) return shows
    return shows.filter(s => s.date.split('-')[0] === selectedYear)
  }, [shows, selectedYear])

  // ── Top artists (with venue breakdown for tooltip) ─────────────────────────
  const topArtists = useMemo(() => {
    const map: Record<number, {
      name: string; spotifyId: string | null; total: number
      byCapacity: Record<string, number>
      byVenue: Record<string, number>
    }> = {}
    for (const s of yearFiltered) {
      const id  = s.artist.artist_id
      const capKey = getCapMeta(s.venue.capacity_category).key
      if (!map[id]) map[id] = { name: s.artist.artist_name, spotifyId: s.artist.spotify_artist_id, total: 0, byCapacity: {}, byVenue: {} }
      map[id].total++
      map[id].byCapacity[capKey] = (map[id].byCapacity[capKey] ?? 0) + 1
      map[id].byVenue[s.venue.venue_name] = (map[id].byVenue[s.venue.venue_name] ?? 0) + 1
    }
    return Object.values(map)
      .map(a => ({
        ...a,
        venueBreakdown: Object.entries(a.byVenue)
          .map(([name, count]) => ({ name, count }))
          .sort((x, y) => y.count - x.count),
      }))
      .sort((a, b) => b.total - a.total)
  }, [yearFiltered])

  const maxArtistShows = topArtists[0]?.total ?? 1

  // ── Donut + venue breakdown ───────────────────────────────────────────────
  const { donutData, venueBreakdown } = useMemo(() => {
    const src = viewMode === 'festivals' ? yearFiltered.filter(isFestivalShow) : yearFiltered
    const counts: Record<string, number> = {}
    const venueByCap: Record<string, Record<number, { name: string; count: number }>> = {}
    for (const s of src) {
      const capKey = getCapMeta(s.venue.capacity_category).key
      counts[capKey] = (counts[capKey] ?? 0) + 1
      if (!venueByCap[capKey]) venueByCap[capKey] = {}
      const vid = s.venue.venue_id
      if (!venueByCap[capKey][vid]) venueByCap[capKey][vid] = { name: s.venue.venue_name, count: 0 }
      venueByCap[capKey][vid].count++
    }
    const donut = CAP_KEYS
      .map(key => ({ name: CAP_BY_KEY[key].legendLabel, key, value: counts[key] ?? 0, color: CAP_BY_KEY[key].color }))
      .filter(d => d.value > 0)
    const breakdown: Record<string, { name: string; count: number }[]> = {}
    for (const [k, venues] of Object.entries(venueByCap)) {
      breakdown[k] = Object.values(venues).sort((a, b) => b.count - a.count)
    }
    return { donutData: donut, venueBreakdown: breakdown }
  }, [yearFiltered, viewMode])

  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  // ── Bill groups for Shows view ────────────────────────────────────────────
  const billGroups = useMemo(() => {
    const src = yearFiltered.filter(s => !isFestivalShow(s))
    const filtered = capFilter === 'all' ? src : src.filter(s => getCapMeta(s.venue.capacity_category).key === capFilter)
    return buildBillGroups(filtered)
  }, [yearFiltered, capFilter])

  // ── Festival groups ────────────────────────────────────────────────────────
  const festivalGroups = useMemo(() => {
    const src = yearFiltered.filter(isFestivalShow)
    const map = new Map<string, Show[]>()
    for (const s of src) {
      const name = s.festival_name ?? 'Unknown Festival'
      const year = s.date.split('-')[0]
      const key  = `${name}__${year}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return Array.from(map.entries())
      .map(([key, festShows]) => {
        const [name] = key.split('__')
        const sorted = [...festShows].sort((a, b) => b.date.localeCompare(a.date))
        const dates  = festShows.map(s => s.date).sort()
        return {
          key,
          festival_name: name,
          year: festShows[0].date.split('-')[0],
          shows: sorted,
          date_from: dates[0],
          date_to:   dates[dates.length - 1],
          venue_name: festShows[0].venue.venue_name,
        }
      })
      .sort((a, b) => b.date_to.localeCompare(a.date_to))
  }, [yearFiltered])

  // ── Sets view (existing individual rows) ──────────────────────────────────
  const setsFiltered = useMemo(() => {
    const src = capFilter === 'all' ? yearFiltered : yearFiltered.filter(s => getCapMeta(s.venue.capacity_category).key === capFilter)
    return [...src].sort((a, b) => {
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
  }, [yearFiltered, capFilter, sortField, sortDir])

  const totalPages   = Math.ceil(setsFiltered.length / PER_PAGE)
  const currentShows = setsFiltered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCap = useCallback((key: CapFilter) => {
    setCapFilter(prev => prev === key ? 'all' : key)
    setPage(1); setPageInput('1')
  }, [])

  const handleYearClick = useCallback((year: string) => {
    setSelectedYear(prev => prev === year ? null : year)
    setCapFilter('all'); setPage(1); setPageInput('1'); setShowAllArtists(false)
  }, [])

  const clearAll = useCallback(() => {
    setSelectedYear(null); setCapFilter('all')
    setPage(1); setPageInput('1'); setShowAllArtists(false)
  }, [])

  const removeShow = async (id: number) => {
    setRemovingSet(prev => new Set(prev).add(id))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_shows').delete().eq('user_id', user.id).eq('show_id', id)
      setShows(prev => prev.filter(s => s.show_id !== id))
      setSessionShowsModified(true)
    } catch { console.error('Error removing show') }
    finally { setRemovingSet(prev => { const s = new Set(prev); s.delete(id); return s }) }
  }

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
    setPage(1); setPageInput('1')
  }

  const handlePage = (p: number) => {
    if (p < 1 || p > totalPages) return
    setPage(p); setPageInput(String(p))
  }

  const sortArrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  const addUnaddedAll = async () => {
    if (!unaddedArtists.length) return
    setAddingUnadded(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const records = unaddedArtists.map(a => ({ user_id: user.id, show_id: a.show_id, status: 'attended', source: 'manual' }))
      await supabase.from('user_shows').upsert(records, { onConflict: 'user_id,show_id' })
      // Refresh shows
      const { data: newShows } = await supabase
        .from('user_shows')
        .select(`show_id, added_at, source, fact_shows ( show_id, date, setlist_url, show_type, festival_name, dim_artist ( artist_id, artist_name, monthly_listeners, spotify_artist_id ), dim_venue ( venue_id, venue_name, capacity, capacity_category ) )`)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })
      if (newShows) {
        const mapped = newShows.map((us: any) => {
          const show = Array.isArray(us.fact_shows) ? us.fact_shows[0] : us.fact_shows
          if (!show) return null
          const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
          const venue  = Array.isArray(show.dim_venue)  ? show.dim_venue[0]  : show.dim_venue
          if (!artist || !venue) return null
          return { show_id: show.show_id, date: show.date, setlist_url: show.setlist_url, show_type: show.show_type, festival_name: show.festival_name, added_at: us.added_at, notes: null, source: us.source, artist: { artist_id: artist.artist_id, artist_name: artist.artist_name, monthly_listeners: artist.monthly_listeners, spotify_artist_id: artist.spotify_artist_id }, venue: { venue_id: venue.venue_id, venue_name: venue.venue_name, capacity: venue.capacity ?? null, capacity_category: venue.capacity_category ?? null } }
        }).filter(Boolean)
        setShows(mapped as Show[])
      }
      setUnaddedArtists([])
      setUnaddedDismissed(true)
    } catch (e) { console.error('Error adding unadded artists:', e) }
    finally { setAddingUnadded(false) }
  }

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

          <h1 className="text-3xl md:text-4xl font-bold text-foreground">My Shows</h1>

          {/* ── Unadded artists CTA ── */}
          {!unaddedDismissed && unaddedArtists.length > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground mb-1">
                    {unaddedArtists.length} artist{unaddedArtists.length !== 1 ? 's' : ''} from shows you attended {unaddedArtists.length !== 1 ? 'haven\'t' : 'hasn\'t'} been added yet
                  </p>
                  {!unaddedExpanded ? (
                    <p className="text-xs text-muted-foreground truncate">
                      {unaddedArtists.slice(0, 4).map(a => a.artist_name).join(', ')}
                      {unaddedArtists.length > 4 ? ` + ${unaddedArtists.length - 4} more` : ''}
                    </p>
                  ) : (
                    <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {unaddedArtists.map(a => (
                        <div key={a.show_id} className="flex items-center gap-2 text-xs">
                          <span className="text-muted-foreground w-24 flex-shrink-0 tabular-nums">{fmtDate(a.date)}</span>
                          <span className="text-foreground font-medium truncate">{a.artist_name}</span>
                          <span className="text-muted-foreground/60 truncate">@ {a.venue_name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={addUnaddedAll}
                      disabled={addingUnadded}
                      className="text-xs font-semibold px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                    >
                      {addingUnadded ? 'Adding...' : 'Add All'}
                    </button>
                    <button
                      onClick={() => setUnaddedExpanded(v => !v)}
                      className="text-xs text-primary hover:opacity-80 transition"
                    >
                      {unaddedExpanded ? 'Show less' : 'Review'}
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => setUnaddedDismissed(true)}
                  className="text-muted-foreground hover:text-foreground transition text-lg leading-none flex-shrink-0"
                >×</button>
              </div>
            </div>
          )}

          {/* ── Concert Timeline + Donut side by side ── */}
          {yearTimelineData.length > 0 && (
            <div className="flex gap-4">
              {/* Timeline — 75% */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg md:text-xl font-bold text-foreground">Concert Timeline</h2>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{stats.total}</span>
                        <span className="text-muted-foreground"> shows</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{stats.artists}</span>
                        <span className="text-muted-foreground"> artists</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{stats.venues}</span>
                        <span className="text-muted-foreground"> venues</span>
                      </span>
                    </div>
                    {anyFilterActive && (
                      <button onClick={clearAll}
                        className="px-2.5 py-0.5 rounded-md border border-destructive text-destructive text-xs font-semibold hover:bg-destructive/10 transition-colors">
                        Clear All
                      </button>
                    )}
                    {selectedYear && (
                      <button onClick={() => { setSelectedYear(null); setCapFilter('all') }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors">
                        ← {selectedYear}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#0d9488' }} />
                    {selectedYear ? 'Shows' : 'Shows per year'}
                  </span>
                  {stats.future.length > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#f59e0b' }} />
                      Upcoming
                    </span>
                  )}
                  {drilldownHasSpotify && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SPOTIFY_GREEN }} />
                      Songs added
                      {firstSpotifyYear && <span className="text-muted-foreground/50 ml-0.5">(from {firstSpotifyYear})</span>}
                    </span>
                  )}
                </div>

                <div style={{ height: 160 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {selectedYear ? (
                      <ComposedChart data={monthTimelineData} margin={{ top: 16, right: drilldownHasSpotify ? 40 : 8, left: -20, bottom: 0 }}>
                        <defs>
                          <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis yAxisId="shows" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        {drilldownHasSpotify && (
                          <YAxis yAxisId="songs" orientation="right" tick={{ fill: SPOTIFY_GREEN, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        )}
                        <Tooltip content={<MonthTip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                        <Area yAxisId="shows" type="monotone" dataKey="shows" stroke="#0d9488" strokeWidth={2} fill="url(#gradShows)"
                          dot={(p: any) => {
                            const { cx, cy, payload } = p
                            if ((payload.shows ?? 0) + (payload.future ?? 0) === 0) return <g key={`e-${cx}`} />
                            return <circle key={`s-${cx}`} cx={cx} cy={cy} r={3} fill="#0d9488" stroke="var(--background)" strokeWidth={1.5}/>
                          }} activeDot={{ r: 4, fill: '#0d9488' }} />
                        {stats.future.length > 0 && (
                          <Area yAxisId="shows" type="monotone" dataKey="future" stroke="#f59e0b" strokeWidth={2} fill="none"
                            dot={{ r: 3, fill: '#f59e0b' }} activeDot={{ r: 4, fill: '#f59e0b' }} />
                        )}
                        {drilldownHasSpotify && (
                          <Line yAxisId="songs" type="monotone" dataKey="songs" stroke={SPOTIFY_GREEN} strokeWidth={2}
                            dot={(p: any) => {
                              const { cx, cy, payload } = p
                              if (!payload.songs || payload.songs === 0) return <g key={`e-${cx}`} />
                              return <circle key={`sp-${cx}`} cx={cx} cy={cy} r={3} fill={SPOTIFY_GREEN} stroke="var(--background)" strokeWidth={1.5}/>
                            }} connectNulls={false} activeDot={{ r: 4, fill: SPOTIFY_GREEN }} />
                        )}
                      </ComposedChart>
                    ) : (
                      <AreaChart data={yearTimelineData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}
                        onClick={(d: any) => { const y = d?.activeLabel; if (y) handleYearClick(y) }}
                        style={{ cursor: 'pointer' }}>
                        <defs>
                          <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02}/>
                          </linearGradient>
                          <linearGradient id="gradFuture" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.02}/>
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="year"
                          tick={({ x, y, payload }: any) => (
                            <text x={x} y={y + 12} textAnchor="middle" fontSize={11}
                              fill={selectedYear === payload.value ? 'var(--primary)' : 'var(--muted-foreground)'}
                              fontWeight={selectedYear === payload.value ? 700 : 400}>
                              {payload.value}
                            </text>
                          )}
                          axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                        <Tooltip content={<YearTip />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                        <Area type="monotone" dataKey="shows" stroke="#0d9488" strokeWidth={2} fill="url(#gradShows)"
                          dot={(p: any) => {
                            const { cx, cy, payload } = p
                            if (payload.year === firstYear) return <circle key={`f-${cx}`} cx={cx} cy={cy} r={5} fill="#0d9488" stroke="var(--background)" strokeWidth={2}/>
                            if (payload.year === lastYear && lastYear !== firstYear) return <circle key={`l-${cx}`} cx={cx} cy={cy} r={5} fill="#5eead4" stroke="var(--background)" strokeWidth={2}/>
                            return <circle key={`d-${cx}`} cx={cx} cy={cy} r={3} fill="#0d9488" fillOpacity={0.7}/>
                          }} activeDot={{ r: 5, fill: '#0d9488' }} />
                        {stats.future.length > 0 && (
                          <Area type="monotone" dataKey="future" stroke="#f59e0b" strokeWidth={2} fill="url(#gradFuture)"
                            dot={{ r: 3, fill: '#f59e0b', fillOpacity: 0.8 }} activeDot={{ r: 5, fill: '#f59e0b' }} />
                        )}
                      </AreaChart>
                    )}
                  </ResponsiveContainer>
                </div>

                {!selectedYear && (stats.firstShow || stats.lastShow) && (
                  <div className="flex items-start justify-between gap-2 mt-2 text-xs text-muted-foreground">
                    {stats.firstShow && (
                      <span>First: <span className="text-foreground font-medium">{stats.firstShow.artist.artist_name}</span> · {fmtDate(stats.firstShow.date)}</span>
                    )}
                    {stats.lastShow && lastYear !== firstYear && (
                      <span className="text-right flex-shrink-0">Last: <span className="text-foreground font-medium">{stats.lastShow.artist.artist_name}</span> · {fmtDate(stats.lastShow.date)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Donut — 25% */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-64 flex-shrink-0 hidden md:flex flex-col">
                <h2 className="text-base font-bold text-foreground mb-3">Venues by Size</h2>
                {donutData.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No data</p>
                ) : (
                  <>
                    <div className="flex-shrink-0" style={{ height: 140 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%"
                            innerRadius={40} outerRadius={65} paddingAngle={2} dataKey="value" stroke="none"
                            onClick={(d: any) => handleCap(d.key as CapFilter)} style={{ cursor: 'pointer' }}>
                            {donutData.map(entry => (
                              <Cell key={entry.key} fill={entry.color}
                                opacity={capFilter === 'all' || capFilter === entry.key ? 1 : 0.25} />
                            ))}
                          </Pie>
                          <Tooltip content={<DonutTip venueBreakdown={venueBreakdown} />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-1.5 mt-2">
                      {donutData.map(entry => {
                        const pct      = Math.round((entry.value / donutTotal) * 100)
                        const isActive = capFilter === 'all' || capFilter === entry.key
                        return (
                          <button key={entry.key} onClick={() => handleCap(entry.key as CapFilter)}
                            className={`w-full flex items-center gap-1.5 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                            <span className="text-[10px] text-foreground flex-1 truncate">{entry.name}</span>
                            <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: TEAL }}>{entry.value}</span>
                            <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0 w-7 text-right">{pct}%</span>
                          </button>
                        )
                      })}
                      {capFilter !== 'all' && (
                        <button onClick={() => handleCap('all')} className="text-[10px] text-primary hover:underline mt-1">
                          Clear filter ×
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Top Artists (full width) ── */}
          {shows.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <h2 className="text-lg font-bold text-foreground mb-3">
                Top Artists
                {selectedYear && <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedYear}</span>}
              </h2>
              {topArtists.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No shows in {selectedYear}.</p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {topArtists.slice(0, showAllArtists ? undefined : 5).map(artist => (
                      <ArtistBar key={artist.name} artist={artist} max={maxArtistShows}
                        onNavigate={() => router.push(`/browse?artist=${encodeURIComponent(artist.name)}`)} />
                    ))}
                  </div>
                  {topArtists.length > 5 && (
                    <button onClick={() => setShowAllArtists(v => !v)}
                      className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                      {showAllArtists ? '← Show less' : `View all ${topArtists.length} artists →`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── All Shows section ── */}
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
              {/* Header: view toggle + count */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* View mode toggle */}
                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                    {(['shows', 'sets', 'festivals'] as ViewMode[]).map((m, i) => (
                      <button key={m} onClick={() => setViewMode(m)}
                        className={`px-3 py-1.5 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          viewMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}>{m}</button>
                    ))}
                  </div>
                  {/* Sets sub-view */}
                  {viewMode === 'sets' && (
                    <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                      {(['card', 'table'] as SetsSubView[]).map((m, i) => (
                        <button key={m} onClick={() => setSetsSubView(m)}
                          className={`px-2.5 py-1.5 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                            setsSubView === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}>{m}</button>
                      ))}
                    </div>
                  )}
                  {selectedYear && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/20 text-primary text-xs font-semibold">
                      {selectedYear}
                      <button onClick={() => { setSelectedYear(null); setCapFilter('all') }} className="hover:opacity-70">×</button>
                    </span>
                  )}
                  {capFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{ background: CAP_BY_KEY[capFilter]?.color + '33', color: CAP_BY_KEY[capFilter]?.color }}>
                      {CAP_BY_KEY[capFilter]?.legendLabel}
                      <button onClick={() => handleCap('all')} className="hover:opacity-70">×</button>
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {viewMode === 'shows' ? `${billGroups.length} shows` :
                   viewMode === 'festivals' ? `${festivalGroups.length} festivals` :
                   `${setsFiltered.length.toLocaleString()} sets`}
                </span>
              </div>

              {/* ── SHOWS VIEW ── */}
              {viewMode === 'shows' && (
                <div className="divide-y divide-border">
                  {billGroups.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">No shows match this filter.</div>
                  ) : billGroups.map(group => {
                    const isExpanded = expandedBills.has(group.key)
                    const supporters = group.shows.slice(1)
                    const MAX_INLINE = 3
                    const future = isFuture(group.date)

                    return (
                      <div key={group.key} className={future ? 'bg-amber-500/5' : ''}>
                        {/* Bill header */}
                        <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                          {/* Remove headliner */}
                          <button
                            onClick={() => removeShow(group.headliner.show_id)}
                            disabled={removingSet.has(group.headliner.show_id)}
                            className="focus:outline-none disabled:opacity-50 flex-shrink-0"
                          >
                            {removingSet.has(group.headliner.show_id)
                              ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                              : <HeartIcon size={5} />}
                          </button>

                          {/* Date */}
                          <div className="w-24 flex-shrink-0">
                            <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(group.date)}</p>
                            {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                          </div>

                          {/* Artists */}
                          <div className="flex-1 min-w-0">
                            {/* Headliner */}
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {group.headliner.artist.spotify_artist_id ? (
                                <SpotifyLink artistId={group.headliner.artist.spotify_artist_id} name={group.headliner.artist.artist_name} />
                              ) : (
                                <span className="text-sm font-medium text-foreground">{group.headliner.artist.artist_name}</span>
                              )}
                              {group.headliner.setlist_url && <SetlistLink url={group.headliner.setlist_url} />}
                            </div>
                            {/* Supporters */}
                            {supporters.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {supporters.slice(0, MAX_INLINE).map((s, i) => (
                                  <span key={s.show_id} className="text-[11px] text-muted-foreground">
                                    {i > 0 && <span className="mx-0.5">·</span>}
                                    {s.artist.spotify_artist_id ? (
                                      <a href={`https://open.spotify.com/artist/${s.artist.spotify_artist_id}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="hover:text-primary transition-colors">
                                        {s.artist.artist_name}
                                      </a>
                                    ) : s.artist.artist_name}
                                  </span>
                                ))}
                                {supporters.length > MAX_INLINE && (
                                  <span className="text-[11px] text-muted-foreground/60">+ {supporters.length - MAX_INLINE} more</span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Venue + capacity */}
                          <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
                            <span className="text-sm text-muted-foreground">{group.venue_name}</span>
                            <CapacityBadge category={group.capacity_category} />
                          </div>

                          {/* Expand toggle (only for multi-artist bills) */}
                          {group.shows.length > 1 && (
                            <button
                              onClick={() => setExpandedBills(prev => {
                                const n = new Set(prev)
                                n.has(group.key) ? n.delete(group.key) : n.add(group.key)
                                return n
                              })}
                              className="text-muted-foreground text-[10px] flex-shrink-0 hover:text-foreground transition-colors"
                            >
                              {isExpanded ? '▲' : '▼'}
                            </button>
                          )}
                        </div>

                        {/* Expanded individual sets within bill */}
                        {isExpanded && (
                          <div className="border-t border-border/40 bg-background/50 divide-y divide-border/30">
                            {group.shows.map((show, idx) => (
                              <div key={show.show_id} className="flex items-center gap-3 px-4 py-2 pl-12">
                                <button
                                  onClick={() => removeShow(show.show_id)}
                                  disabled={removingSet.has(show.show_id)}
                                  className="focus:outline-none disabled:opacity-50 flex-shrink-0"
                                >
                                  {removingSet.has(show.show_id)
                                    ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                    : <HeartIcon size={4} />}
                                </button>
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground/60 w-4 flex-shrink-0">{idx + 1}</span>
                                  {show.artist.spotify_artist_id ? (
                                    <SpotifyLink artistId={show.artist.spotify_artist_id} name={show.artist.artist_name} />
                                  ) : (
                                    <span className="text-xs text-foreground">{show.artist.artist_name}</span>
                                  )}
                                  {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                </div>
                                {idx === 0 && <span className="text-[10px] text-primary/60 flex-shrink-0">headliner</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── FESTIVALS VIEW ── */}
              {viewMode === 'festivals' && (
                <div className="divide-y divide-border">
                  {festivalGroups.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">No festival shows in your history.</div>
                  ) : festivalGroups.map(group => {
                    const isExpanded = expandedBills.has(group.key)
                    return (
                      <div key={group.key}>
                        <div
                          className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setExpandedBills(prev => {
                            const n = new Set(prev)
                            n.has(group.key) ? n.delete(group.key) : n.add(group.key)
                            return n
                          })}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{group.festival_name}</span>
                              <span className="text-xs text-muted-foreground">{group.year}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span style={{ color: TEAL }} className="font-medium">{group.shows.length} acts</span>
                              <span>·</span>
                              <span>{group.venue_name}</span>
                              <span>·</span>
                              <span>
                                {group.date_from === group.date_to
                                  ? fmtDate(group.date_from)
                                  : `${fmtDate(group.date_from)} – ${fmtDate(group.date_to)}`}
                              </span>
                            </div>
                          </div>
                          <span className="text-muted-foreground text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border/40 bg-background/50 divide-y divide-border/30">
                            {group.shows.map(show => (
                              <div key={show.show_id} className="flex items-center gap-3 px-4 py-2 pl-8">
                                <button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)} className="focus:outline-none disabled:opacity-50 flex-shrink-0">
                                  {removingSet.has(show.show_id)
                                    ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                    : <HeartIcon size={4} />}
                                </button>
                                <span className="text-xs text-muted-foreground/60 w-20 flex-shrink-0 tabular-nums">{fmtDate(show.date)}</span>
                                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                  {show.artist.spotify_artist_id ? (
                                    <SpotifyLink artistId={show.artist.spotify_artist_id} name={show.artist.artist_name} />
                                  ) : (
                                    <span className="text-xs text-foreground">{show.artist.artist_name}</span>
                                  )}
                                  {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── SETS VIEW ── */}
              {viewMode === 'sets' && (
                <>
                  {setsSubView === 'card' && (
                    <>
                      <div className="hidden md:grid bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider"
                        style={{ gridTemplateColumns: '40px 120px 1fr' }}>
                        <div className="px-3 py-3" />
                        <button className="px-3 py-3 text-left hover:text-foreground" onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                        <div className="px-3 py-3 flex gap-3">
                          <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                          <span className="text-muted-foreground/30">/</span>
                          <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                        </div>
                      </div>
                      <div className="md:hidden grid bg-muted border-b border-border px-3 py-2" style={{ gridTemplateColumns: '28px 80px 1fr' }}>
                        <div />
                        <button className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground" onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                        <div className="flex gap-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                          <span className="text-muted-foreground/30">/</span>
                          <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                        </div>
                      </div>
                      <div className="divide-y divide-border">
                        {setsFiltered.length === 0 ? (
                          <div className="text-center py-10 text-muted-foreground">No shows match this filter.</div>
                        ) : currentShows.map(show => {
                          const removing = removingSet.has(show.show_id)
                          const future   = isFuture(show.date)
                          return (
                            <div key={show.show_id} className={`hover:bg-muted/30 transition-colors ${future ? 'bg-amber-500/5' : ''}`}>
                              <div className="hidden md:grid items-center" style={{ gridTemplateColumns: '40px 120px 1fr' }}>
                                <div className="px-3 py-3.5 flex items-center">
                                  <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                    {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                  </button>
                                </div>
                                <div className="px-3 py-3.5">
                                  <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                                </div>
                                <div className="px-3 py-3.5 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                      className="text-sm font-medium text-primary hover:opacity-80 hover:underline">
                                      {show.artist.artist_name}
                                    </button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                      className="text-[13px] text-muted-foreground hover:text-primary hover:underline">
                                      {show.venue.venue_name}
                                    </button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                  </div>
                                </div>
                              </div>
                              <div className="md:hidden grid items-center px-3 py-2.5" style={{ gridTemplateColumns: '28px 80px 1fr' }}>
                                <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                  {removing ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={4} />}
                                </button>
                                <div>
                                  <p className="text-[11px] text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                      className="text-[11px] font-medium text-primary hover:opacity-80 truncate">
                                      {show.artist.artist_name}
                                    </button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                      className="text-[10px] text-muted-foreground hover:text-primary truncate">
                                      {show.venue.venue_name}
                                    </button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}

                  {setsSubView === 'table' && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          <tr>
                            <th className="px-3 py-3 w-10" />
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleSort('date')}>Date{sortArrow('date')}</th>
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</th>
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</th>
                            <th className="px-3 py-3 text-left">Festival</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {setsFiltered.length === 0 ? (
                            <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No shows match this filter.</td></tr>
                          ) : currentShows.map(show => {
                            const removing = removingSet.has(show.show_id)
                            const future   = isFuture(show.date)
                            return (
                              <tr key={show.show_id} className={`hover:bg-muted/30 transition-colors ${future ? 'bg-amber-500/5' : ''}`}>
                                <td className="px-3 py-3">
                                  <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                    {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                  </button>
                                </td>
                                <td className="px-3 py-3 whitespace-nowrap text-foreground">
                                  {fmtDate(show.date)}
                                  {future && <span className="ml-1.5 text-[9px] font-semibold text-amber-400 bg-amber-400/15 px-1 py-px rounded">upcoming</span>}
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                                      className="text-primary hover:opacity-80 hover:underline text-left">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                                      className="text-muted-foreground hover:text-primary hover:underline text-left">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-muted-foreground">
                                  {show.festival_name || <span className="text-muted-foreground/40">—</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Pagination (Sets view only) */}
                  {totalPages > 1 && (
                    <div className="bg-muted px-4 py-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <button onClick={() => handlePage(page - 1)} disabled={page === 1}
                          className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">Previous</button>
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
                          className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">Next</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}
