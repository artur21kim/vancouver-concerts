'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, PieChart, Pie, Cell,
} from 'recharts'
import Navigation from '@/app/components/Navigation'

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

function headlinerScore(show: Show): number {
  if (show.match_score != null && show.match_score > 0) return show.match_score * 1_000_000
  if (show.artist.monthly_listeners != null) return show.artist.monthly_listeners
  return 0
}

// ── Bill group ────────────────────────────────────────────────────────────────
type BillGroup = {
  key: string; date: string; venue_id: number; venue_name: string
  capacity_category: string | null; shows: Show[]; headliner: Show
  isFestival: boolean; festival_name: string | null
}

function buildBillGroups(shows: Show[]): BillGroup[] {
  const map = new Map<string, Show[]>()
  for (const s of shows) {
    const key = `${s.date}__${s.venue.venue_id}`
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(s)
  }
  const groups: BillGroup[] = []
  for (const [key, gs] of map) {
    const sorted = [...gs].sort((a, b) => headlinerScore(b) - headlinerScore(a))
    groups.push({
      key, date: sorted[0].date, venue_id: sorted[0].venue.venue_id,
      venue_name: sorted[0].venue.venue_name, capacity_category: sorted[0].venue.capacity_category,
      shows: sorted, headliner: sorted[0],
      isFestival: gs.some(isFestivalShow),
      festival_name: gs.find(s => s.festival_name)?.festival_name ?? null,
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
function YearTip({ active, payload, label, viewMode }: any) {
  if (!active || !payload?.length) return null
  const val = payload.find((p: any) => p.dataKey === 'shows')?.value
  const label2 = viewMode === 'sets' ? 'sets' : viewMode === 'festivals' ? 'festivals' : 'shows'
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {val != null && val > 0 && <p className="text-primary">{val} {val === 1 ? label2.slice(0,-1) : label2}</p>}
    </div>
  )
}

// SCRUM-78: removed `future` display from MonthTip — orange line removed from charts
function MonthTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const shows = payload.find((p: any) => p.dataKey === 'shows')?.value ?? 0
  const songs = payload.find((p: any) => p.dataKey === 'songs')?.value
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {shows > 0 && <p className="text-primary">{shows} {shows === 1 ? 'show' : 'shows'}</p>}
      {songs != null && songs > 0 && <p style={{ color: SPOTIFY_GREEN }}>{songs} songs added</p>}
    </div>
  )
}

// ── Donut tooltip ─────────────────────────────────────────────────────────────
function DonutTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload
  if (!entry) return null
  return (
    <div className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground">{entry.name}</p>
      <p style={{ color: TEAL }} className="tabular-nums">{entry.value} shows</p>
    </div>
  )
}

// ── Year-segmented artist bars ────────────────────────────────────────────────
function ArtistYearBars({ artists, max, onNavigate }: {
  artists: {
    name: string; spotifyId: string | null; total: number
    byCapacity: Record<string, number>
    showsByYear: Record<string, { venue: string; capKey: CapFilter }[]>
  }[]
  max: number; onNavigate: (name: string) => void
}) {
  const [tooltip, setTooltip] = useState<{ artist: string; year: string; venue: string; capKey: CapFilter; x: number; y: number } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {artists.map((artist) => {
        const totalWidth = max > 0 ? (artist.total / max) * 100 : 0
        const years = Object.keys(artist.showsByYear).sort()
        const yearSegments = years.flatMap(year => {
          const yearShows = artist.showsByYear[year]
          return yearShows.map((show, idx) => ({
            year,
            showIdx: idx,
            totalInYear: yearShows.length,
            venue: show.venue,
            capKey: show.capKey,
            color: CAP_BY_KEY[show.capKey]?.color ?? 'rgba(156,163,175,0.75)',
            widthPct: (1 / artist.total) * 100,
          }))
        })

        return (
          <div key={artist.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <button onClick={() => onNavigate(artist.name)}
                className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right"
                title={artist.name}>{artist.name}</button>
              {artist.spotifyId && <SpotifyLink artistId={artist.spotifyId} />}
            </div>

            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
                  {yearSegments.map((seg, i) => {
                    const isFirst = i === 0, isLast = i === yearSegments.length - 1
                    const isYearBoundary = i > 0 && yearSegments[i - 1].year !== seg.year
                    return (
                      <div
                        key={`${seg.year}-${seg.showIdx}`}
                        className="h-full flex items-center justify-center overflow-hidden cursor-default"
                        style={{
                          width: `${seg.widthPct}%`,
                          backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? `1px solid rgba(0,0,0,${isYearBoundary ? 0.3 : 0.12})` : undefined,
                        }}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, year: seg.year, venue: seg.venue, capKey: seg.capKey, x: e.clientX - rect.left, y: 0 })
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span
                          className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                          style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
                        >
                          {seg.year}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {tooltip?.artist === artist.name && (
                <div
                  className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}
                >
                  <p className="font-semibold text-foreground">{artist.name} · {tooltip.year}</p>
                  {tooltip.venue && <p className="text-muted-foreground mt-0.5">{tooltip.venue}</p>}
                  <p className="mt-0.5" style={{ color: CAP_BY_KEY[tooltip.capKey]?.color ?? TEAL }}>
                    {CAP_BY_KEY[tooltip.capKey]?.legendLabel ?? ''}
                  </p>
                </div>
              )}
            </div>

            <span className="text-xs tabular-nums flex-shrink-0 w-16 text-right" style={{ color: TEAL }}>
              {artist.total} {artist.total === 1 ? 'show' : 'shows'}
            </span>
          </div>
        )
      })}

      <div className="flex items-center gap-3 pt-2 border-t border-border text-[10px] text-muted-foreground flex-wrap">
        {CAP_KEYS.filter(k => k !== 'unknown').map(key => (
          <span key={key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CAP_BY_KEY[key].color }} />
            {CAP_BY_KEY[key].legendLabel}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Venue year-segmented bars ─────────────────────────────────────────────────
function VenueYearBars({ venues, max, onNavigate }: {
  venues: {
    name: string; total: number
    byCapacity: Record<string, number>
    showsByYear: Record<string, { artist: string; capKey: CapFilter }[]>
  }[]
  max: number; onNavigate: (name: string) => void
}) {
  const [tooltip, setTooltip] = useState<{ venue: string; year: string; artist: string; capKey: CapFilter; x: number } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {venues.map((venue) => {
        const totalWidth = max > 0 ? (venue.total / max) * 100 : 0
        const yearSegments = Object.keys(venue.showsByYear).sort().flatMap(year => {
          const yearShows = venue.showsByYear[year]
          return yearShows.map((show, showIdx) => ({
            year, showIdx, totalInYear: yearShows.length,
            artist: show.artist, capKey: show.capKey,
            color: CAP_BY_KEY[show.capKey]?.color ?? 'rgba(156,163,175,0.75)',
            widthPct: (1 / venue.total) * 100,
          }))
        })

        return (
          <div key={venue.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <button onClick={() => onNavigate(venue.name)}
                className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right"
                title={venue.name}>{venue.name}</button>
            </div>
            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
                  {yearSegments.map((seg, i) => {
                    const isFirst = i === 0, isLast = i === yearSegments.length - 1
                    const isYearBoundary = i > 0 && yearSegments[i - 1].year !== seg.year
                    return (
                      <div
                        key={`${seg.year}-${seg.showIdx}`}
                        className="h-full flex items-center justify-center overflow-hidden cursor-default"
                        style={{
                          width: `${seg.widthPct}%`,
                          backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? `1px solid rgba(0,0,0,${isYearBoundary ? 0.3 : 0.12})` : undefined,
                        }}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ venue: venue.name, year: seg.year, artist: seg.artist, capKey: seg.capKey, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                          style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                          {seg.year}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {tooltip?.venue === venue.name && (
                <div className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}>
                  <p className="font-semibold text-foreground">{venue.name} · {tooltip.year}</p>
                  <p className="text-muted-foreground mt-0.5">{tooltip.artist}</p>
                  <p className="mt-0.5" style={{ color: CAP_BY_KEY[tooltip.capKey]?.color ?? TEAL }}>
                    {CAP_BY_KEY[tooltip.capKey]?.legendLabel ?? ''}
                  </p>
                </div>
              )}
            </div>
            <span className="text-xs tabular-nums flex-shrink-0 w-16 text-right" style={{ color: TEAL }}>
              {venue.total} {venue.total === 1 ? 'show' : 'shows'}
            </span>
          </div>
        )
      })}

      <div className="flex items-center gap-3 pt-2 border-t border-border text-[10px] text-muted-foreground flex-wrap">
        {CAP_KEYS.filter(k => k !== 'unknown').map(key => (
          <span key={key} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: CAP_BY_KEY[key].color }} />
            {CAP_BY_KEY[key].legendLabel}
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MyShowsClient({
  shows: initialShows,
  spotifySongs,
  readOnly = false,
  username,
}: {
  shows: Show[]
  spotifySongs: { added_at: string }[]
  readOnly?: boolean
  username?: string
}) {
  const router  = useRouter()
  const supabase = createClient()

  const [shows, setShows]                       = useState(initialShows)
  const [viewMode, setViewMode]                 = useState<ViewMode>('shows')
  const [setsSubView, setSetsSubView]           = useState<SetsSubView>('card')
  const [sortField, setSortField]               = useState<SortField>('date')
  const [sortDir, setSortDir]                   = useState<SortDir>('desc')
  const [removingSet, setRemovingSet]           = useState<Set<number>>(new Set())
  const [page, setPage]                         = useState(1)
  const [pageInput, setPageInput]               = useState('1')
  const [selectedYear, setSelectedYear]         = useState<string | null>(null)
  const [capFilter, setCapFilter]               = useState<CapFilter>('all')
  const [chartSection, setChartSection]         = useState<'artists' | 'venues'>('artists')
  const [showAllArtists, setShowAllArtists]     = useState(false)
  const [showAllVenues, setShowAllVenues]       = useState(false)
  const [expandedBills, setExpandedBills]       = useState<Set<string>>(new Set())
  const [isPlaying, setIsPlaying]               = useState(false)

  // Unadded CTA — own profile only
  const [unaddedArtists, setUnaddedArtists]         = useState<UnaddedArtist[]>([])
  const [unaddedDismissed, setUnaddedDismissed]     = useState(false)
  const [unaddedExpanded, setUnaddedExpanded]       = useState(false)
  const [addingUnadded, setAddingUnadded]           = useState(false)
  const [sessionShowsModified, setSessionShowsModified] = useState(false)

  const PER_PAGE   = 50
  const hasSpotify = spotifySongs.length > 0
  const anyFilterActive = selectedYear !== null || capFilter !== 'all'

  // ── Unadded check ────────────────────────────────────────────────────────
  const checkUnaddedArtists = useCallback(async () => {
    if (readOnly) return
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const addedShowIds = shows.map(s => s.show_id)
      if (!addedShowIds.length) return

      const { data: coBilled } = await supabase
        .from('fact_shows')
        .select('show_id, date, venue_id, show_type, dim_artist ( artist_id, artist_name, spotify_artist_id ), dim_venue ( venue_name )')
        .neq('show_type', 'comedy')
        .not('show_id', 'in', `(${addedShowIds.join(',')})`)

      if (!coBilled?.length) return
      const userBills = new Set(shows.map(s => `${s.date}__${s.venue.venue_id}`))
      const unadded: UnaddedArtist[] = []
      for (const show of coBilled) {
        if (!userBills.has(`${show.date}__${show.venue_id}`)) continue
        const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
        const venue  = Array.isArray(show.dim_venue)  ? show.dim_venue[0]  : show.dim_venue
        if (!artist) continue
        unadded.push({ show_id: show.show_id, artist_name: artist.artist_name, spotify_artist_id: artist.spotify_artist_id ?? null, date: show.date, venue_name: venue?.venue_name ?? '' })
      }
      setUnaddedArtists(unadded)
    } catch (e) { console.error('Error checking unadded:', e) }
  }, [shows, supabase, readOnly])

  useEffect(() => { checkUnaddedArtists() }, [])
  useEffect(() => { if (sessionShowsModified) { checkUnaddedArtists(); setSessionShowsModified(false) } }, [sessionShowsModified])

  // ── Base stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const past   = shows.filter(s => !isFuture(s.date))
    const future = shows.filter(s =>  isFuture(s.date))
    const sortedPast = [...past].sort((a, b) => a.date.localeCompare(b.date))
    return {
      total: shows.length,
      artists: new Set(shows.map(s => s.artist.artist_id)).size,
      venues:  new Set(shows.map(s => s.venue.venue_id)).size,
      past, future,
      firstShow: sortedPast[0]                     ?? null,
      lastShow:  sortedPast[sortedPast.length - 1] ?? null,
    }
  }, [shows])

  // ── Spotify per month ─────────────────────────────────────────────────────
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

  const firstSpotifyYear = useMemo(() => Object.keys(spotifyByYearMonth).sort()[0] ?? null, [spotifyByYearMonth])

  // ── Year-filtered set ─────────────────────────────────────────────────────
  const yearFiltered = useMemo(() => {
    if (!selectedYear) return shows
    return shows.filter(s => s.date.split('-')[0] === selectedYear)
  }, [shows, selectedYear])

  // SCRUM-78: yearTimelineData — counts all shows per year (no future/past split).
  // Orange upcoming Area series removed; teal line now represents full "My Shows" count.
  const yearTimelineData = useMemo(() => {
    let src: (Show | BillGroup)[]

    if (viewMode === 'festivals') {
      src = shows.filter(isFestivalShow)
    } else if (viewMode === 'shows') {
      const groups = buildBillGroups(shows.filter(s => !isFestivalShow(s)))
      src = groups
    } else {
      src = shows
    }

    const byYear: Record<string, number> = {}
    for (const item of src) {
      const date = 'date' in item ? item.date : (item as Show).date
      const y = date.split('-')[0]
      byYear[y] = (byYear[y] ?? 0) + 1
    }
    return Object.entries(byYear)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([year, count]) => ({ year, shows: count }))
  }, [shows, viewMode])

  const availableYears = useMemo(
    () => yearTimelineData.map(d => d.year),
    [yearTimelineData]
  )

  // SCRUM-79: Slideshow — advance selectedYear through availableYears every 1500ms.
  // Stops automatically at the last year (no loop).
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      setSelectedYear(prev => {
        if (!prev) { setIsPlaying(false); return prev }
        const idx = availableYears.indexOf(prev)
        if (idx === -1 || idx >= availableYears.length - 1) {
          setIsPlaying(false)
          return prev
        }
        return availableYears[idx + 1]
      })
    }, 1500)
    return () => clearInterval(id)
  }, [isPlaying, availableYears])

  // SCRUM-78: monthTimelineData — counts all shows per month (no future tracking).
  const monthTimelineData = useMemo(() => {
    if (!selectedYear) return []
    const src = viewMode === 'festivals'
      ? shows.filter(isFestivalShow).filter(s => s.date.split('-')[0] === selectedYear)
      : shows.filter(s => s.date.split('-')[0] === selectedYear)
    const byMonth: Record<number, number> = {}
    for (let m = 0; m < 12; m++) byMonth[m] = 0
    for (const s of src) {
      const m = parseInt(s.date.split('-')[1]) - 1
      byMonth[m]++
    }
    const songsByMonth = spotifyByYearMonth[selectedYear] ?? {}
    const hasSongs = Object.keys(songsByMonth).length > 0
    return Array.from({ length: 12 }, (_, m) => ({
      month: MONTHS[m], shows: byMonth[m],
      ...(hasSpotify && hasSongs ? { songs: songsByMonth[m] ?? 0 } : {}),
    }))
  }, [shows, selectedYear, viewMode, spotifyByYearMonth, hasSpotify])

  const firstYear = stats.firstShow?.date.split('-')[0]
  const lastYear  = stats.lastShow?.date.split('-')[0]
  const drilldownHasSpotify = selectedYear
    ? hasSpotify && Object.keys(spotifyByYearMonth[selectedYear] ?? {}).length > 0
    : false

  const timelineLegendLabel = viewMode === 'sets' ? 'Sets per year'
    : viewMode === 'festivals' ? 'Festivals per year'
    : 'Shows per year'

  // ── Top artists ───────────────────────────────────────────────────────────
  const topArtists = useMemo(() => {
    const src = viewMode === 'festivals' ? yearFiltered.filter(isFestivalShow) : yearFiltered
    const map: Record<number, {
      name: string; spotifyId: string | null; total: number
      byCapacity: Record<string, number>; byVenue: Record<string, number>
      showsByYear: Record<string, { venue: string; capKey: CapFilter }[]>
    }> = {}
    for (const s of src) {
      const id     = s.artist.artist_id
      const capKey = getCapMeta(s.venue.capacity_category).key as CapFilter
      const year   = s.date.split('-')[0]
      if (!map[id]) map[id] = { name: s.artist.artist_name, spotifyId: s.artist.spotify_artist_id, total: 0, byCapacity: {}, byVenue: {}, showsByYear: {} }
      map[id].total++
      map[id].byCapacity[capKey] = (map[id].byCapacity[capKey] ?? 0) + 1
      map[id].byVenue[s.venue.venue_name] = (map[id].byVenue[s.venue.venue_name] ?? 0) + 1
      if (!map[id].showsByYear[year]) map[id].showsByYear[year] = []
      map[id].showsByYear[year].push({ venue: s.venue.venue_name, capKey })
    }
    return Object.values(map)
      .map(a => {
        const venueBreakdown = Object.entries(a.byVenue).map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count)
        return { ...a, venueBreakdown }
      })
      .sort((a, b) => b.total - a.total)
  }, [yearFiltered, viewMode])

  const maxArtistShows = topArtists[0]?.total ?? 1

  const topVenues = useMemo(() => {
    const src = viewMode === 'festivals' ? yearFiltered.filter(isFestivalShow) : yearFiltered
    const map: Record<number, {
      name: string; total: number
      byCapacity: Record<string, number>
      showsByYear: Record<string, { artist: string; capKey: CapFilter }[]>
    }> = {}
    for (const s of src) {
      const id     = s.venue.venue_id
      const capKey = getCapMeta(s.venue.capacity_category).key as CapFilter
      const year   = s.date.split('-')[0]
      if (!map[id]) map[id] = { name: s.venue.venue_name, total: 0, byCapacity: {}, showsByYear: {} }
      map[id].total++
      map[id].byCapacity[capKey] = (map[id].byCapacity[capKey] ?? 0) + 1
      if (!map[id].showsByYear[year]) map[id].showsByYear[year] = []
      map[id].showsByYear[year].push({ artist: s.artist.artist_name, capKey })
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [yearFiltered, viewMode])

  const maxVenueShows = topVenues[0]?.total ?? 1

  // ── Donut ─────────────────────────────────────────────────────────────────
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
      .map(key => ({
        name: CAP_BY_KEY[key].legendLabel,
        shortName: CAP_BY_KEY[key].legendLabel.split(' ')[0],
        key, value: counts[key] ?? 0, color: CAP_BY_KEY[key].color
      }))
      .filter(d => d.value > 0)
    const breakdown: Record<string, { name: string; count: number }[]> = {}
    for (const [k, venues] of Object.entries(venueByCap)) {
      breakdown[k] = Object.values(venues).sort((a, b) => b.count - a.count)
    }
    return { donutData: donut, venueBreakdown: breakdown }
  }, [yearFiltered, viewMode])

  // ── Bill groups ───────────────────────────────────────────────────────────
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
      const key = `${s.festival_name ?? 'Unknown'}__${s.date.split('-')[0]}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(s)
    }
    return Array.from(map.entries()).map(([key, fs]) => {
      const [name] = key.split('__')
      const sorted = [...fs].sort((a, b) => b.date.localeCompare(a.date))
      const dates  = fs.map(s => s.date).sort()
      return { key, festival_name: name, year: fs[0].date.split('-')[0], shows: sorted, date_from: dates[0], date_to: dates[dates.length - 1], venue_name: fs[0].venue.venue_name }
    }).sort((a, b) => b.date_to.localeCompare(a.date_to))
  }, [yearFiltered])

  // ── Sets (sorted) ─────────────────────────────────────────────────────────
  const setsFiltered = useMemo(() => {
    const src = capFilter === 'all' ? yearFiltered : yearFiltered.filter(s => getCapMeta(s.venue.capacity_category).key === capFilter)
    return [...src].sort((a, b) => {
      let av: string, bv: string
      switch (sortField) {
        case 'date':     av = a.date; bv = b.date; break
        case 'artist':   av = a.artist.artist_name.toLowerCase(); bv = b.artist.artist_name.toLowerCase(); break
        case 'venue':    av = a.venue.venue_name.toLowerCase(); bv = b.venue.venue_name.toLowerCase(); break
        case 'added_at': av = a.added_at; bv = b.added_at; break
        default:         av = ''; bv = ''
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1
      if (av > bv) return sortDir === 'asc' ? 1 : -1
      return 0
    })
  }, [yearFiltered, capFilter, sortField, sortDir])

  const totalPages   = Math.ceil(setsFiltered.length / PER_PAGE)
  const currentShows = setsFiltered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // ── Dynamic stats ─────────────────────────────────────────────────────────
  const dynamicStats = useMemo(() => {
    if (viewMode === 'shows') {
      const sets    = billGroups.reduce((n, g) => n + g.shows.length, 0)
      const showsC  = billGroups.length
      const artists = new Set(billGroups.flatMap(g => g.shows.map(s => s.artist.artist_id))).size
      const venues  = new Set(billGroups.flatMap(g => g.shows.map(s => s.venue.venue_id))).size
      return { sets, shows: showsC, artists, venues, festivals: 0 }
    }
    if (viewMode === 'sets') {
      const sets    = setsFiltered.length
      const artists = new Set(setsFiltered.map(s => s.artist.artist_id)).size
      const venues  = new Set(setsFiltered.map(s => s.venue.venue_id)).size
      return { sets, shows: 0, artists, venues, festivals: 0 }
    }
    const sets      = festivalGroups.reduce((n, g) => n + g.shows.length, 0)
    const festivals = festivalGroups.length
    const artists   = new Set(festivalGroups.flatMap(g => g.shows.map(s => s.artist.artist_id))).size
    const venues    = new Set(festivalGroups.flatMap(g => g.shows.map(s => s.venue.venue_id))).size
    return { sets, shows: 0, artists, venues, festivals }
  }, [viewMode, billGroups, setsFiltered, festivalGroups])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleCap = useCallback((key: CapFilter) => {
    setCapFilter(prev => prev === key ? 'all' : key)
    setPage(1); setPageInput('1')
  }, [])

  const handleYearClick = useCallback((year: string) => {
    setIsPlaying(false)
    setSelectedYear(prev => prev === year ? null : year)
    setCapFilter('all'); setPage(1); setPageInput('1'); setShowAllArtists(false)
  }, [])

  // SCRUM-79: Play/pause handler — starts slideshow from first year when entering play mode
  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false)
    } else {
      if (!selectedYear && availableYears.length > 0) {
        setSelectedYear(availableYears[0])
        setCapFilter('all'); setPage(1); setPageInput('1'); setShowAllArtists(false)
      }
      setIsPlaying(true)
    }
  }, [isPlaying, selectedYear, availableYears])

  const clearAll = useCallback(() => {
    setIsPlaying(false)
    setSelectedYear(null); setCapFilter('all')
    setPage(1); setPageInput('1'); setShowAllArtists(false)
  }, [])

  const removeShow = async (id: number) => {
    if (readOnly) return
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

  const sortArrow = (f: SortField) => sortField === f ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''

  const addUnaddedAll = async () => {
    if (readOnly) return
    if (!unaddedArtists.length) return
    setAddingUnadded(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const records = unaddedArtists.map(a => ({ user_id: user.id, show_id: a.show_id, status: 'attended', source: 'manual' }))
      await supabase.from('user_shows').upsert(records, { onConflict: 'user_id,show_id' })
      const { data: newShows } = await supabase
        .from('user_shows')
        .select(`show_id, added_at, source, fact_shows ( show_id, date, setlist_url, show_type, festival_name, dim_artist ( artist_id, artist_name, monthly_listeners, spotify_artist_id ), dim_venue ( venue_id, venue_name, capacity, capacity_category ) )`)
        .eq('user_id', user.id).order('added_at', { ascending: false })
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
      setUnaddedArtists([]); setUnaddedDismissed(true)
    } catch (e) { console.error('Error adding unadded:', e) }
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

          <h1 className="text-3xl md:text-4xl font-bold text-foreground">
            {readOnly ? `${username}'s Shows` : 'My Shows'}
            {selectedYear && <span className="text-muted-foreground font-normal"> · {selectedYear}</span>}
            {!selectedYear && capFilter !== 'all' && <span className="text-muted-foreground font-normal"> · {CAP_BY_KEY[capFilter]?.legendLabel}</span>}
          </h1>

          {/* ── Unadded CTA ── */}
          {!readOnly && !unaddedDismissed && unaddedArtists.length > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground mb-1">
                    {unaddedArtists.length} artist{unaddedArtists.length !== 1 ? 's' : ''} from shows you attended {unaddedArtists.length !== 1 ? "haven't" : "hasn't"} been added yet
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
                    <button onClick={addUnaddedAll} disabled={addingUnadded}
                      className="text-xs font-semibold px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50">
                      {addingUnadded ? 'Adding...' : 'Add All'}
                    </button>
                    <button onClick={() => setUnaddedExpanded(v => !v)} className="text-xs text-primary hover:opacity-80 transition">
                      {unaddedExpanded ? 'Show less' : 'Review'}
                    </button>
                  </div>
                </div>
                <button onClick={() => setUnaddedDismissed(true)} className="text-muted-foreground hover:text-foreground transition text-lg leading-none flex-shrink-0">×</button>
              </div>
            </div>
          )}

          {/* ── Concert Timeline ── */}
          {yearTimelineData.length > 0 && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-lg md:text-xl font-bold text-foreground">Concert Timeline</h2>
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    {viewMode === 'shows' && <>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.sets}</span>
                        <span className="text-muted-foreground"> sets</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.shows}</span>
                        <span className="text-muted-foreground"> shows</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.artists}</span>
                        <span className="text-muted-foreground"> artists</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.venues}</span>
                        <span className="text-muted-foreground"> venues</span>
                      </span>
                    </>}
                    {viewMode === 'sets' && <>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.sets}</span>
                        <span className="text-muted-foreground"> sets</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.artists}</span>
                        <span className="text-muted-foreground"> artists</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.venues}</span>
                        <span className="text-muted-foreground"> venues</span>
                      </span>
                    </>}
                    {viewMode === 'festivals' && <>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.sets}</span>
                        <span className="text-muted-foreground"> sets</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.festivals}</span>
                        <span className="text-muted-foreground"> festivals</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.artists}</span>
                        <span className="text-muted-foreground"> artists</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: TEAL }}>{dynamicStats.venues}</span>
                        <span className="text-muted-foreground"> venues</span>
                      </span>
                    </>}
                  </div>
                  {anyFilterActive && (
                    <button onClick={clearAll}
                      className="px-2.5 py-0.5 rounded-md border border-destructive text-destructive text-xs font-semibold hover:bg-destructive/10 transition-colors">
                      Clear All
                    </button>
                  )}
                  {selectedYear && (
                    <button onClick={() => { setIsPlaying(false); setSelectedYear(null); setCapFilter('all') }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/20 text-primary text-xs font-semibold hover:bg-primary/30 transition-colors">
                      ← {selectedYear}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                    {(['shows', 'sets', 'festivals'] as ViewMode[]).map((m, i) => (
                      <button key={m} onClick={() => setViewMode(m)}
                        className={`px-3 py-1.5 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          viewMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}>{m}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* SCRUM-78: Legend — removed Upcoming entry */}
              <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: '#0d9488' }} />
                  {selectedYear ? (viewMode === 'sets' ? 'Sets' : viewMode === 'festivals' ? 'Festivals' : 'Shows') : timelineLegendLabel}
                </span>
                {drilldownHasSpotify && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SPOTIFY_GREEN }} />
                    Songs added {firstSpotifyYear && <span className="text-muted-foreground/50 ml-0.5">(from {firstSpotifyYear})</span>}
                  </span>
                )}
                {viewMode !== 'sets' && (
                  <span className="text-muted-foreground/50 text-[10px]">
                    {viewMode === 'shows' ? '· Bills with multiple acts count as 1 show' : '· Festival shows only'}
                  </span>
                )}
                {/* SCRUM-79: Play/pause — only available in the year-level all-time view */}
                {!selectedYear && yearTimelineData.length > 1 && (
                  <button
                    onClick={handlePlayPause}
                    title={isPlaying ? 'Pause slideshow' : 'Play year-by-year slideshow'}
                    className={`ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all bg-primary text-primary-foreground shadow-sm hover:opacity-90 hover:shadow-md ${
                      isPlaying ? 'ring-2 ring-primary/40 animate-pulse' : ''
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                        Pause
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                        Animate
                      </>
                    )}
                  </button>
                )}
              </div>

              <div style={{ height: 180 }}>
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
                      {/* SCRUM-78: future Area removed — only teal shows area remains */}
                      <Area yAxisId="shows" type="monotone" dataKey="shows" stroke="#0d9488" strokeWidth={2} fill="url(#gradShows)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          if ((payload.shows ?? 0) === 0) return <g key={`e-${cx}`} />
                          return <circle key={`s-${cx}`} cx={cx} cy={cy} r={3} fill="#0d9488" stroke="var(--background)" strokeWidth={1.5}/>
                        }} activeDot={{ r: 4, fill: '#0d9488' }} />
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
                        {/* SCRUM-78: gradFuture removed — only teal gradient remains */}
                        <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#0d9488" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#0d9488" stopOpacity={0.02}/>
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
                      <Tooltip content={(props: any) => <YearTip {...props} viewMode={viewMode} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="shows" stroke="#0d9488" strokeWidth={2} fill="url(#gradShows)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          if (payload.year === firstYear) return <circle key={`f-${cx}`} cx={cx} cy={cy} r={5} fill="#0d9488" stroke="var(--background)" strokeWidth={2}/>
                          if (payload.year === lastYear && lastYear !== firstYear) return <circle key={`l-${cx}`} cx={cx} cy={cy} r={5} fill="#5eead4" stroke="var(--background)" strokeWidth={2}/>
                          return <circle key={`d-${cx}`} cx={cx} cy={cy} r={3} fill="#0d9488" fillOpacity={0.7}/>
                        }} activeDot={{ r: 5, fill: '#0d9488' }} />
                      {/* SCRUM-78: future Area removed */}
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>

              {selectedYear ? (() => {
                const idx = availableYears.indexOf(selectedYear)
                const prevYear = idx > 0 ? availableYears[idx - 1] : null
                const nextYear = idx < availableYears.length - 1 ? availableYears[idx + 1] : null
                return (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <button
                      onClick={() => { setIsPlaying(false); prevYear && setSelectedYear(prevYear) }}
                      disabled={!prevYear}
                      className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)' }}
                      onMouseEnter={e => { if (prevYear) (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.22)' }}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.12)'}
                    >
                      ‹ {prevYear ?? ''}
                    </button>
                    <span
                      className="px-3 py-1 rounded-full text-xs font-semibold tabular-nums"
                      style={{ background: 'rgba(13,148,136,0.2)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.4)' }}
                    >
                      {selectedYear}
                    </span>
                    <button
                      onClick={() => { setIsPlaying(false); nextYear && setSelectedYear(nextYear) }}
                      disabled={!nextYear}
                      className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                      style={{ background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)' }}
                      onMouseEnter={e => { if (nextYear) (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.22)' }}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.12)'}
                    >
                      {nextYear ?? ''} ›
                    </button>
                  </div>
                )
              })() : (stats.firstShow || stats.lastShow) && (
                <div className="flex items-start justify-between gap-2 mt-2 text-xs text-muted-foreground">
                  {stats.firstShow && <span>First: <span className="text-foreground font-medium">{stats.firstShow.artist.artist_name}</span> · {fmtDate(stats.firstShow.date)}</span>}
                  {stats.lastShow && lastYear !== firstYear && <span className="text-right flex-shrink-0">Last: <span className="text-foreground font-medium">{stats.lastShow.artist.artist_name}</span> · {fmtDate(stats.lastShow.date)}</span>}
                </div>
              )}
            </div>
          )}

          {/* ── Top Artists / Venues + Donut ── */}
          {shows.length > 0 && (
            <div className="flex gap-4">
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <h2 className="text-lg font-bold text-foreground">
                    {chartSection === 'artists' ? 'Top Artists' : 'Top Venues'}
                    {selectedYear && <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedYear}</span>}
                  </h2>
                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                    {(['artists', 'venues'] as const).map((s, i) => (
                      <button key={s} onClick={() => setChartSection(s)}
                        className={`px-2.5 py-1 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          chartSection === s ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}>
                        {s.charAt(0).toUpperCase() + s.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                {chartSection === 'artists' ? (
                  topArtists.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No shows{selectedYear ? ` in ${selectedYear}` : ''}.</p>
                  ) : (
                    <>
                      <ArtistYearBars
                        artists={topArtists.slice(0, showAllArtists ? undefined : 10)}
                        max={maxArtistShows}
                        onNavigate={(name) => router.push(`/browse?artist=${encodeURIComponent(name)}`)}
                      />
                      {topArtists.length > 10 && (
                        <button onClick={() => setShowAllArtists(v => !v)} className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                          {showAllArtists ? '← Show less' : `View all ${topArtists.length} artists \u2192`}
                        </button>
                      )}
                    </>
                  )
                ) : (
                  topVenues.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No shows{selectedYear ? ` in ${selectedYear}` : ''}.</p>
                  ) : (
                    <>
                      <VenueYearBars
                        venues={topVenues.slice(0, showAllVenues ? undefined : 10)}
                        max={maxVenueShows}
                        onNavigate={(name) => router.push(`/browse?venue=${encodeURIComponent(name)}`)}
                      />
                      {topVenues.length > 10 && (
                        <button onClick={() => setShowAllVenues(v => !v)} className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                          {showAllVenues ? '← Show less' : `View all ${topVenues.length} venues \u2192`}
                        </button>
                      )}
                    </>
                  )
                )}
              </div>

              {/* Donut */}
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-56 flex-shrink-0 hidden md:flex flex-col">
                <h2 className="text-base font-bold text-foreground mb-3">Venues by Size</h2>
                {donutData.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No data</p>
                ) : (
                  <>
                    <div className="relative" style={{ height: 148 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={donutData} cx="50%" cy="50%"
                            innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value" stroke="none"
                            onClick={(d: any) => handleCap(d.key as CapFilter)} style={{ cursor: 'pointer' }}
                            label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, key }: any) => {
                              // SCRUM-74: use data entry's `key` field instead of positional `index`
                              // to look up the correct short label regardless of bucket filtering
                              if (midAngle == null || percent == null || percent < 0.05) return null
                              const RADIAN = Math.PI / 180
                              const r = (innerRadius + outerRadius) * 0.5
                              const x = cx + r * Math.cos(-midAngle * RADIAN)
                              const y = cy + r * Math.sin(-midAngle * RADIAN)
                              const label = CAP_BY_KEY[key]?.shortLabel ?? '?'
                              return (
                                <text x={x} y={y} fill="rgba(255,255,255,0.95)" textAnchor="middle" dominantBaseline="central"
                                  fontSize={11} fontWeight={700} style={{ pointerEvents: 'none' }}>
                                  {label}
                                </text>
                              )
                            }}
                            labelLine={false}>
                            {donutData.map(entry => (
                              <Cell key={entry.key} fill={entry.color}
                                opacity={capFilter === 'all' || capFilter === entry.key ? 1 : 0.25} />
                            ))}
                          </Pie>
                          <Tooltip content={<DonutTip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-1.5 mt-1">
                      {donutData.map(entry => {
                        const total = donutData.reduce((s, d) => s + d.value, 0)
                        const pct   = total > 0 ? Math.round((entry.value / total) * 100) : 0
                        const isActive = capFilter === 'all' || capFilter === entry.key
                        return (
                          <button key={entry.key} onClick={() => handleCap(entry.key as CapFilter)}
                            className={`w-full flex items-center gap-2 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                            <span className="text-[11px] text-foreground flex-1 truncate">{entry.shortName ?? entry.name}:</span>
                            <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: TEAL }}>
                              {entry.value} ({pct}%)
                            </span>
                          </button>
                        )
                      })}
                      {capFilter !== 'all' && (
                        <button onClick={() => handleCap('all')} className="text-[10px] text-primary hover:underline mt-1">Clear filter ×</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── Show list ── */}
          {shows.length === 0 ? (
            <div className="bg-card rounded-lg shadow border border-border p-12 text-center">
              <p className="text-muted-foreground text-lg mb-4">
                {readOnly ? `${username} hasn't added any shows yet.` : 'No shows added yet.'}
              </p>
              {!readOnly && (
                <button onClick={() => router.push('/browse')}
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-lg hover:opacity-90 font-medium">
                  Browse Shows
                </button>
              )}
            </div>
          ) : (
            <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm font-semibold text-foreground capitalize">{viewMode}</span>
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
                      <button onClick={() => { setIsPlaying(false); setSelectedYear(null); setCapFilter('all') }} className="hover:opacity-70">×</button>
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
                  ) : billGroups.map((group, idx) => {
                    const supporters = group.shows.slice(1)
                    const future = isFuture(group.date)
                    const isExpanded = expandedBills.has(group.key)
                    // SCRUM-75: only show chevron and enable click when there are multiple acts on the bill
                    const canExpand = group.shows.length > 1
                    const toggleExpand = () => setExpandedBills(prev => {
                      const n = new Set(prev); n.has(group.key) ? n.delete(group.key) : n.add(group.key); return n
                    })
                    return (
                      <div key={group.key} className={future ? 'bg-amber-500/5' : ''}>
                        <div
                          className={`group/row flex items-center gap-3 px-4 py-3 transition-colors ${canExpand ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                          onClick={canExpand ? toggleExpand : undefined}
                        >
                          {/* Heart — own profile only */}
                          {!readOnly && (
                            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); removeShow(group.headliner.show_id) }}>
                              <button disabled={removingSet.has(group.headliner.show_id)} className="focus:outline-none disabled:opacity-50">
                                {removingSet.has(group.headliner.show_id)
                                  ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                  : <HeartIcon size={5} />}
                              </button>
                            </div>
                          )}
                          {/* Rank + chevron — SCRUM-75: chevron hidden for single-act shows */}
                          <div className="w-10 flex-shrink-0 text-right">
                            <span className="text-sm font-bold tabular-nums" style={{ color: TEAL }}>#{idx + 1}</span>
                            {canExpand && <span className="text-[10px] text-muted-foreground ml-0.5">{isExpanded ? '▴' : '▾'}</span>}
                          </div>
                          {/* Date */}
                          <div className="w-24 flex-shrink-0">
                            <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(group.date)}</p>
                            {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                          </div>
                          {/* Headliner + supporters + venue */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {group.headliner.artist.spotify_artist_id ? (
                                <a href={`https://open.spotify.com/artist/${group.headliner.artist.spotify_artist_id}`}
                                  target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-sm font-medium text-primary hover:opacity-80 hover:underline">
                                  {group.headliner.artist.artist_name}
                                </a>
                              ) : (
                                <span className="text-sm font-medium text-primary">{group.headliner.artist.artist_name}</span>
                              )}
                              {group.headliner.setlist_url && (
                                <span onClick={e => e.stopPropagation()}><SetlistLink url={group.headliner.setlist_url} /></span>
                              )}
                              {supporters.length > 0 && (
                                <>
                                  <span className="text-[11px] text-muted-foreground/40">·</span>
                                  {supporters.slice(0, 3).map((s, i) => (
                                    <span key={s.show_id} className="text-[13px] text-muted-foreground">
                                      {i > 0 && <span className="mx-0.5 opacity-40">·</span>}
                                      {s.artist.spotify_artist_id ? (
                                        <a href={`https://open.spotify.com/artist/${s.artist.spotify_artist_id}`}
                                          target="_blank" rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="hover:text-primary hover:underline transition-colors">
                                          {s.artist.artist_name}
                                        </a>
                                      ) : s.artist.artist_name}
                                    </span>
                                  ))}
                                  {supporters.length > 3 && <span className="text-[11px] text-muted-foreground/50">+{supporters.length - 3}</span>}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[13px] text-muted-foreground">{group.venue_name}</span>
                              <CapacityBadge category={group.capacity_category} />
                            </div>
                          </div>
                        </div>

                        {/* Expanded desktop rows — SCRUM-75: only rendered when canExpand */}
                        {isExpanded && canExpand && (
                          <div className="border-t border-border/40 bg-background/50 divide-y divide-border/30">
                            {group.shows.map((show, showIdx) => (
                              <div key={show.show_id} className="hidden md:grid items-center pl-12"
                                style={{ gridTemplateColumns: readOnly ? '120px 1fr' : '40px 120px 1fr' }}>
                                {!readOnly && (
                                  <div className="px-3 py-2.5 flex items-center">
                                    <button onClick={e => { e.stopPropagation(); removeShow(show.show_id) }} disabled={removingSet.has(show.show_id)} className="focus:outline-none disabled:opacity-50">
                                      {removingSet.has(show.show_id) ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={4} />}
                                    </button>
                                  </div>
                                )}
                                <div className="px-3 py-2.5">
                                  <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {showIdx === 0 && <span className="text-[9px] text-primary/60 font-medium">headliner</span>}
                                </div>
                                <div className="px-3 py-2.5 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    {show.artist.spotify_artist_id ? (
                                      <a href={`https://open.spotify.com/artist/${show.artist.spotify_artist_id}`}
                                        target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()}
                                        className="text-sm font-medium text-primary hover:opacity-80 hover:underline">
                                        {show.artist.artist_name}
                                      </a>
                                    ) : (
                                      <span className="text-sm font-medium text-primary">{show.artist.artist_name}</span>
                                    )}
                                    {show.setlist_url && <span onClick={e => e.stopPropagation()}><SetlistLink url={show.setlist_url} /></span>}
                                  </div>
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

              {/* ── FESTIVALS VIEW ── */}
              {viewMode === 'festivals' && (
                <div className="divide-y divide-border">
                  {festivalGroups.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground">No festival shows in your history.</div>
                  ) : festivalGroups.map(group => {
                    const isExpanded = expandedBills.has(group.key)
                    return (
                      <div key={group.key}>
                        <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                          onClick={() => setExpandedBills(prev => { const n = new Set(prev); n.has(group.key) ? n.delete(group.key) : n.add(group.key); return n })}>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{group.festival_name}</span>
                              <span className="text-xs text-muted-foreground">{group.year}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
                              <span style={{ color: TEAL }} className="font-medium">{group.shows.length} acts</span>
                              <span>·</span><span>{group.venue_name}</span><span>·</span>
                              <span>{group.date_from === group.date_to ? fmtDate(group.date_from) : `${fmtDate(group.date_from)} – ${fmtDate(group.date_to)}`}</span>
                            </div>
                          </div>
                          <span className="text-muted-foreground text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border/40 bg-background/50 divide-y divide-border/30">
                            {group.shows.map(show => (
                              <div key={show.show_id} className="flex items-center gap-3 px-4 py-2 pl-8">
                                {!readOnly && (
                                  <button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)} className="focus:outline-none disabled:opacity-50 flex-shrink-0">
                                    {removingSet.has(show.show_id) ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={4} />}
                                  </button>
                                )}
                                <span className="text-xs text-muted-foreground/60 w-20 flex-shrink-0 tabular-nums">{fmtDate(show.date)}</span>
                                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                                  {show.artist.spotify_artist_id ? <SpotifyLink artistId={show.artist.spotify_artist_id} name={show.artist.artist_name} /> : <span className="text-xs text-foreground">{show.artist.artist_name}</span>}
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
                        style={{ gridTemplateColumns: readOnly ? '120px 1fr' : '40px 120px 1fr' }}>
                        {!readOnly && <div className="px-3 py-3" />}
                        <button className="px-3 py-3 text-left hover:text-foreground" onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                        <div className="px-3 py-3 flex gap-3">
                          <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                          <span className="text-muted-foreground/30">/</span>
                          <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                        </div>
                      </div>
                      <div className="md:hidden grid bg-muted border-b border-border px-3 py-2"
                        style={{ gridTemplateColumns: readOnly ? '80px 1fr' : '28px 80px 1fr' }}>
                        {!readOnly && <div />}
                        <button className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider hover:text-foreground" onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                        <div className="flex gap-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
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
                              <div className="hidden md:grid items-center"
                                style={{ gridTemplateColumns: readOnly ? '120px 1fr' : '40px 120px 1fr' }}>
                                {!readOnly && (
                                  <div className="px-3 py-3.5 flex items-center">
                                    <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                      {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                    </button>
                                  </div>
                                )}
                                <div className="px-3 py-3.5">
                                  <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                                </div>
                                <div className="px-3 py-3.5 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)} className="text-sm font-medium text-primary hover:opacity-80 hover:underline">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)} className="text-[13px] text-muted-foreground hover:text-primary hover:underline">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                  </div>
                                </div>
                              </div>
                              <div className="md:hidden grid items-center px-3 py-2.5"
                                style={{ gridTemplateColumns: readOnly ? '80px 1fr' : '28px 80px 1fr' }}>
                                {!readOnly && (
                                  <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                    {removing ? <div className="w-3.5 h-3.5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={4} />}
                                  </button>
                                )}
                                <div>
                                  <p className="text-[11px] text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {future && <span className="text-[9px] font-semibold text-amber-400">upcoming</span>}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)} className="text-[11px] font-medium text-primary hover:opacity-80 truncate">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)} className="text-[10px] text-muted-foreground hover:text-primary truncate">{show.venue.venue_name}</button>
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
                            {!readOnly && <th className="px-3 py-3 w-10" />}
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground whitespace-nowrap" onClick={() => handleSort('date')}>Date{sortArrow('date')}</th>
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</th>
                            <th className="px-3 py-3 text-left cursor-pointer hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</th>
                            <th className="px-3 py-3 text-left">Festival</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {setsFiltered.length === 0 ? (
                            <tr><td colSpan={readOnly ? 4 : 5} className="text-center py-10 text-muted-foreground">No shows match this filter.</td></tr>
                          ) : currentShows.map(show => {
                            const removing = removingSet.has(show.show_id)
                            const future   = isFuture(show.date)
                            return (
                              <tr key={show.show_id} className={`hover:bg-muted/30 transition-colors ${future ? 'bg-amber-500/5' : ''}`}>
                                {!readOnly && (
                                  <td className="px-3 py-3">
                                    <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                      {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                    </button>
                                  </td>
                                )}
                                <td className="px-3 py-3 whitespace-nowrap text-foreground">
                                  {fmtDate(show.date)}
                                  {future && <span className="ml-1.5 text-[9px] font-semibold text-amber-400 bg-amber-400/15 px-1 py-px rounded">upcoming</span>}
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)} className="text-primary hover:opacity-80 hover:underline text-left">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)} className="text-muted-foreground hover:text-primary hover:underline text-left">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-muted-foreground">
                                  {show.festival_name || <span className="text-muted-foreground/40">\u2014</span>}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {totalPages > 1 && (
                    <div className="bg-muted px-4 py-3 border-t border-border">
                      <div className="flex items-center justify-between">
                        <button onClick={() => handlePage(page - 1)} disabled={page === 1}
                          className="px-3 py-1.5 text-sm border border-border rounded-md bg-card text-foreground hover:bg-muted/80 disabled:opacity-50">Previous</button>
                        <form onSubmit={e => { e.preventDefault(); const p = parseInt(pageInput); if (!isNaN(p) && p >= 1 && p <= totalPages) setPage(p); else setPageInput(String(page)) }} className="flex items-center gap-1">
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
