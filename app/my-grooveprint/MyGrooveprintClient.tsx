'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, PieChart, Pie, Cell,
} from 'recharts'
import Navigation from '@/app/components/Navigation'
import { QRCodeSVG } from 'qrcode.react'

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

// GP-118: Discogs release row from user_discogs_releases
type DiscogsRelease = {
  discogs_release_id: number
  discogs_instance_id?: number
  title: string
  year: number | null
  formats: { name: string; qty?: string; descriptions?: string[] }[] | null
  discogs_artist_names: string[]
  discogs_artist_ids: number[]
  date_added: string | null
}

type DiscogsFmt = 'vinyl' | 'cd' | 'cassette' | 'other'

export type ProfileHeader = {
  user_id:               string
  username:              string
  bio:                   string | null
  avatar_url:            string | null
  confirmed_shows:       number
  unique_artists:        number
  unique_venues:         number
  festival_count:        number
  first_show_year:       number | null
  last_show_year:        number | null
  spotify_song_count:    number | null
  spotify_artist_count:  number | null
  spotify_connected:     boolean
  show_spotify_stats:    boolean
  spotify_user_id:       string | null
  spotify_album_count:   number | null
  spotify_since_year:    number | null
  discogs_connected:     boolean
  discogs_username:      string | null
  discogs_release_count: number | null
  is_own_profile:        boolean
  friendship_status:     'accepted' | 'pending' | null
  request_direction:     'incoming' | 'outgoing' | null
  request_id:            number | null
}

type SortField     = 'date' | 'artist' | 'venue' | 'added_at'
type SortDir       = 'asc' | 'desc'
// GP-118: added 'discogs' view mode
type ViewMode      = 'shows' | 'sets' | 'festivals' | 'spotify' | 'discogs'
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

// ── Discogs format metadata ────────────────────────────────────────────────────
const DISCOGS_COLOR = '#F97316' // orange-500

const DISCOGS_FMT_META: Record<DiscogsFmt, { label: string; color: string; shortLabel: string }> = {
  vinyl:    { label: 'Vinyl',    color: 'rgba(139,92,246,0.85)',  shortLabel: 'LP'  },
  cd:       { label: 'CD',       color: 'rgba(58,143,189,0.85)',  shortLabel: 'CD'  },
  cassette: { label: 'Cassette', color: 'rgba(234,88,12,0.85)',   shortLabel: 'CS'  },
  other:    { label: 'Other',    color: 'rgba(156,163,175,0.75)', shortLabel: '?'   },
}

const DISCOGS_FMT_KEYS: DiscogsFmt[] = ['vinyl', 'cd', 'cassette', 'other']

function getDiscogsFmt(formats: { name: string }[] | null): DiscogsFmt {
  if (!formats?.length) return 'other'
  const n = formats[0].name.toLowerCase()
  if (n.includes('vinyl')) return 'vinyl'
  if (n === 'cd' || n.includes('cd')) return 'cd'
  if (n.includes('cassette')) return 'cassette'
  return 'other'
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SPOTIFY_GREEN = '#1DB954'
const TEAL = '#0d9488'
// GP-93: fixed 6-color palette for album segments in SpotifyArtistBars
const SPOTIFY_PALETTE = ['#0d9488', '#0891b2', '#7c3aed', '#be185d', '#b45309', '#065f46'] as const

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

function SpotifyIcon({ className = 'w-3 h-3', fill = SPOTIFY_GREEN }: { className?: string; fill?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={fill}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

function DiscogsIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 16.5a6.5 6.5 0 110-13 6.5 6.5 0 010 13zm0-9.5a3 3 0 100 6 3 3 0 000-6zm0 4a1 1 0 110-2 1 1 0 010 2z"/>
    </svg>
  )
}

// ── Timeline tooltips ─────────────────────────────────────────────────────────
function YearTip({ active, payload, label, viewMode }: any) {
  if (!active || !payload?.length) return null
  const val = payload.find((p: any) => p.dataKey === 'shows')?.value
  const albumCount: number = payload[0]?.payload?.albumCount ?? 0
  const artistCount: number = payload[0]?.payload?.artistCount ?? 0
  const label2 = viewMode === 'spotify' ? 'songs'
    : viewMode === 'sets' ? 'sets'
    : viewMode === 'festivals' ? 'festivals'
    : 'shows'
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {val != null && val > 0 && <p className="text-primary">{val.toLocaleString()} {val === 1 ? label2.slice(0,-1) : label2}</p>}
      {viewMode === 'spotify' && artistCount > 0 && (
        <p className="text-muted-foreground">{artistCount.toLocaleString()} artists</p>
      )}
      {viewMode === 'spotify' && albumCount > 0 && (
        <p className="text-muted-foreground">{albumCount.toLocaleString()} albums released</p>
      )}
    </div>
  )
}

function MonthTip({ active, payload, label, viewMode }: any) {
  if (!active || !payload?.length) return null
  const shows = payload.find((p: any) => p.dataKey === 'shows')?.value ?? 0
  const songs = payload.find((p: any) => p.dataKey === 'songs')?.value
  const albumReleases: { name: string; ordinal: number }[] = payload[0]?.payload?.albumReleases ?? []
  const monthAlbumCount: number = payload[0]?.payload?.albumMonthCount ?? 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none max-w-[220px]">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {viewMode === 'spotify' ? (
        shows > 0 ? <p style={{ color: SPOTIFY_GREEN }}>{shows.toLocaleString()} songs added</p> : null
      ) : (
        <>
          {shows > 0 && <p className="text-primary">{shows.toLocaleString()} {shows === 1 ? 'show' : 'shows'}</p>}
          {songs != null && songs > 0 && <p style={{ color: SPOTIFY_GREEN }}>{songs.toLocaleString()} matched songs</p>}
        </>
      )}
      {albumReleases.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40 space-y-0.5">
          {albumReleases.map((r, i) => (
            <p key={i} className="text-[10px] leading-snug text-foreground/85">
              <span style={{ color: SPOTIFY_GREEN }} className="font-bold">↑ #{r.ordinal}</span>
              {' '}{r.name}
            </p>
          ))}
        </div>
      )}
      {albumReleases.length === 0 && monthAlbumCount > 0 && viewMode === 'spotify' && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground">{monthAlbumCount.toLocaleString()} {monthAlbumCount === 1 ? 'album' : 'albums'} released</p>
        </div>
      )}
    </div>
  )
}

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

// ── GP-118: Discogs timeline tooltip ─────────────────────────────────────────
function DiscogsTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const releases = payload.find((p: any) => p.dataKey === 'releases')?.value ?? 0
  const added    = payload.find((p: any) => p.dataKey === 'added')?.value ?? 0
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none">
      <p className="font-semibold text-foreground mb-0.5">{label}</p>
      {releases > 0 && <p style={{ color: DISCOGS_COLOR }}>{releases.toLocaleString()} {releases === 1 ? 'release' : 'releases'}</p>}
      {added > 0 && <p style={{ color: TEAL }} className="mt-0.5">{added.toLocaleString()} added to collection</p>}
    </div>
  )
}


// ── Per-show artist bars ──────────────────────────────────────────────────────
function ArtistYearBars({ artists, max, onNavigate, onYearClick }: {
  artists: {
    name: string; spotifyId: string | null; total: number
    byCapacity: Record<string, number>
    showsByYear: Record<string, { venue: string; capKey: CapFilter }[]>
  }[]
  max: number; onNavigate: (name: string) => void
  onYearClick?: (artistName: string, year: string) => void
}) {
  const [tooltip, setTooltip] = useState<{ artist: string; year: string; venue: string; capKey: CapFilter; x: number } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {artists.map((artist) => {
        const totalWidth = max > 0 ? (artist.total / max) * 100 : 0
        const segments: { year: string; venue: string; capKey: CapFilter; color: string; widthPct: number }[] = []
        for (const year of Object.keys(artist.showsByYear).sort()) {
          const shows = artist.showsByYear[year]
          shows.forEach((show) => {
            segments.push({
              year, venue: show.venue, capKey: show.capKey,
              color: CAP_BY_KEY[show.capKey]?.color ?? 'rgba(156,163,175,0.75)',
              widthPct: (1 / artist.total) * 100,
            })
          })
        }
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
                  {segments.map((seg, i) => {
                    const isFirst = i === 0, isLast = i === segments.length - 1
                    return (
                      <div key={i} className="h-full flex items-center justify-center overflow-hidden"
                        style={{
                          width: `${seg.widthPct}%`, backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                          cursor: onYearClick ? 'pointer' : 'default',
                        }}
                        onClick={() => onYearClick?.(artist.name, seg.year)}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, year: seg.year, venue: seg.venue, capKey: seg.capKey, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}>
                        <span className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                          style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                          {seg.year}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
              {tooltip?.artist === artist.name && (
                <div className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[140px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}>
                  <p className="font-semibold text-foreground">{artist.name} · {tooltip.year}</p>
                  <p className="text-muted-foreground mt-0.5 truncate">{tooltip.venue}</p>
                  <p style={{ color: CAP_BY_KEY[tooltip.capKey]?.color ?? TEAL }} className="mt-0.5 text-[10px]">
                    {CAP_BY_KEY[tooltip.capKey]?.legendLabel ?? 'Unknown'}
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
  const [tooltip, setTooltip] = useState<{ venue: string; year: string; count: number; artists: string[]; capKey: CapFilter; x: number } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {venues.map((venue) => {
        const totalWidth = max > 0 ? (venue.total / max) * 100 : 0
        const numYears = Object.keys(venue.showsByYear).length
        const yearSegments = Object.keys(venue.showsByYear).sort().map(year => {
          const yearShows = venue.showsByYear[year]
          const capCounts: Record<string, number> = {}
          for (const s of yearShows) { capCounts[s.capKey] = (capCounts[s.capKey] ?? 0) + 1 }
          const capKey = (Object.entries(capCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown') as CapFilter
          const artists = [...new Set(yearShows.map(s => s.artist))]
          return { year, count: yearShows.length, capKey, color: CAP_BY_KEY[capKey]?.color ?? 'rgba(156,163,175,0.75)', widthPct: (1 / numYears) * 100, artists }
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
                    return (
                      <div key={seg.year} className="h-full flex items-center justify-center overflow-hidden cursor-default"
                        style={{
                          width: `${seg.widthPct}%`, backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                        }}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ venue: venue.name, year: seg.year, count: seg.count, artists: seg.artists, capKey: seg.capKey, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}>
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
                  <p style={{ color: TEAL }} className="mt-0.5">{tooltip.count} {tooltip.count === 1 ? 'show' : 'shows'}</p>
                  {tooltip.artists.map(a => (
                    <p key={a} className="text-muted-foreground mt-0.5 truncate">{a}</p>
                  ))}
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

// ── GP-118: Discogs artist bars — segments colored by format ─────────────────
function DiscogsArtistBars({ artists, max }: {
  artists: {
    name: string; total: number
    formatCounts: Record<DiscogsFmt, number>
    releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null }[]
  }[]
  max: number
}) {
  const [tooltip, setTooltip] = useState<{
    artist: string; formatCounts: Record<DiscogsFmt, number>; x: number
  } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {artists.map(artist => {
        const totalWidth = max > 0 ? (artist.total / max) * 100 : 0
        const segments = DISCOGS_FMT_KEYS
          .filter(fmt => artist.formatCounts[fmt] > 0)
          .map(fmt => ({
            fmt,
            count: artist.formatCounts[fmt],
            color: DISCOGS_FMT_META[fmt].color,
            widthPct: (artist.formatCounts[fmt] / artist.total) * 100,
          }))

        return (
          <div key={artist.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <span className="text-xs text-primary truncate text-right" title={artist.name}>
                {artist.name}
              </span>
            </div>
            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
                  {segments.map((seg, i) => {
                    const isFirst = i === 0, isLast = i === segments.length - 1
                    return (
                      <div key={seg.fmt} className="h-full flex items-center justify-center overflow-hidden"
                        style={{
                          width: `${seg.widthPct}%`, backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                        }}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, formatCounts: artist.formatCounts, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}>
                        {seg.widthPct >= 15 && (
                          <span className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                            style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                            {DISCOGS_FMT_META[seg.fmt].shortLabel}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {tooltip?.artist === artist.name && (
                <div className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}>
                  <p className="font-semibold text-foreground mb-1">{artist.name}</p>
                  {DISCOGS_FMT_KEYS.filter(f => tooltip.formatCounts[f] > 0).map(fmt => (
                    <p key={fmt} style={{ color: DISCOGS_FMT_META[fmt].color }} className="mt-0.5">
                      {DISCOGS_FMT_META[fmt].label}: {tooltip.formatCounts[fmt]}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <span className="text-xs tabular-nums flex-shrink-0 w-16 text-right" style={{ color: DISCOGS_COLOR }}>
              {artist.total} {artist.total === 1 ? 'record' : 'records'}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-2 border-t border-border text-[10px] text-muted-foreground flex-wrap">
        {DISCOGS_FMT_KEYS.map(fmt => (
          <span key={fmt} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: DISCOGS_FMT_META[fmt].color }} />
            {DISCOGS_FMT_META[fmt].label}
          </span>
        ))}
      </div>
    </div>
  )
}


// ── GP-93: Spotify artist year-bucket bars ────────────────────────────────
function SpotifyArtistBars({ artists, max, onYearClick }: {
  artists: {
    name: string; count: number; spotifyId: string; hasAlbumData: boolean
    albums: { name: string | null; year: string | null; releaseDate: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }[]
  }[]
  max: number
  onYearClick?: (artistName: string, year: string, spotifyId: string) => void
}) {
  const [tooltip, setTooltip] = useState<{
    artist: string; year: string | null; albumNames: string[]; count: number; x: number
  } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {artists.map((artist) => {
        const totalWidth = max > 0 ? (artist.count / max) * 100 : 0
        const yearMap = new Map<string, { year: string | null; albumNames: string[]; count: number }>()
        for (const album of artist.albums) {
          const key = album.year ?? '__null__'
          if (!yearMap.has(key)) yearMap.set(key, { year: album.year, albumNames: [], count: 0 })
          const bucket = yearMap.get(key)!
          if (album.name) bucket.albumNames.push(album.name)
          bucket.count += album.songs.length
        }
        const yearBuckets = Array.from(yearMap.values()).sort((a, b) => {
          if (!a.year && !b.year) return 0
          if (!a.year) return 1
          if (!b.year) return -1
          return parseInt(a.year) - parseInt(b.year)
        })
        return (
          <div key={artist.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <button className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right cursor-default" title={artist.name}>
                {artist.name}
              </button>
              <SpotifyLink artistId={artist.spotifyId} />
            </div>
            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
                  {yearBuckets.map((bucket, i) => {
                    const widthPct = (bucket.count / artist.count) * 100
                    const color = SPOTIFY_PALETTE[i % SPOTIFY_PALETTE.length]
                    const isFirst = i === 0, isLast = i === yearBuckets.length - 1
                    const showLabel = widthPct >= 6 && (totalWidth * widthPct / 100) >= 5
                    const clickable = !!onYearClick && !!bucket.year
                    return (
                      <div key={bucket.year ?? '__null__'} className="h-full flex items-center justify-center overflow-hidden"
                        style={{
                          width: `${widthPct}%`, backgroundColor: color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                          cursor: clickable ? 'pointer' : 'default',
                        }}
                        onClick={() => clickable && onYearClick!(artist.name, bucket.year!, artist.spotifyId)}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, year: bucket.year, albumNames: bucket.albumNames, count: bucket.count, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}>
                        {showLabel && (
                          <span className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                            style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>
                            {bucket.year ?? ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
              {tooltip?.artist === artist.name && (
                <div className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px] max-w-[240px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}>
                  <p className="font-semibold text-foreground">{tooltip.year ?? 'Unknown year'}</p>
                  {tooltip.albumNames.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {tooltip.albumNames.map((name, i) => (
                        <p key={i} className="text-muted-foreground leading-snug text-[11px]">{name}</p>
                      ))}
                    </div>
                  )}
                  <p style={{ color: SPOTIFY_GREEN }} className="mt-0.5">
                    {tooltip.count} {tooltip.count === 1 ? 'song' : 'songs'}
                  </p>
                </div>
              )}
            </div>
            <span className="text-xs tabular-nums flex-shrink-0 w-16 text-right" style={{ color: SPOTIFY_GREEN }}>
              {artist.count} {artist.count === 1 ? 'song' : 'songs'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Expandable artist song list ────────────────────────────────────────────────
type AlbumEntry = {
  name: string | null; year: string | null; releaseDate: string | null
  songs: { track_name: string; track_id: string | null; added_at: string }[]
}
function ArtistSongList({ albums, hasAlbumData, focusYear }: {
  albums: AlbumEntry[]; hasAlbumData: boolean; focusYear: string | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = useState(true)
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => { setShowFade(el.scrollHeight - el.scrollTop > el.clientHeight + 16) }
    check()
    el.addEventListener('scroll', check, { passive: true })
    return () => el.removeEventListener('scroll', check)
  }, [albums])

  useEffect(() => { setExpandedAlbums(new Set()) }, [focusYear])

  const displayAlbums = focusYear ? albums.filter(alb => alb.year === focusYear) : albums
  const namedAlbumCount = displayAlbums.filter(a => a.name).length
  const useCollapsed = hasAlbumData && namedAlbumCount > 1

  const toggleAlbum = (key: string) => {
    setExpandedAlbums(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  return (
    <div className="relative">
      <div ref={scrollRef} className="max-h-[520px] overflow-y-auto">
        {displayAlbums.map((album, ai) => {
          const albumKey = album.name ?? `__null_${ai}`
          const isExpanded = !useCollapsed || !album.name || expandedAlbums.has(albumKey)
          return (
            <div key={ai}>
              {hasAlbumData && album.name && (
                <div className={`px-4 py-2 bg-muted/50 transition-colors ${ai > 0 ? 'border-t border-teal-500/15' : ''} ${useCollapsed ? 'cursor-pointer hover:bg-muted/70' : ''}`}
                  style={{ color: '#0d9488' }}
                  onClick={useCollapsed ? () => toggleAlbum(albumKey) : undefined}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-semibold">{album.name}{album.year ? ` (${album.year})` : ''}</span>
                    {useCollapsed && (
                      <span className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-muted-foreground font-normal text-[10px] normal-case tracking-normal">
                          {album.songs.length} {album.songs.length === 1 ? 'song' : 'songs'}
                        </span>
                        <span className="text-muted-foreground text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
              {isExpanded && (
                <div className="divide-y divide-border/10">
                  {album.songs.map((song, j) => (
                    <div key={j} className="grid items-center px-4 py-2 hover:bg-muted/20 transition-colors"
                      style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px' }}>
                      <div className="min-w-0 pl-2 pr-3">
                        {song.track_id ? (
                          <a href={`https://open.spotify.com/track/${song.track_id}`} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-foreground/80 hover:text-primary hover:underline truncate block transition-colors" title={song.track_name}>
                            {song.track_name}
                          </a>
                        ) : (
                          <span className="text-xs text-foreground/80 truncate block" title={song.track_name}>{song.track_name}</span>
                        )}
                      </div>
                      <span className="text-xs text-foreground/50 tabular-nums text-right">
                        {new Date(song.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {showFade && (
        <div className="absolute bottom-0 left-0 right-0 h-14 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.75))' }} />
      )}
    </div>
  )
}

// ── Day-level tooltip (GP-112) ─────────────────────────────────────────────
function DayTip({ active, payload, label, month, year }: any) {
  if (!active || !payload?.length) return null
  const shows = payload.find((p: any) => p.dataKey === 'shows')?.value ?? 0
  const albumReleases: string[] = payload[0]?.payload?.albumReleases ?? []
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-lg pointer-events-none max-w-[220px]">
      <p className="font-semibold text-foreground mb-0.5">Day {label}{month && year ? `, ${MONTHS[month]} ${year}` : ''}</p>
      {shows > 0 && <p style={{ color: SPOTIFY_GREEN }}>{shows.toLocaleString()} {shows === 1 ? 'song' : 'songs'} added</p>}
      {albumReleases.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-border/40 space-y-0.5">
          {albumReleases.map((name, i) => (
            <p key={i} className="text-[10px] leading-snug text-foreground/85">
              <span style={{ color: SPOTIFY_GREEN }} className="font-bold">↑</span> {name}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── GP-111: Spotify album proportional bars ────────────────────────────────
function SpotifyAlbumBars({ albums, max, onAlbumClick }: {
  albums: { albumName: string; artistName: string; artistId: string | null; year: string | null; releaseDate: string | null; addedYear: string | null; count: number }[]
  max: number
  onAlbumClick: (artistName: string, releaseYear: string | null, artistId: string | null, addedYear: string | null) => void
}) {
  const [tooltip, setTooltip] = useState<{ key: string; albumName: string; artistName: string; year: string | null; count: number; x: number } | null>(null)

  return (
    <div className="w-full space-y-1.5">
      {albums.map((album) => {
        const totalWidth = max > 0 ? (album.count / max) * 100 : 0
        const key = `${album.albumName}::${album.artistName}`
        return (
          <div key={key} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <button className="text-xs hover:opacity-80 text-right min-w-0 flex-1"
                title={`${album.albumName}${album.year ? ` (${album.year})` : ''} · ${album.artistName}`}
                onClick={() => onAlbumClick(album.artistName, album.year, album.artistId, album.addedYear)}>
                <span className="block text-primary truncate leading-tight">{album.albumName}</span>
                <span className="block text-[10px] text-muted-foreground truncate">{album.artistName}</span>
              </button>
              {album.artistId && <SpotifyLink artistId={album.artistId} />}
            </div>
            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden">
                <div className="h-full rounded-full cursor-pointer flex items-center overflow-hidden"
                  style={{ width: `${totalWidth}%`, backgroundColor: SPOTIFY_GREEN, opacity: 0.8 }}
                  onClick={() => onAlbumClick(album.artistName, album.year, album.artistId, album.addedYear)}
                  onMouseEnter={e => {
                    const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                    setTooltip({ key, albumName: album.albumName, artistName: album.artistName, year: album.year, count: album.count, x: e.clientX - rect.left })
                  }}
                  onMouseLeave={() => setTooltip(null)}>
                  {album.year && totalWidth >= 8 && (
                    <span className="text-[9px] font-semibold text-black/70 px-2 ml-auto select-none whitespace-nowrap">{album.year}</span>
                  )}
                </div>
              </div>
              {tooltip?.key === key && (
                <div className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}>
                  <p className="font-semibold text-foreground">{tooltip.albumName}{tooltip.year ? ` (${tooltip.year})` : ''}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">{tooltip.artistName}</p>
                  <p style={{ color: SPOTIFY_GREEN }} className="mt-0.5">{tooltip.count.toLocaleString()} {tooltip.count === 1 ? 'song' : 'songs'}</p>
                </div>
              )}
            </div>
            <span className="text-xs tabular-nums flex-shrink-0 w-16 text-right" style={{ color: SPOTIFY_GREEN }}>
              {album.count.toLocaleString()} {album.count === 1 ? 'song' : 'songs'}
            </span>
          </div>
        )
      })}
    </div>
  )
}


// ── GP-114: Profile header card ───────────────────────────────────────────────
function ProfileHeaderCard({ header, readOnly }: { header: ProfileHeader; readOnly: boolean }) {
  const router = useRouter()
  const supabase = createClient()
  const [actionLoading, setActionLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imgError, setImgError] = useState(false)

  const profileUrl = `https://grooveprint.app/profile/${header.username}`
  const sinceYear = header.first_show_year ? `since ${header.first_show_year}` : null
  const showSpotifyStats = (header.is_own_profile || header.show_spotify_stats) && header.spotify_connected && (header.spotify_song_count ?? 0) > 0

  const handleAddFriend = async () => { setActionLoading(true); await supabase.rpc('send_friend_request', { target_user_id: header.user_id }); router.refresh(); setActionLoading(false) }
  const handleCancelRequest = async () => { setActionLoading(true); await supabase.rpc('cancel_friend_request', { target_user_id: header.user_id }); router.refresh(); setActionLoading(false) }
  const handleRespond = async (requestId: number, action: 'accept' | 'reject') => {
    setActionLoading(true)
    await supabase.rpc('respond_to_friend_request', { request_id: requestId, new_status: action === 'accept' ? 'accepted' : 'rejected' })
    router.refresh(); setActionLoading(false)
  }
  const handleCopy = () => { navigator.clipboard.writeText(`${profileUrl}?r=1`); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  const initial = header.username?.[0]?.toUpperCase() ?? '?'

  return (
    <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
      <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
        <div className="shrink-0">
          {header.avatar_url && !imgError ? (
            <img src={header.avatar_url} alt={header.username} onError={() => setImgError(true)} className="w-14 h-14 md:w-16 md:h-16 rounded-full object-cover ring-2 ring-border flex-shrink-0" />
          ) : (
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-full bg-primary/20 flex items-center justify-center font-bold text-xl text-primary ring-2 ring-border flex-shrink-0">{initial}</div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-primary truncate">@{header.username}</h2>
              {header.bio && <p className="text-sm text-muted-foreground mt-0.5 max-w-sm leading-relaxed">{header.bio}</p>}
              <div className="flex items-center gap-1.5 mt-1.5 text-sm flex-wrap">
                <span className="font-semibold text-foreground">{header.confirmed_shows}</span><span className="text-muted-foreground">shows</span>
                <span className="text-border">·</span>
                <span className="font-semibold text-foreground">{header.unique_artists}</span><span className="text-muted-foreground">artists</span>
                <span className="text-border">·</span>
                <span className="font-semibold text-foreground">{header.unique_venues}</span><span className="text-muted-foreground">venues</span>
                {header.festival_count > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.festival_count}</span><span className="text-muted-foreground">{header.festival_count === 1 ? 'festival' : 'festivals'}</span></>)}
                {sinceYear && (<><span className="text-border">·</span><span className="font-medium" style={{ color: TEAL }}>{sinceYear}</span></>)}
              </div>
              {showSpotifyStats && (
                <div className="flex items-center gap-1.5 mt-1.5 text-sm flex-wrap">
                  <SpotifyIcon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="font-semibold text-foreground">{header.spotify_song_count?.toLocaleString()}</span><span className="text-muted-foreground">songs</span>
                  {(header.spotify_artist_count ?? 0) > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.spotify_artist_count?.toLocaleString()}</span><span className="text-muted-foreground">artists</span></>)}
                  {(header.spotify_album_count ?? 0) > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.spotify_album_count?.toLocaleString()}</span><span className="text-muted-foreground">albums</span></>)}
                  {header.spotify_since_year && (<><span className="text-border">·</span><span className="font-medium" style={{ color: SPOTIFY_GREEN }}>since {header.spotify_since_year}</span></>)}
                </div>
              )}
              {header.discogs_connected && (header.discogs_release_count ?? 0) > 0 && (
                <div className="flex items-center gap-1.5 mt-1 text-sm flex-wrap">
                  <DiscogsIcon className="w-3.5 h-3.5 flex-shrink-0 text-orange-400" />
                  <span className="font-semibold text-foreground">{header.discogs_release_count?.toLocaleString()}</span><span className="text-muted-foreground">records</span>
                </div>
              )}
              {(header.spotify_user_id || (header.discogs_connected && header.discogs_username)) && (
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  {header.spotify_user_id && (
                    <a href={`https://open.spotify.com/user/${header.spotify_user_id}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium hover:opacity-80 transition-opacity"
                      style={{ background: 'rgba(29,185,84,0.12)', color: SPOTIFY_GREEN, border: '1px solid rgba(29,185,84,0.3)' }}>
                      <SpotifyIcon className="w-3 h-3" />Spotify
                    </a>
                  )}
                  {header.discogs_connected && header.discogs_username && (
                    <a href={`https://www.discogs.com/user/${header.discogs_username}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium hover:opacity-80 transition-opacity"
                      style={{ background: 'rgba(20,20,20,0.9)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.18)' }}>
                      <DiscogsIcon className="w-3 h-3" />Discogs
                    </a>
                  )}
                </div>
              )}
            </div>
            {header.is_own_profile ? (
              <div className="shrink-0 flex flex-col items-center gap-2">
                <div className="hidden sm:block bg-white rounded-xl p-1.5">
                  <QRCodeSVG value={profileUrl} size={64} bgColor="#ffffff" fgColor="#0f172a" />
                </div>
                <button onClick={handleCopy} className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: 'rgba(0,191,168,0.1)', color: '#00BFA8', border: '1px solid rgba(0,191,168,0.25)' }}>
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap shrink-0">
                {header.friendship_status === null && (
                  <button onClick={handleAddFriend} disabled={actionLoading} className="px-4 py-2 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-lg transition-colors">
                    {actionLoading ? <span className="inline-block w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" /> : '+ Add Friend'}
                  </button>
                )}
                {header.friendship_status === 'pending' && header.request_direction === 'outgoing' && (
                  <><span className="px-3 py-1.5 bg-muted text-muted-foreground text-sm font-medium rounded-lg">Request Sent</span>
                  <button onClick={handleCancelRequest} disabled={actionLoading} className="px-3 py-1.5 border border-border hover:bg-muted text-muted-foreground text-sm rounded-lg transition-colors disabled:opacity-50">Cancel</button></>
                )}
                {header.friendship_status === 'pending' && header.request_direction === 'incoming' && header.request_id !== null && (
                  <><button onClick={() => handleRespond(header.request_id!, 'accept')} disabled={actionLoading} className="px-4 py-2 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground text-sm font-medium rounded-lg transition-colors">Accept</button>
                  <button onClick={() => handleRespond(header.request_id!, 'reject')} disabled={actionLoading} className="px-3 py-1.5 border border-border hover:bg-muted text-muted-foreground text-sm rounded-lg transition-colors disabled:opacity-50">Reject</button></>
                )}
                {header.friendship_status === 'accepted' && (
                  <><span className="px-3 py-1.5 text-sm font-medium rounded-lg" style={{ background: 'rgba(0,191,168,0.1)', color: '#00BFA8', border: '1px solid rgba(0,191,168,0.25)' }}>Friends ✓</span>
                  <a href={`/profile/${header.username}/shows?compare=true`} className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-sm font-medium rounded-lg transition-colors border border-border">Compare</a></>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Main component ────────────────────────────────────────────────────────────
export default function MyGrooveprintClient({
  shows: initialShows,
  spotifySongs: initialSpotifySongs,
  discogsReleases: initialDiscogsReleases = [],  // GP-118: pre-loaded for readOnly; own profile lazy-loads
  readOnly = false,
  username,
  profileHeader,
}: {
  shows: Show[]
  spotifySongs: { added_at: string; spotify_artist_id: string | null; artist_name: string; track_name: string; spotify_album_name: string | null; spotify_album_release_date: string | null; spotify_track_id: string | null }[]
  discogsReleases?: DiscogsRelease[]
  readOnly?: boolean
  username?: string
  profileHeader?: ProfileHeader
}) {
  const router  = useRouter()
  const supabase = createClient()

  const [shows, setShows] = useState(initialShows)
  const [spotifySongs, setSpotifySongs] = useState(initialSpotifySongs)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyLoaded, setSpotifyLoaded]   = useState(false)
  // GP-118: Discogs lazy-load state (mirrors Spotify pattern)
  const [discogsReleases, setDiscogsReleases] = useState<DiscogsRelease[]>(initialDiscogsReleases)
  const [discogsLoading, setDiscogsLoading]   = useState(false)
  const [discogsLoaded, setDiscogsLoaded]     = useState(initialDiscogsReleases.length > 0)

  const [viewMode, setViewMode]                         = useState<ViewMode>('shows')
  const [setsSubView, setSetsSubView]                   = useState<SetsSubView>('card')
  const [sortField, setSortField]                       = useState<SortField>('date')
  const [sortDir, setSortDir]                           = useState<SortDir>('desc')
  const [removingSet, setRemovingSet]                   = useState<Set<number>>(new Set())
  const [page, setPage]                                 = useState(1)
  const [pageInput, setPageInput]                       = useState('1')
  const [selectedYear, setSelectedYear]                 = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth]               = useState<number | null>(null)
  const [capFilter, setCapFilter]                       = useState<CapFilter>('all')
  const [chartSection, setChartSection]                 = useState<'artists' | 'venues'>('artists')
  const [showAllArtists, setShowAllArtists]             = useState(false)
  const [showAllVenues, setShowAllVenues]               = useState(false)
  const [expandedBills, setExpandedBills]               = useState<Set<string>>(new Set())
  const [isPlaying, setIsPlaying]                       = useState(false)
  const [expandedSpotifyArtists, setExpandedSpotifyArtists] = useState<Set<string>>(new Set())
  const [filterText, setFilterText]                         = useState('')
  const [spotifyReleaseFocus, setSpotifyReleaseFocus]       = useState<{ artistId: string; releaseYear: string } | null>(null)
  const [spotifyLibraryView, setSpotifyLibraryView]         = useState<'artists' | 'albums'>('artists')
  const [showAllAlbums, setShowAllAlbums]                   = useState(false)
  const [expandedAlbumKeys, setExpandedAlbumKeys]           = useState<Set<string>>(new Set())
  // GP-118: Discogs UI state
  const [showAllDiscogsArtists, setShowAllDiscogsArtists]   = useState(false)
  const [discogsFmtFilter, setDiscogsFmtFilter]             = useState<DiscogsFmt | 'all'>('all')
  const [expandedDiscogsArtists, setExpandedDiscogsArtists] = useState<Set<string>>(new Set())

  // Unadded CTA
  const [unaddedArtists, setUnaddedArtists]         = useState<UnaddedArtist[]>([])
  const [unaddedDismissed, setUnaddedDismissed]     = useState(false)
  const [unaddedExpanded, setUnaddedExpanded]       = useState(false)
  const [addingUnadded, setAddingUnadded]           = useState(false)
  const [addingIndividual, setAddingIndividual]     = useState<Set<number>>(new Set())
  const [skippingIndividual, setSkippingIndividual] = useState<Set<number>>(new Set())
  const [skippingAll, setSkippingAll]               = useState(false)
  const [skippedArtists, setSkippedArtists]         = useState<UnaddedArtist[]>([])
  const [skippedExpanded, setSkippedExpanded]       = useState(false)
  const [restoringIndividual, setRestoringIndividual] = useState<Set<number>>(new Set())
  const [sessionShowsModified, setSessionShowsModified] = useState(false)

  const PER_PAGE = 50
  const hasSpotify = (profileHeader?.is_own_profile && profileHeader?.spotify_connected) || spotifySongs.length > 0
  // GP-118: show Discogs tab if user has connected Discogs (own or friend's profile)
  const hasDiscogs = !!(profileHeader?.discogs_connected && (profileHeader?.discogs_release_count ?? 0) > 0)
  const anyFilterActive = selectedYear !== null || capFilter !== 'all' || filterText.trim() !== '' || discogsFmtFilter !== 'all'

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
      const { data: reviewedRows } = await supabase.from('user_show_reviews').select('show_id').eq('user_id', user.id)
      const reviewedIds = new Set((reviewedRows ?? []).map((r: any) => r.show_id))
      setUnaddedArtists(unadded.filter(a => !reviewedIds.has(a.show_id)))
      setSkippedArtists(unadded.filter(a => reviewedIds.has(a.show_id)))
    } catch (e) { console.error('Error checking unadded:', e) }
  }, [shows, supabase, readOnly])

  useEffect(() => { checkUnaddedArtists() }, [])
  useEffect(() => { if (sessionShowsModified) { checkUnaddedArtists(); setSessionShowsModified(false) } }, [sessionShowsModified])

  // GP-124: lazy-load Spotify songs on first Spotify tab click
  useEffect(() => {
    if (viewMode !== 'spotify') return
    if (spotifyLoaded || spotifyLoading) return
    if (readOnly || !profileHeader?.spotify_connected) return
    setSpotifyLoading(true)
    supabase
      .from('user_spotify_songs')
      .select('added_at, spotify_artist_id, artist_name, track_name, spotify_album_name, spotify_album_release_date, spotify_track_id')
      .not('added_at', 'is', null)
      .then(({ data, error }) => {
        if (!error && data) setSpotifySongs(data as typeof initialSpotifySongs)
        setSpotifyLoaded(true)
        setSpotifyLoading(false)
      })
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // GP-118: lazy-load Discogs releases on first Discogs tab click (own profile only)
  // For readOnly (friend profiles), releases are pre-loaded via prop by the server component.
  // TODO: update app/profile/[username]/shows/page.tsx to pre-fetch and pass discogsReleases.
  useEffect(() => {
    if (viewMode !== 'discogs') return
    if (discogsLoaded || discogsLoading) return
    if (readOnly) { setDiscogsLoaded(true); return }
    setDiscogsLoading(true)
    supabase
      .from('user_discogs_releases')
      .select('discogs_release_id, discogs_instance_id, title, year, formats, discogs_artist_names, discogs_artist_ids, date_added')
      .then(({ data, error }) => {
        if (!error && data) setDiscogsReleases(data as DiscogsRelease[])
        setDiscogsLoaded(true)
        setDiscogsLoading(false)
      })
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps


  // ── Base stats ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const past   = shows.filter(s => !isFuture(s.date))
    const future = shows.filter(s =>  isFuture(s.date))
    const sortedPast = [...past].sort((a, b) => a.date.localeCompare(b.date))
    const firstDate = sortedPast[0]?.date ?? null
    const lastDate  = sortedPast[sortedPast.length - 1]?.date ?? null
    const firstCandidates = firstDate ? past.filter(s => s.date === firstDate) : []
    const lastCandidates  = lastDate  ? past.filter(s => s.date === lastDate)  : []
    const firstShow = firstCandidates.length > 0
      ? firstCandidates.reduce((best, s) => headlinerScore(s) > headlinerScore(best) ? s : best)
      : null
    const lastShow = lastCandidates.length > 0
      ? lastCandidates.reduce((best, s) => headlinerScore(s) > headlinerScore(best) ? s : best)
      : null
    return { total: shows.length, artists: new Set(shows.map(s => s.artist.artist_id)).size, venues: new Set(shows.map(s => s.venue.venue_id)).size, past, future, firstShow, lastShow }
  }, [shows])

  // ── Spotify memos ─────────────────────────────────────────────────────────
  const spotifyByYearMonth = useMemo(() => {
    const result: Record<string, Record<number, number>> = {}
    for (const s of spotifySongs) {
      const dt = new Date(s.added_at); const y = String(dt.getFullYear()); const m = dt.getMonth()
      if (!result[y]) result[y] = {}; result[y][m] = (result[y][m] ?? 0) + 1
    }
    return result
  }, [spotifySongs])

  const artistContextualByYearMonth = useMemo(() => {
    if (!hasSpotify || spotifySongs.length === 0) return {} as Record<string, Record<number, number>>
    const showArtistsByKey: Record<string, Set<string>> = {}
    for (const show of shows) {
      if (!show.artist.spotify_artist_id) continue
      const [yearStr, monthStr] = show.date.split('-'); const year = parseInt(yearStr); const month = parseInt(monthStr) - 1
      for (let delta = -1; delta <= 1; delta++) {
        let m = month + delta; let y = year
        if (m < 0) { m += 12; y-- }; if (m > 11) { m -= 12; y++ }
        const key = `${y}-${m}`
        if (!showArtistsByKey[key]) showArtistsByKey[key] = new Set()
        showArtistsByKey[key].add(show.artist.spotify_artist_id)
      }
    }
    const result: Record<string, Record<number, number>> = {}
    for (const song of spotifySongs) {
      if (!song.spotify_artist_id) continue
      const dt = new Date(song.added_at); const y = dt.getFullYear(); const m = dt.getMonth()
      const key = `${y}-${m}`
      if (showArtistsByKey[key]?.has(song.spotify_artist_id)) {
        const yStr = String(y); if (!result[yStr]) result[yStr] = {}
        result[yStr][m] = (result[yStr][m] ?? 0) + 1
      }
    }
    return result
  }, [shows, spotifySongs, hasSpotify])

  const topSpotifyArtists = useMemo(() => {
    if (spotifySongs.length === 0) return [] as { name: string; count: number; spotifyId: string; hasAlbumData: boolean; albums: { name: string | null; year: string | null; releaseDate: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }[] }[]
    const src = selectedYear
      ? spotifySongs.filter(s => { const dt = new Date(s.added_at); if (String(dt.getFullYear()) !== selectedYear) return false; if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false; return true })
      : spotifySongs
    const raw: Record<string, { name: string; count: number; spotifyId: string; songList: { track_name: string; album_name: string | null; release_year: string | null; release_date: string | null; track_id: string | null; added_at: string }[] }> = {}
    for (const song of src) {
      if (!song.spotify_artist_id) continue
      if (!raw[song.spotify_artist_id]) raw[song.spotify_artist_id] = { name: song.artist_name, count: 0, spotifyId: song.spotify_artist_id, songList: [] }
      raw[song.spotify_artist_id].count++
      raw[song.spotify_artist_id].songList.push({ track_name: song.track_name, album_name: song.spotify_album_name ?? null, release_year: song.spotify_album_release_date ? song.spotify_album_release_date.substring(0, 4) : null, release_date: song.spotify_album_release_date ?? null, track_id: song.spotify_track_id ?? null, added_at: song.added_at })
    }
    return Object.values(raw).sort((a, b) => b.count - a.count).slice(0, 50).map(artist => {
      const sorted = [...artist.songList].sort((a, b) => b.added_at.localeCompare(a.added_at))
      const hasAlbumData = sorted.some(s => s.album_name)
      const albumMap: Record<string, { name: string | null; year: string | null; releaseDate: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }> = {}
      for (const song of sorted) {
        const key = song.album_name ?? '__null__'
        if (!albumMap[key]) albumMap[key] = { name: song.album_name, year: song.release_year, releaseDate: song.release_date ?? null, songs: [] }
        albumMap[key].songs.push({ track_name: song.track_name, track_id: song.track_id, added_at: song.added_at })
      }
      const albums = Object.values(albumMap).sort((a, b) => { if (a.name === null) return 1; if (b.name === null) return -1; if (!a.year && !b.year) return 0; if (!a.year) return 1; if (!b.year) return -1; return parseInt(b.year) - parseInt(a.year) })
      return { name: artist.name, count: artist.count, spotifyId: artist.spotifyId, hasAlbumData, albums }
    })
  }, [spotifySongs, hasSpotify, selectedYear, selectedMonth])

  const firstSpotifyYear = useMemo(() => Object.keys(spotifyByYearMonth).sort()[0] ?? null, [spotifyByYearMonth])

  const topSpotifyAlbums = useMemo(() => {
    if (spotifySongs.length === 0) return [] as { albumName: string; artistName: string; artistId: string | null; year: string | null; releaseDate: string | null; addedYear: string | null; count: number; songs: { track_name: string; track_id: string | null; added_at: string }[] }[]
    const q = filterText.trim().toLowerCase()
    const src0 = q ? spotifySongs.filter(s => s.artist_name.toLowerCase().includes(q) || (s.spotify_album_name?.toLowerCase().includes(q) ?? false)) : spotifySongs
    const src = selectedYear ? src0.filter(s => { const dt = new Date(s.added_at); if (String(dt.getFullYear()) !== selectedYear) return false; if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false; return true }) : src0
    const albumMap: Record<string, { albumName: string; artistName: string; artistId: string | null; year: string | null; releaseDate: string | null; addedYear: string | null; count: number; songs: { track_name: string; track_id: string | null; added_at: string }[]; addedYearCounts: Record<string, number> }> = {}
    for (const song of src) {
      if (!song.spotify_album_name) continue
      const key = `${song.spotify_album_name}::${song.spotify_artist_id ?? ''}`
      if (!albumMap[key]) albumMap[key] = { albumName: song.spotify_album_name, artistName: song.artist_name, artistId: song.spotify_artist_id ?? null, year: song.spotify_album_release_date ? song.spotify_album_release_date.substring(0, 4) : null, releaseDate: song.spotify_album_release_date ?? null, addedYear: null, count: 0, songs: [], addedYearCounts: {} }
      albumMap[key].count++
      albumMap[key].songs.push({ track_name: song.track_name, track_id: song.spotify_track_id ?? null, added_at: song.added_at })
      const addedY = String(new Date(song.added_at).getFullYear())
      albumMap[key].addedYearCounts[addedY] = (albumMap[key].addedYearCounts[addedY] ?? 0) + 1
    }
    return Object.values(albumMap).map(alb => {
      const addedYear = Object.entries(alb.addedYearCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
      const { addedYearCounts: _, ...rest } = alb
      return { ...rest, addedYear }
    }).sort((a, b) => b.count - a.count).slice(0, 50)
  }, [spotifySongs, hasSpotify, filterText, selectedYear, selectedMonth])

  // ── GP-118: Discogs memos ──────────────────────────────────────────────────

  // Release year primary + date_added year secondary
  const discogsTimelineData = useMemo((): { year: string; releases: number; added: number }[] => {
    if (discogsReleases.length === 0) return []
    const byReleaseYear: Record<string, number> = {}
    const byAddedYear: Record<string, number>   = {}
    for (const r of discogsReleases) {
      if (r.year) { const y = String(r.year); byReleaseYear[y] = (byReleaseYear[y] ?? 0) + 1 }
      if (r.date_added) { const y = String(new Date(r.date_added).getFullYear()); byAddedYear[y] = (byAddedYear[y] ?? 0) + 1 }
    }
    const allYears = new Set([...Object.keys(byReleaseYear), ...Object.keys(byAddedYear)])
    return Array.from(allYears).sort().map(year => ({ year, releases: byReleaseYear[year] ?? 0, added: byAddedYear[year] ?? 0 }))
  }, [discogsReleases])

  // Top artists by record count (Various Artists skipped)
  const topDiscogsArtists = useMemo(() => {
    if (discogsReleases.length === 0) return [] as { name: string; total: number; formatCounts: Record<DiscogsFmt, number>; releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null }[] }[]
    const map: Record<string, { name: string; total: number; formatCounts: Record<DiscogsFmt, number>; releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null }[] }> = {}
    for (const r of discogsReleases) {
      const fmt = getDiscogsFmt(r.formats)
      const artists = r.discogs_artist_names.filter(n => { const nl = n.toLowerCase(); return nl !== 'various' && nl !== 'various artists' })
      if (artists.length === 0) continue
      for (const artistName of artists) {
        if (!map[artistName]) map[artistName] = { name: artistName, total: 0, formatCounts: { vinyl: 0, cd: 0, cassette: 0, other: 0 }, releases: [] }
        map[artistName].total++
        map[artistName].formatCounts[fmt]++
        map[artistName].releases.push({ title: r.title, year: r.year, fmt, date_added: r.date_added })
      }
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 50)
  }, [discogsReleases])

  // Format donut data
  const discogsFormatData = useMemo(() => {
    if (discogsReleases.length === 0) return [] as { fmt: DiscogsFmt; label: string; value: number; color: string }[]
    const counts: Record<DiscogsFmt, number> = { vinyl: 0, cd: 0, cassette: 0, other: 0 }
    for (const r of discogsReleases) counts[getDiscogsFmt(r.formats)]++
    return DISCOGS_FMT_KEYS
      .map(fmt => ({ fmt, label: DISCOGS_FMT_META[fmt].label, value: counts[fmt], color: DISCOGS_FMT_META[fmt].color }))
      .filter(d => d.value > 0)
  }, [discogsReleases])

  // Filtered artists (format filter + text filter)
  const filteredDiscogsArtists = useMemo(() => {
    const fmtFiltered = discogsFmtFilter === 'all' ? topDiscogsArtists : topDiscogsArtists.filter(a => a.formatCounts[discogsFmtFilter] > 0)
    if (!filterText.trim()) return fmtFiltered
    const q = filterText.toLowerCase()
    return fmtFiltered.filter(a => a.name.toLowerCase().includes(q) || a.releases.some(r => r.title.toLowerCase().includes(q)))
  }, [topDiscogsArtists, discogsFmtFilter, filterText])


  // ── Day-level data (GP-112) ──────────────────────────────────────────────
  const dayTimelineData = useMemo(() => {
    if (selectedMonth === null || !selectedYear || viewMode !== 'spotify') return [] as { day: string; shows: number; albumReleases: string[] }[]
    const q = filterText.trim().toLowerCase()
    const src = q ? spotifySongs.filter(s => s.artist_name.toLowerCase().includes(q) || (s.spotify_album_name?.toLowerCase().includes(q) ?? false)) : spotifySongs
    const byDay: Record<number, number> = {}
    for (const song of src) {
      const dt = new Date(song.added_at)
      if (String(dt.getFullYear()) !== selectedYear || dt.getMonth() !== selectedMonth) continue
      const d = dt.getDate(); byDay[d] = (byDay[d] ?? 0) + 1
    }
    const albumReleasesByDay: Record<number, string[]> = {}
    const seenAlbums = new Set<string>()
    for (const song of src) {
      if (!song.spotify_album_release_date || !song.spotify_album_name) continue
      if (song.spotify_album_release_date.length < 10) continue
      const rel = new Date(song.spotify_album_release_date + 'T12:00:00')
      if (String(rel.getFullYear()) !== selectedYear || rel.getMonth() !== selectedMonth) continue
      const albumKey = `${song.spotify_album_name}::${song.spotify_artist_id ?? ''}`
      if (seenAlbums.has(albumKey)) continue
      seenAlbums.add(albumKey)
      const d = rel.getDate()
      if (!albumReleasesByDay[d]) albumReleasesByDay[d] = []
      albumReleasesByDay[d].push(song.spotify_album_name)
    }
    const daysInMonth = new Date(parseInt(selectedYear), selectedMonth + 1, 0).getDate()
    return Array.from({ length: daysInMonth }, (_, i) => ({ day: String(i + 1), shows: byDay[i + 1] ?? 0, albumReleases: albumReleasesByDay[i + 1] ?? [] }))
  }, [spotifySongs, selectedYear, selectedMonth, viewMode, filterText])

  // ── Text-filtered base ────────────────────────────────────────────────────
  const textFiltered = useMemo(() => {
    if (!filterText.trim()) return shows
    const q = filterText.toLowerCase()
    return shows.filter(s => s.artist.artist_name.toLowerCase().includes(q) || s.venue.venue_name.toLowerCase().includes(q) || (s.festival_name ?? '').toLowerCase().includes(q))
  }, [shows, filterText])

  const filterRange = useMemo(() => {
    if (!filterText.trim() || textFiltered.length === 0) return null
    const years = textFiltered.map(s => s.date.split('-')[0]).sort()
    const first = years[0]; const last = years[years.length - 1]
    return first === last ? first : `${first}–${last}`
  }, [textFiltered, filterText])

  const yearFiltered = useMemo(() => {
    if (!selectedYear) return textFiltered
    return textFiltered.filter(s => s.date.split('-')[0] === selectedYear)
  }, [textFiltered, selectedYear])

  const yearTimelineData = useMemo(() => {
    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      const src = q ? spotifySongs.filter(s => s.artist_name.toLowerCase().includes(q) || (s.spotify_album_name?.toLowerCase().includes(q) ?? false)) : spotifySongs
      const byYear: Record<string, number> = {}
      const artistsByYear: Record<string, Set<string>> = {}
      for (const song of src) {
        const y = String(new Date(song.added_at).getFullYear())
        byYear[y] = (byYear[y] ?? 0) + 1
        if (song.spotify_artist_id) { if (!artistsByYear[y]) artistsByYear[y] = new Set(); artistsByYear[y].add(song.spotify_artist_id) }
      }
      const albumsByReleaseYear: Record<string, Set<string>> = {}
      for (const song of src) {
        if (!song.spotify_album_release_date || !song.spotify_album_name) continue
        const releaseYear = song.spotify_album_release_date.substring(0, 4)
        if (!albumsByReleaseYear[releaseYear]) albumsByReleaseYear[releaseYear] = new Set()
        albumsByReleaseYear[releaseYear].add(song.spotify_album_name)
      }
      return Object.entries(byYear).sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => ({ year, shows: count, albumCount: albumsByReleaseYear[year]?.size ?? 0, artistCount: artistsByYear[year]?.size ?? 0 }))
    }
    // Discogs mode: return empty so chart uses discogsTimelineData directly
    if (viewMode === 'discogs') return []
    let src: (Show | BillGroup)[]
    if (viewMode === 'festivals') { src = textFiltered.filter(isFestivalShow) }
    else if (viewMode === 'shows') { const groups = buildBillGroups(textFiltered.filter(s => !isFestivalShow(s))); src = groups }
    else { src = textFiltered }
    const byYear: Record<string, number> = {}
    for (const item of src) { const date = 'date' in item ? item.date : (item as Show).date; const y = date.split('-')[0]; byYear[y] = (byYear[y] ?? 0) + 1 }
    return Object.entries(byYear).sort(([a],[b]) => a.localeCompare(b)).map(([year, count]) => ({ year, shows: count }))
  }, [textFiltered, viewMode, spotifySongs, filterText])

  const availableYears = useMemo(() => yearTimelineData.map(d => d.year), [yearTimelineData])

  // GP-79: Slideshow
  useEffect(() => {
    if (!isPlaying) return
    const id = setInterval(() => {
      setSelectedYear(prev => {
        if (!prev) { setIsPlaying(false); return prev }
        const idx = availableYears.indexOf(prev)
        if (idx === -1 || idx >= availableYears.length - 1) { setIsPlaying(false); return prev }
        return availableYears[idx + 1]
      })
    }, 1500)
    return () => clearInterval(id)
  }, [isPlaying, availableYears])

  const monthTimelineData = useMemo(() => {
    if (!selectedYear) return []
    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      const src = q ? spotifySongs.filter(s => s.artist_name.toLowerCase().includes(q) || (s.spotify_album_name?.toLowerCase().includes(q) ?? false)) : spotifySongs
      const songsByMonth: Record<number, number> = {}
      for (const song of src) { const dt = new Date(song.added_at); if (String(dt.getFullYear()) !== selectedYear) continue; const m = dt.getMonth(); songsByMonth[m] = (songsByMonth[m] ?? 0) + 1 }
      const albumCountByMonth: Record<number, number> = {}
      const seenAlbumsForCount = new Set<string>()
      for (const song of src) {
        if (!song.spotify_album_release_date || !song.spotify_album_name) continue
        if (song.spotify_album_release_date.length < 7) continue
        if (!song.spotify_album_release_date.startsWith(selectedYear)) continue
        const albumKey = `${song.spotify_album_name}::${song.spotify_artist_id ?? ''}`
        if (seenAlbumsForCount.has(albumKey)) continue
        seenAlbumsForCount.add(albumKey)
        const month = parseInt(song.spotify_album_release_date.substring(5, 7)) - 1
        albumCountByMonth[month] = (albumCountByMonth[month] ?? 0) + 1
      }
      const albumReleasesByMonth: Record<number, { name: string; ordinal: number }[]> = {}
      if (q) {
        const uniqueArtistIds = new Set(src.map(s => s.spotify_artist_id).filter(Boolean))
        if (uniqueArtistIds.size === 1) {
          const [singleArtistId] = uniqueArtistIds
          const seenAlbums = new Set<string>()
          const releases: { name: string; releaseDate: string; month: number }[] = []
          for (const song of spotifySongs) {
            if (song.spotify_artist_id !== singleArtistId) continue
            if (!song.spotify_album_release_date || !song.spotify_album_name) continue
            if (song.spotify_album_release_date.length < 7) continue
            if (!song.spotify_album_release_date.startsWith(selectedYear)) continue
            if (seenAlbums.has(song.spotify_album_name)) continue
            seenAlbums.add(song.spotify_album_name)
            const month = parseInt(song.spotify_album_release_date.substring(5, 7)) - 1
            releases.push({ name: song.spotify_album_name, releaseDate: song.spotify_album_release_date, month })
          }
          releases.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
          releases.forEach((r, i) => { if (!albumReleasesByMonth[r.month]) albumReleasesByMonth[r.month] = []; albumReleasesByMonth[r.month].push({ name: r.name, ordinal: i + 1 }) })
        }
      }
      const hasReleaseMarkers = Object.keys(albumReleasesByMonth).length > 0
      return Array.from({ length: 12 }, (_, m) => ({ month: MONTHS[m], shows: songsByMonth[m] ?? 0, albumMonthCount: albumCountByMonth[m] ?? 0, ...(hasReleaseMarkers ? { albumReleases: albumReleasesByMonth[m] ?? [] } : {}) }))
    }
    const src = viewMode === 'festivals'
      ? textFiltered.filter(isFestivalShow).filter(s => s.date.split('-')[0] === selectedYear)
      : textFiltered.filter(s => s.date.split('-')[0] === selectedYear)
    const byMonth: Record<number, number> = {}
    for (let m = 0; m < 12; m++) byMonth[m] = 0
    for (const s of src) { const m = parseInt(s.date.split('-')[1]) - 1; byMonth[m]++ }
    const contextualByMonth = artistContextualByYearMonth[selectedYear] ?? {}
    const hasContextual = Object.keys(contextualByMonth).length > 0
    return Array.from({ length: 12 }, (_, m) => ({ month: MONTHS[m], shows: byMonth[m], albumMonthCount: 0, ...(hasSpotify && hasContextual ? { songs: contextualByMonth[m] ?? 0 } : {}) }))
  }, [textFiltered, selectedYear, viewMode, spotifySongs, filterText, artistContextualByYearMonth, hasSpotify])

  const firstYear = stats.firstShow?.date.split('-')[0]
  const lastYear  = stats.lastShow?.date.split('-')[0]
  const drilldownHasSpotify = selectedYear ? spotifySongs.length > 0 && viewMode !== 'spotify' && Object.keys(artistContextualByYearMonth[selectedYear] ?? {}).length > 0 : false
  // GP-118: show 'added to collection' secondary line in Discogs mode when data exists
  const drilldownHasDiscogsAdded = viewMode === 'discogs' && discogsTimelineData.some(d => d.added > 0)

  const chartLineColor = viewMode === 'spotify' ? SPOTIFY_GREEN : viewMode === 'discogs' ? DISCOGS_COLOR : TEAL
  const timelineLegendLabel = viewMode === 'spotify' ? 'Songs added per year'
    : viewMode === 'discogs' ? 'Releases by year'
    : viewMode === 'sets' ? 'Sets per year'
    : viewMode === 'festivals' ? 'Festivals per year'
    : 'Shows per year'

  // ── Top artists / venues ──────────────────────────────────────────────────
  const topArtists = useMemo(() => {
    const src = viewMode === 'festivals' ? yearFiltered.filter(isFestivalShow) : yearFiltered
    const map: Record<number, { name: string; spotifyId: string | null; total: number; byCapacity: Record<string, number>; byVenue: Record<string, number>; showsByYear: Record<string, { venue: string; capKey: CapFilter }[]> }> = {}
    for (const s of src) {
      const id = s.artist.artist_id; const capKey = getCapMeta(s.venue.capacity_category).key as CapFilter; const year = s.date.split('-')[0]
      if (!map[id]) map[id] = { name: s.artist.artist_name, spotifyId: s.artist.spotify_artist_id, total: 0, byCapacity: {}, byVenue: {}, showsByYear: {} }
      map[id].total++; map[id].byCapacity[capKey] = (map[id].byCapacity[capKey] ?? 0) + 1; map[id].byVenue[s.venue.venue_name] = (map[id].byVenue[s.venue.venue_name] ?? 0) + 1
      if (!map[id].showsByYear[year]) map[id].showsByYear[year] = []
      map[id].showsByYear[year].push({ venue: s.venue.venue_name, capKey })
    }
    return Object.values(map).map(a => { const venueBreakdown = Object.entries(a.byVenue).map(([name, count]) => ({ name, count })).sort((x, y) => y.count - x.count); return { ...a, venueBreakdown } }).sort((a, b) => b.total - a.total)
  }, [yearFiltered, viewMode])

  const maxArtistShows = topArtists[0]?.total ?? 1

  const topVenues = useMemo(() => {
    const src = viewMode === 'festivals' ? yearFiltered.filter(isFestivalShow) : yearFiltered
    const map: Record<number, { name: string; total: number; byCapacity: Record<string, number>; showsByYear: Record<string, { artist: string; capKey: CapFilter }[]> }> = {}
    for (const s of src) {
      const id = s.venue.venue_id; const capKey = getCapMeta(s.venue.capacity_category).key as CapFilter; const year = s.date.split('-')[0]
      if (!map[id]) map[id] = { name: s.venue.venue_name, total: 0, byCapacity: {}, showsByYear: {} }
      map[id].total++; map[id].byCapacity[capKey] = (map[id].byCapacity[capKey] ?? 0) + 1
      if (!map[id].showsByYear[year]) map[id].showsByYear[year] = []
      map[id].showsByYear[year].push({ artist: s.artist.artist_name, capKey })
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [yearFiltered, viewMode])

  const maxVenueShows = topVenues[0]?.total ?? 1

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
    const donut = CAP_KEYS.map(key => ({ name: CAP_BY_KEY[key].legendLabel, shortName: CAP_BY_KEY[key].legendLabel.split(' ')[0], key, value: counts[key] ?? 0, color: CAP_BY_KEY[key].color })).filter(d => d.value > 0)
    const breakdown: Record<string, { name: string; count: number }[]> = {}
    for (const [k, venues] of Object.entries(venueByCap)) { breakdown[k] = Object.values(venues).sort((a, b) => b.count - a.count) }
    return { donutData: donut, venueBreakdown: breakdown }
  }, [yearFiltered, viewMode])

  const billGroups = useMemo(() => {
    const src = yearFiltered.filter(s => !isFestivalShow(s))
    const filtered = capFilter === 'all' ? src : src.filter(s => getCapMeta(s.venue.capacity_category).key === capFilter)
    return buildBillGroups(filtered)
  }, [yearFiltered, capFilter])

  const festivalGroups = useMemo(() => {
    const src = yearFiltered.filter(isFestivalShow)
    const map = new Map<string, Show[]>()
    for (const s of src) { const key = `${s.festival_name ?? 'Unknown'}__${s.date.split('-')[0]}`; if (!map.has(key)) map.set(key, []); map.get(key)!.push(s) }
    const groups = Array.from(map.entries()).map(([key, fs]) => {
      const [name] = key.split('__'); const sorted = [...fs].sort((a, b) => b.date.localeCompare(a.date)); const dates = fs.map(s => s.date).sort()
      return { key, festival_name: name, year: fs[0].date.split('-')[0], shows: sorted, date_from: dates[0], date_to: dates[dates.length - 1], venue_name: fs[0].venue.venue_name }
    }).sort((a, b) => b.date_to.localeCompare(a.date_to))
    return groups
  }, [yearFiltered])

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

  const filteredSpotifyArtists = useMemo(() => {
    if (!filterText.trim()) return topSpotifyArtists
    const q = filterText.toLowerCase()
    return topSpotifyArtists.filter(a => a.name.toLowerCase().includes(q) || a.albums.some(alb => alb.name?.toLowerCase().includes(q)))
  }, [topSpotifyArtists, filterText])

  const totalPages   = Math.ceil(setsFiltered.length / PER_PAGE)
  const currentShows = setsFiltered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const dynamicStats = useMemo(() => {
    // GP-118: Discogs mode stats
    if (viewMode === 'discogs') {
      const fmtFiltered = discogsFmtFilter === 'all' ? discogsReleases : discogsReleases.filter(r => getDiscogsFmt(r.formats) === discogsFmtFilter)
      const q = filterText.trim().toLowerCase()
      const src = q ? fmtFiltered.filter(r => r.discogs_artist_names.some(n => n.toLowerCase().includes(q)) || r.title.toLowerCase().includes(q)) : fmtFiltered
      const nonVarious = new Set(src.flatMap(r => r.discogs_artist_names.filter(n => { const nl = n.toLowerCase(); return nl !== 'various' && nl !== 'various artists' })))
      return { sets: src.length, shows: 0, artists: nonVarious.size, venues: 0, festivals: 0 }
    }
    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      const artistFiltered = q ? spotifySongs.filter(s => s.artist_name.toLowerCase().includes(q) || (s.spotify_album_name?.toLowerCase().includes(q) ?? false)) : spotifySongs
      const src = selectedYear ? artistFiltered.filter(s => { const dt = new Date(s.added_at); if (dt.getFullYear() !== parseInt(selectedYear)) return false; if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false; return true }) : artistFiltered
      return { sets: src.length, shows: 0, artists: new Set(src.map(s => s.spotify_artist_id).filter(Boolean)).size, venues: 0, festivals: 0 }
    }
    if (viewMode === 'shows') {
      const sets = billGroups.reduce((n, g) => n + g.shows.length, 0)
      return { sets, shows: billGroups.length, artists: new Set(billGroups.flatMap(g => g.shows.map(s => s.artist.artist_id))).size, venues: new Set(billGroups.flatMap(g => g.shows.map(s => s.venue.venue_id))).size, festivals: 0 }
    }
    if (viewMode === 'sets') {
      return { sets: setsFiltered.length, shows: 0, artists: new Set(setsFiltered.map(s => s.artist.artist_id)).size, venues: new Set(setsFiltered.map(s => s.venue.venue_id)).size, festivals: 0 }
    }
    return { sets: festivalGroups.reduce((n, g) => n + g.shows.length, 0), shows: 0, artists: new Set(festivalGroups.flatMap(g => g.shows.map(s => s.artist.artist_id))).size, venues: new Set(festivalGroups.flatMap(g => g.shows.map(s => s.venue.venue_id))).size, festivals: festivalGroups.length }
  }, [viewMode, billGroups, setsFiltered, festivalGroups, spotifySongs, selectedYear, selectedMonth, filterText, discogsReleases, discogsFmtFilter])


  // ── Handlers ─────────────────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setSelectedYear(null); setSelectedMonth(null); setCapFilter('all')
    setFilterText(''); setPage(1); setPageInput('1')
    setDiscogsFmtFilter('all'); setShowAllDiscogsArtists(false)
  }, [])

  const applyFilter = useCallback((year: string | null, month: number | null = null) => {
    setSelectedYear(year); setSelectedMonth(month); setPage(1); setPageInput('1')
  }, [])

  const handleYearSegmentClick = useCallback((e: React.MouseEvent<SVGElement | HTMLElement>, year: string) => {
    setSelectedYear(prev => prev === year ? null : year)
    setSelectedMonth(null); setPage(1); setPageInput('1')
  }, [])

  const handleSpotifySegmentClick = useCallback((_artistName: string, year: string, _spotifyId: string) => {
    setSelectedYear(prev => prev === year ? null : year)
    setSelectedMonth(null); setPage(1); setPageInput('1')
  }, [])

  const handleAlbumClick = useCallback((artistName: string, releaseYear: string | null, artistId: string | null, addedYear: string | null) => {
    setFilterText(artistName)
    if (addedYear) { setSelectedYear(addedYear); setSelectedMonth(null) }
    setSpotifyReleaseFocus(artistId && releaseYear ? { artistId, releaseYear } : null)
    setPage(1); setPageInput('1')
    setSpotifyLibraryView('artists')
  }, [])

  const removeShow = useCallback(async (showId: number) => {
    if (readOnly) return
    setRemovingSet(prev => new Set(prev).add(showId))
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setRemovingSet(prev => { const n = new Set(prev); n.delete(showId); return n }); return }
    await supabase.from('user_shows').delete().eq('show_id', showId).eq('user_id', user.id)
    setShows(prev => prev.filter(s => s.show_id !== showId))
    setRemovingSet(prev => { const n = new Set(prev); n.delete(showId); return n })
    setSessionShowsModified(true)
  }, [supabase, readOnly])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) { setSortDir(prev => prev === 'asc' ? 'desc' : 'asc') }
    else { setSortField(field); setSortDir('desc') }
    setPage(1); setPageInput('1')
  }, [sortField])

  const handlePage = useCallback((p: number) => {
    const clamped = Math.max(1, Math.min(p, totalPages))
    setPage(clamped); setPageInput(String(clamped))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [totalPages])

  // Unadded handlers
  const handleAddUnadded = useCallback(async (showId: number, artistId?: number) => {
    if (readOnly) return
    if (artistId) setAddingIndividual(prev => new Set(prev).add(showId))
    else setAddingUnadded(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const targets = artistId ? [unaddedArtists.find(a => a.show_id === showId)] : unaddedArtists
      for (const a of targets) {
        if (!a) continue
        await supabase.from('user_shows').upsert({ user_id: user.id, show_id: a.show_id }, { onConflict: 'user_id,show_id' })
        const { data: newShow } = await supabase
          .from('fact_shows').select('show_id, date, setlist_url, show_type, festival_name, added_at, notes, source, match_score, dim_artist ( artist_id, artist_name, monthly_listeners, spotify_artist_id ), dim_venue ( venue_id, venue_name, capacity, capacity_category )')
          .eq('show_id', a.show_id).single()
        if (newShow) {
          const mapped: Show = {
            show_id: newShow.show_id, date: newShow.date, setlist_url: newShow.setlist_url, show_type: newShow.show_type, festival_name: newShow.festival_name, added_at: newShow.added_at, notes: newShow.notes, source: newShow.source, match_score: newShow.match_score,
            artist: Array.isArray(newShow.dim_artist) ? newShow.dim_artist[0] : newShow.dim_artist,
            venue: Array.isArray(newShow.dim_venue) ? newShow.dim_venue[0] : newShow.dim_venue,
          }
          setShows(prev => [...prev, mapped])
        }
        setUnaddedArtists(prev => prev.filter(u => u.show_id !== a.show_id))
      }
      setSessionShowsModified(true)
    } finally {
      setAddingUnadded(false)
      setAddingIndividual(prev => { const n = new Set(prev); n.delete(showId); return n })
    }
  }, [unaddedArtists, supabase, readOnly])

  const handleSkipUnadded = useCallback(async (showId?: number) => {
    if (readOnly) return
    if (showId) setSkippingIndividual(prev => new Set(prev).add(showId))
    else setSkippingAll(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const targets = showId ? [unaddedArtists.find(a => a.show_id === showId)] : unaddedArtists
      for (const a of targets) {
        if (!a) continue
        await supabase.from('user_show_reviews').upsert({ user_id: user.id, show_id: a.show_id, reviewed_at: new Date().toISOString() }, { onConflict: 'user_id,show_id' })
        setUnaddedArtists(prev => prev.filter(u => u.show_id !== a.show_id))
        setSkippedArtists(prev => [...prev, a])
      }
    } finally {
      setSkippingAll(false)
      setSkippingIndividual(prev => { const n = new Set(prev); n.delete(showId ?? 0); return n })
    }
  }, [unaddedArtists, supabase, readOnly])

  const handleRestoreSkipped = useCallback(async (showId: number) => {
    if (readOnly) return
    setRestoringIndividual(prev => new Set(prev).add(showId))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_show_reviews').delete().eq('user_id', user.id).eq('show_id', showId)
      const a = skippedArtists.find(x => x.show_id === showId)
      if (a) { setSkippedArtists(prev => prev.filter(x => x.show_id !== showId)); setUnaddedArtists(prev => [...prev, a]) }
    } finally {
      setRestoringIndividual(prev => { const n = new Set(prev); n.delete(showId); return n })
    }
  }, [skippedArtists, supabase, readOnly])


  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navigation />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Profile header */}
        {profileHeader && <ProfileHeaderCard header={profileHeader} readOnly={readOnly} />}

        {/* Unadded artists CTA */}
        {!readOnly && unaddedArtists.length > 0 && !unaddedDismissed && (
          <div className="bg-card rounded-lg shadow border border-primary/40 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {unaddedArtists.length === 1 ? '1 more act was at this show' : `${unaddedArtists.length} more acts were at shows you attended`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Add them to your Grooveprint?</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setUnaddedExpanded(v => !v)} className="text-xs text-primary hover:underline">
                  {unaddedExpanded ? 'Hide' : 'View all'}
                </button>
                <button onClick={() => handleAddUnadded(-1)} disabled={addingUnadded}
                  className="px-3 py-1.5 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-lg transition-colors">
                  {addingUnadded ? <span className="inline-block w-3.5 h-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" /> : 'Add All'}
                </button>
                <button onClick={() => setUnaddedDismissed(true)} className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
              </div>
            </div>
            {unaddedExpanded && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {unaddedArtists.map(a => (
                  <div key={a.show_id} className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{a.artist_name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(a.date)} · {a.venue_name}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => handleAddUnadded(a.show_id, a.show_id)} disabled={addingIndividual.has(a.show_id)}
                        className="px-2.5 py-1 bg-primary hover:opacity-90 disabled:opacity-50 text-primary-foreground text-xs font-medium rounded-md transition-colors">
                        {addingIndividual.has(a.show_id) ? '…' : 'Add'}
                      </button>
                      <button onClick={() => handleSkipUnadded(a.show_id)} disabled={skippingIndividual.has(a.show_id)}
                        className="px-2.5 py-1 border border-border hover:bg-muted text-muted-foreground text-xs rounded-md transition-colors disabled:opacity-50">
                        {skippingIndividual.has(a.show_id) ? '…' : 'Skip'}
                      </button>
                    </div>
                  </div>
                ))}
                {skippedArtists.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-border/40">
                    <button onClick={() => setSkippedExpanded(v => !v)} className="text-xs text-muted-foreground hover:underline">
                      {skippedExpanded ? 'Hide' : `Show ${skippedArtists.length} skipped`}
                    </button>
                    {skippedExpanded && (
                      <div className="mt-2 space-y-1.5">
                        {skippedArtists.map(a => (
                          <div key={a.show_id} className="flex items-center justify-between gap-3 opacity-50">
                            <div className="min-w-0">
                              <p className="text-sm text-foreground truncate">{a.artist_name}</p>
                              <p className="text-xs text-muted-foreground">{fmtDate(a.date)} · {a.venue_name}</p>
                            </div>
                            <button onClick={() => handleRestoreSkipped(a.show_id)} disabled={restoringIndividual.has(a.show_id)}
                              className="px-2.5 py-1 border border-border hover:bg-muted text-muted-foreground text-xs rounded-md transition-colors disabled:opacity-50 flex-shrink-0">
                              {restoringIndividual.has(a.show_id) ? '…' : 'Restore'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="pt-1">
                  <button onClick={() => handleSkipUnadded()} disabled={skippingAll}
                    className="text-xs text-muted-foreground hover:underline disabled:opacity-50">
                    {skippingAll ? 'Skipping…' : 'Skip all'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── View mode tabs ── */}
        <div className="bg-card rounded-lg shadow border border-border">
          <div className="flex items-center gap-1 p-1.5 overflow-x-auto">
            {(['shows','sets','festivals'] as ViewMode[]).map(mode => (
              <button key={mode} onClick={() => { setViewMode(mode); setSelectedYear(null); setSelectedMonth(null); setPage(1); setPageInput('1') }}
                className={`flex-shrink-0 px-3 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                {mode}
              </button>
            ))}
            {hasSpotify && (
              <button onClick={() => { setViewMode('spotify'); setSelectedYear(null); setSelectedMonth(null); setPage(1); setPageInput('1') }}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'spotify' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <SpotifyIcon className="w-3 h-3" fill={viewMode === 'spotify' ? 'currentColor' : SPOTIFY_GREEN} />
                Spotify
              </button>
            )}
            {/* GP-118: Discogs tab */}
            {hasDiscogs && (
              <button onClick={() => { setViewMode('discogs'); setSelectedYear(null); setSelectedMonth(null); setPage(1); setPageInput('1') }}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === 'discogs' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
                <DiscogsIcon className="w-3.5 h-3.5" />
                Discogs
              </button>
            )}
            <div className="flex-1" />
            {anyFilterActive && (
              <button onClick={clearAll} className="flex-shrink-0 px-2.5 py-1.5 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                Clear ×
              </button>
            )}
          </div>
        </div>

        {/* ── Timeline card ── */}
        {(viewMode === 'discogs' ? hasDiscogs : yearTimelineData.length > 0) && (
          <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
            {/* Header row */}
            <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
              <div>
                <h2 className="text-lg font-bold text-foreground">
                  {viewMode === 'discogs' ? 'Collection Timeline'
                    : viewMode === 'spotify' ? (selectedYear ? `${selectedYear} Listening` : 'Your Listening History')
                    : (selectedYear ? `${selectedYear} ${viewMode === 'festivals' ? 'Festivals' : 'Shows'}` : 'Your Show History')}
                </h2>
                {/* Stat badges */}
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-sm">
                  {viewMode === 'shows' && <>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.shows.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.shows === 1 ? 'show' : 'shows'}</span></span>
                    {dynamicStats.sets !== dynamicStats.shows && <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.sets.toLocaleString()}</span><span className="text-muted-foreground"> sets</span></span>}
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.artists.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.artists === 1 ? 'artist' : 'artists'}</span></span>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.venues.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.venues === 1 ? 'venue' : 'venues'}</span></span>
                  </>}
                  {viewMode === 'sets' && <>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.sets.toLocaleString()}</span><span className="text-muted-foreground"> sets</span></span>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.artists.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.artists === 1 ? 'artist' : 'artists'}</span></span>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.venues.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.venues === 1 ? 'venue' : 'venues'}</span></span>
                  </>}
                  {viewMode === 'festivals' && <>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.festivals.toLocaleString()}</span><span className="text-muted-foreground"> {dynamicStats.festivals === 1 ? 'festival' : 'festivals'}</span></span>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: TEAL }}>{dynamicStats.sets.toLocaleString()}</span><span className="text-muted-foreground"> sets</span></span>
                  </>}
                  {viewMode === 'spotify' && <>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: SPOTIFY_GREEN }}>{dynamicStats.sets.toLocaleString()}</span><span className="text-muted-foreground"> songs</span></span>
                    {dynamicStats.artists > 0 && <span className="bg-muted rounded-md px-2 py-0.5 font-medium"><span style={{ color: SPOTIFY_GREEN }}>{dynamicStats.artists.toLocaleString()}</span><span className="text-muted-foreground"> artists</span></span>}
                  </>}
                  {viewMode === 'discogs' && <>
                    <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                      <span style={{ color: DISCOGS_COLOR }}>{(discogsFmtFilter === 'all' ? discogsReleases : discogsReleases.filter(r => getDiscogsFmt(r.formats) === discogsFmtFilter)).length.toLocaleString()}</span>
                      <span className="text-muted-foreground"> records</span>
                    </span>
                    {dynamicStats.artists > 0 && <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                      <span style={{ color: DISCOGS_COLOR }}>{dynamicStats.artists.toLocaleString()}</span>
                      <span className="text-muted-foreground"> artists</span>
                    </span>}
                  </>}
                </div>
              </div>

              {/* Filter controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text" value={filterText} onChange={e => { setFilterText(e.target.value); setPage(1); setPageInput('1') }}
                  placeholder={viewMode === 'spotify' || viewMode === 'discogs' ? 'Filter by artist or album…' : 'Filter by artist or venue…'}
                  className="w-44 md:w-56 px-2.5 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary" />
                {viewMode !== 'spotify' && viewMode !== 'discogs' && (
                  <select value={capFilter} onChange={e => { setCapFilter(e.target.value as CapFilter); setPage(1); setPageInput('1') }}
                    className="px-2.5 py-1.5 bg-muted border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                    <option value="all">All sizes</option>
                    {CAP_KEYS.filter(k => k !== 'unknown').map(k => <option key={k} value={k}>{CAP_BY_KEY[k].legendLabel}</option>)}
                    <option value="unknown">Unknown</option>
                  </select>
                )}
                {viewMode === 'spotify' && (
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 border border-border">
                    <button onClick={() => setSpotifyLibraryView('artists')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${spotifyLibraryView === 'artists' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Artists</button>
                    <button onClick={() => setSpotifyLibraryView('albums')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${spotifyLibraryView === 'albums' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Albums</button>
                  </div>
                )}
              </div>
            </div>

            {/* Timeline legend */}
            <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block" style={{ background: chartLineColor }} />
                {viewMode === 'discogs' ? 'Releases by release year' : (selectedYear ? (selectedMonth !== null ? `${MONTHS[selectedMonth]} shows` : `${selectedYear} by month`) : timelineLegendLabel)}
              </span>
              {drilldownHasSpotify && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SPOTIFY_GREEN }} />
                  Matched songs
                </span>
              )}
              {/* GP-118: date_added secondary legend for Discogs */}
              {drilldownHasDiscogsAdded && (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: TEAL }} />
                  Added to collection
                </span>
              )}
              {viewMode !== 'sets' && viewMode !== 'spotify' && viewMode !== 'discogs' && (
                <span className="text-muted-foreground/50 text-[10px]">
                  Tip: click a bar to drill into that year
                </span>
              )}
            </div>

            {/* Chart */}
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                {/* GP-118: Discogs timeline (non-interactive, release year + date_added) */}
                {viewMode === 'discogs' ? (
                  <ComposedChart data={discogsTimelineData} style={{ cursor: 'default' }}>
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false}
                      interval="preserveStartEnd" />
                    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<DiscogsTip />} />
                    <Area yAxisId="left" type="monotone" dataKey="releases" stroke={DISCOGS_COLOR} fill={`${DISCOGS_COLOR}30`} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: DISCOGS_COLOR }} />
                    {drilldownHasDiscogsAdded && (
                      <Line yAxisId="right" type="monotone" dataKey="added" stroke={TEAL} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: TEAL }} strokeDasharray="4 2" />
                    )}
                  </ComposedChart>
                ) : viewMode === 'spotify' && selectedMonth !== null ? (
                  <ComposedChart data={dayTimelineData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} interval={3} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<DayTip month={selectedMonth} year={selectedYear} />} />
                    <Area type="monotone" dataKey="shows" stroke={SPOTIFY_GREEN} fill={`${SPOTIFY_GREEN}30`} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: SPOTIFY_GREEN }} />
                  </ComposedChart>
                ) : selectedYear || viewMode === 'spotify' || viewMode === 'festivals' ? (
                  <ComposedChart data={monthTimelineData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}
                    onClick={(data: any) => {
                      if (viewMode === 'spotify' && data?.activePayload) {
                        const monthIdx = MONTHS.indexOf(data.activePayload[0]?.payload?.month ?? '')
                        if (monthIdx >= 0) setSelectedMonth(prev => prev === monthIdx ? null : monthIdx)
                      }
                    }}
                    style={{ cursor: viewMode === 'spotify' ? 'pointer' : 'default' }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<MonthTip viewMode={viewMode} />} />
                    <Area type="monotone" dataKey="shows" stroke={chartLineColor} fill={`${chartLineColor}30`} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: chartLineColor }} />
                    {drilldownHasSpotify && <Line type="monotone" dataKey="songs" stroke={SPOTIFY_GREEN} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: SPOTIFY_GREEN }} />}
                  </ComposedChart>
                ) : (
                  <ComposedChart data={yearTimelineData} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
                    <XAxis dataKey="year" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false}
                      interval={yearTimelineData.length > 20 ? Math.floor(yearTimelineData.length / 10) : 'preserveStartEnd'} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={28} />
                    <Tooltip content={<YearTip viewMode={viewMode} />} />
                    <Area type="monotone" dataKey="shows" stroke={chartLineColor} fill={`${chartLineColor}30`} strokeWidth={2} dot={yearTimelineData.length < 30}
                      activeDot={{ r: 4, fill: chartLineColor, cursor: viewMode !== 'spotify' ? 'pointer' : 'default' }}
                      onClick={(d: any) => { if (viewMode !== 'spotify' && d?.activePayload?.[0]?.payload?.year) handleYearSegmentClick(d, d.activePayload[0].payload.year) }} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Year nav pills — hidden in Discogs mode (non-interactive chart) */}
            {viewMode !== 'discogs' && selectedMonth !== null && selectedYear ? (() => {
              const days = Array.from({ length: new Date(parseInt(selectedYear), selectedMonth + 1, 0).getDate() }, (_, i) => String(i + 1))
              return (
                <div className="flex items-center gap-1 mt-3 flex-wrap">
                  <button onClick={() => setSelectedMonth(null)} className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">← {MONTHS[selectedMonth]} {selectedYear}</button>
                </div>
              )
            })() : viewMode !== 'discogs' && selectedYear ? (
              <div className="flex items-center gap-1 mt-3 flex-wrap">
                <button onClick={() => { setSelectedYear(null); setSelectedMonth(null) }}
                  className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">← All years</button>
                <span className="text-xs text-muted-foreground font-semibold px-1" style={{ color: chartLineColor }}>{selectedYear}</span>
                {viewMode !== 'spotify' && availableYears.length > 1 && (
                  <>
                    <button onClick={() => { setIsPlaying(false); const i = availableYears.indexOf(selectedYear!); if (i > 0) setSelectedYear(availableYears[i - 1]); setSelectedMonth(null) }} disabled={availableYears.indexOf(selectedYear!) <= 0} className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground disabled:opacity-30 transition-colors">‹</button>
                    <button onClick={() => { if (isPlaying) { setIsPlaying(false) } else { const i = availableYears.indexOf(selectedYear!); if (i < availableYears.length - 1) { setIsPlaying(true) } } }} className={`px-2 py-0.5 rounded text-xs transition-colors ${isPlaying ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80 text-muted-foreground'}`} title={isPlaying ? 'Pause' : 'Slideshow'}>{isPlaying ? '⏸' : '▶'}</button>
                    <button onClick={() => { setIsPlaying(false); const i = availableYears.indexOf(selectedYear!); if (i < availableYears.length - 1) setSelectedYear(availableYears[i + 1]); setSelectedMonth(null) }} disabled={availableYears.indexOf(selectedYear!) >= availableYears.length - 1} className="px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground disabled:opacity-30 transition-colors">›</button>
                  </>
                )}
              </div>
            ) : viewMode !== 'spotify' && viewMode !== 'discogs' && (stats.firstShow || stats.lastShow) ? (
              <div className="flex items-start gap-4 mt-3 flex-wrap text-xs text-muted-foreground">
                {stats.firstShow && <div><span className="font-semibold text-foreground">{stats.firstShow.artist.artist_name}</span> · {fmtDate(stats.firstShow.date)} · {stats.firstShow.venue.venue_name}<span className="text-primary ml-1">(first)</span></div>}
                {stats.lastShow && stats.lastShow.show_id !== stats.firstShow?.show_id && <div><span className="font-semibold text-foreground">{stats.lastShow.artist.artist_name}</span> · {fmtDate(stats.lastShow.date)} · {stats.lastShow.venue.venue_name}<span className="text-primary ml-1">(last)</span></div>}
              </div>
            ) : null}
          </div>
        )}

        {/* ── Top Artists / Venues + Donut ── */}
        {(viewMode === 'discogs' ? (hasDiscogs && filteredDiscogsArtists.length > 0) : (topArtists.length > 0 || topVenues.length > 0)) && (
          <div className="flex gap-4 flex-wrap md:flex-nowrap">

            {/* Left panel */}
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 flex-1 min-w-0">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <h2 className="text-lg font-bold text-foreground">
                  {viewMode === 'spotify'
                    ? (spotifyLibraryView === 'albums' ? 'Top Albums in Your Library' : 'Top Artists in Your Library')
                    : viewMode === 'discogs'
                    ? 'Top Artists in Your Collection'
                    : (chartSection === 'artists' ? 'Top Artists' : 'Top Venues')}
                </h2>
                {/* Toggle: hidden in Discogs mode (artists only) */}
                {viewMode === 'spotify' ? (
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 border border-border">
                    <button onClick={() => { setSpotifyLibraryView('artists'); setSpotifyReleaseFocus(null) }} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${spotifyLibraryView === 'artists' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Artists</button>
                    <button onClick={() => setSpotifyLibraryView('albums')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${spotifyLibraryView === 'albums' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Albums</button>
                  </div>
                ) : viewMode !== 'discogs' ? (
                  <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5 border border-border">
                    <button onClick={() => setChartSection('artists')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${chartSection === 'artists' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Artists</button>
                    <button onClick={() => setChartSection('venues')} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${chartSection === 'venues' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Venues</button>
                  </div>
                ) : null}
              </div>

              {/* Spotify focus badge */}
              {spotifyReleaseFocus && viewMode === 'spotify' && spotifyLibraryView === 'artists' && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${SPOTIFY_GREEN}20`, color: SPOTIFY_GREEN, border: `1px solid ${SPOTIFY_GREEN}40` }}>
                    Filtered to {spotifyReleaseFocus.releaseYear} releases
                  </span>
                  <button onClick={() => { setSpotifyReleaseFocus(null); setFilterText(''); setSelectedYear(null) }} className="text-[10px] text-muted-foreground hover:underline">Clear ×</button>
                </div>
              )}

              {/* Bar content */}
              {viewMode === 'spotify' && spotifyLibraryView === 'albums' ? (
                <SpotifyAlbumBars
                  albums={topSpotifyAlbums.slice(0, showAllAlbums ? undefined : 10)}
                  max={topSpotifyAlbums[0]?.count ?? 1}
                  onAlbumClick={handleAlbumClick} />
              ) : viewMode === 'spotify' ? (
                <SpotifyArtistBars
                  artists={filteredSpotifyArtists.filter(a => !spotifyReleaseFocus || (a.spotifyId === spotifyReleaseFocus.artistId && a.albums.some(alb => alb.year === spotifyReleaseFocus.releaseYear))).slice(0, 10)}
                  max={filteredSpotifyArtists[0]?.count ?? 1}
                  onYearClick={handleSpotifySegmentClick} />
              ) : viewMode === 'discogs' ? (
                <>
                  {discogsLoading && discogsReleases.length === 0 ? (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                      Loading your collection…
                    </div>
                  ) : (
                    <DiscogsArtistBars
                      artists={filteredDiscogsArtists.slice(0, showAllDiscogsArtists ? undefined : 10)}
                      max={filteredDiscogsArtists[0]?.total ?? 1} />
                  )}
                </>
              ) : chartSection === 'artists' ? (
                <ArtistYearBars
                  artists={topArtists.slice(0, showAllArtists ? undefined : 10)}
                  max={maxArtistShows}
                  onNavigate={name => { setFilterText(name); setShowAllArtists(false) }}
                  onYearClick={(name, year) => { setFilterText(name); setSelectedYear(year); setSelectedMonth(null); setPage(1); setPageInput('1') }} />
              ) : (
                <VenueYearBars
                  venues={topVenues.slice(0, showAllVenues ? undefined : 10)}
                  max={maxVenueShows}
                  onNavigate={name => { setFilterText(name); setShowAllVenues(false) }} />
              )}

              {/* View all / view less buttons */}
              {viewMode === 'discogs' && filteredDiscogsArtists.length > 10 && (
                <button onClick={() => setShowAllDiscogsArtists(v => !v)} className="mt-3 text-xs text-primary hover:underline">
                  {showAllDiscogsArtists ? '← Show less' : `View all ${filteredDiscogsArtists.length} artists →`}
                </button>
              )}
              {viewMode === 'spotify' && spotifyLibraryView === 'artists' && filteredSpotifyArtists.length > 10 && (
                <button className="mt-3 text-xs text-muted-foreground" disabled>+ {filteredSpotifyArtists.length - 10} more</button>
              )}
              {viewMode === 'spotify' && spotifyLibraryView === 'albums' && topSpotifyAlbums.length > 10 && (
                <button onClick={() => setShowAllAlbums(v => !v)} className="mt-3 text-xs text-primary hover:underline">
                  {showAllAlbums ? '← Show less' : `View all ${topSpotifyAlbums.length} albums →`}
                </button>
              )}
              {viewMode !== 'discogs' && viewMode !== 'spotify' && chartSection === 'artists' && topArtists.length > 10 && (
                <button onClick={() => setShowAllArtists(v => !v)} className="mt-3 text-xs text-primary hover:underline">
                  {showAllArtists ? '← Show less' : `View all ${topArtists.length} artists →`}
                </button>
              )}
              {viewMode !== 'discogs' && viewMode !== 'spotify' && chartSection === 'venues' && topVenues.length > 10 && (
                <button onClick={() => setShowAllVenues(v => !v)} className="mt-3 text-xs text-primary hover:underline">
                  {showAllVenues ? '← Show less' : `View all ${topVenues.length} venues →`}
                </button>
              )}
            </div>

            {/* Right donut panel — Discogs: format breakdown; concert modes: venue size; Spotify: hidden */}
            {viewMode === 'discogs' && discogsFormatData.length > 0 ? (
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-56 flex-shrink-0 hidden md:flex flex-col">
                <h2 className="text-base font-bold text-foreground mb-3">By Format</h2>
                <div className="relative" style={{ height: 148 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={discogsFormatData} cx="50%" cy="50%" innerRadius={38} outerRadius={62}
                        paddingAngle={2} dataKey="value" stroke="none"
                        onClick={(d: any) => setDiscogsFmtFilter((prev: DiscogsFmt | 'all') => prev === d.fmt ? 'all' : d.fmt)}
                        style={{ cursor: 'pointer' }}
                        label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
                          if (percent < 0.06) return null
                          const RADIAN = Math.PI / 180
                          const r = (innerRadius + outerRadius) * 0.5
                          const x = cx + r * Math.cos(-midAngle * RADIAN)
                          const y = cy + r * Math.sin(-midAngle * RADIAN)
                          return (
                            <text x={x} y={y} fill="rgba(255,255,255,0.95)" textAnchor="middle" dominantBaseline="central"
                              fontSize={10} fontWeight={700} style={{ pointerEvents: 'none' }}>
                              {DISCOGS_FMT_META[discogsFormatData[index].fmt].shortLabel}
                            </text>
                          )
                        }}
                        labelLine={false}>
                        {discogsFormatData.map((entry, index) => (
                          <Cell key={entry.fmt} fill={entry.color}
                            opacity={discogsFmtFilter === 'all' || discogsFmtFilter === entry.fmt ? 1 : 0.25} />
                        ))}
                      </Pie>
                      <Tooltip content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null
                        const entry = payload[0]?.payload
                        return (
                          <div className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs shadow-lg pointer-events-none">
                            <p className="font-semibold text-foreground">{entry?.label}</p>
                            <p style={{ color: DISCOGS_COLOR }} className="tabular-nums">{entry?.value} records</p>
                          </div>
                        )
                      }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-1.5 mt-1">
                  {discogsFormatData.map(entry => {
                    const total = discogsFormatData.reduce((s, d) => s + d.value, 0)
                    const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                    const isActive = discogsFmtFilter === 'all' || discogsFmtFilter === entry.fmt
                    return (
                      <button key={entry.fmt}
                        onClick={() => setDiscogsFmtFilter((prev: DiscogsFmt | 'all') => prev === entry.fmt ? 'all' : entry.fmt)}
                        className={`w-full flex items-center gap-2 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                        <span className="text-[11px] text-foreground flex-1 truncate">{entry.label}</span>
                        <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: DISCOGS_COLOR }}>
                          {entry.value} ({pct}%)
                        </span>
                      </button>
                    )
                  })}
                  {discogsFmtFilter !== 'all' && (
                    <button onClick={() => setDiscogsFmtFilter('all')} className="text-[10px] text-primary hover:underline mt-1">Clear filter ×</button>
                  )}
                </div>
              </div>
            ) : viewMode !== 'spotify' && viewMode !== 'discogs' && donutData.length > 0 ? (
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-56 flex-shrink-0 hidden md:flex flex-col">
                <h2 className="text-base font-bold text-foreground mb-3">Venue Sizes</h2>
                <div className="relative" style={{ height: 148 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} cx="50%" cy="50%" innerRadius={38} outerRadius={62}
                        paddingAngle={2} dataKey="value" stroke="none"
                        onClick={(d: any) => setCapFilter((prev: CapFilter) => prev === d.key ? 'all' : d.key)}
                        style={{ cursor: 'pointer' }}
                        label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, index }: any) => {
                          if (percent < 0.06) return null
                          const RADIAN = Math.PI / 180
                          const r = (innerRadius + outerRadius) * 0.5
                          const x = cx + r * Math.cos(-midAngle * RADIAN)
                          const y = cy + r * Math.sin(-midAngle * RADIAN)
                          return (
                            <text x={x} y={y} fill="rgba(255,255,255,0.95)" textAnchor="middle" dominantBaseline="central"
                              fontSize={10} fontWeight={700} style={{ pointerEvents: 'none' }}>
                              {donutData[index].shortName}
                            </text>
                          )
                        }}
                        labelLine={false}>
                        {donutData.map((entry) => (
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
                    const pct = total > 0 ? Math.round((entry.value / total) * 100) : 0
                    const isActive = capFilter === 'all' || capFilter === entry.key
                    return (
                      <button key={entry.key}
                        onClick={() => setCapFilter((prev: CapFilter) => prev === entry.key ? 'all' : entry.key)}
                        className={`w-full flex items-center gap-2 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                        <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                        <span className="text-[11px] text-foreground flex-1 truncate">{entry.name}</span>
                        <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: TEAL }}>
                          {entry.value} ({pct}%)
                        </span>
                      </button>
                    )
                  })}
                  {capFilter !== 'all' && venueBreakdown[capFilter] && (
                    <div className="mt-2 pt-2 border-t border-border/40 space-y-0.5">
                      {venueBreakdown[capFilter].slice(0, 5).map(v => (
                        <div key={v.name} className="flex items-center justify-between gap-1">
                          <span className="text-[10px] text-muted-foreground truncate">{v.name}</span>
                          <span className="text-[10px] tabular-nums flex-shrink-0" style={{ color: TEAL }}>{v.count}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}


        {/* ── GP-118: Discogs expandable collection list ── */}
        {viewMode === 'discogs' && hasDiscogs && filteredDiscogsArtists.length > 0 && (
          <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <DiscogsIcon className="w-4 h-4 text-orange-400" />
                <h2 className="text-sm font-semibold text-foreground">
                  Your Collection
                  {discogsFmtFilter !== 'all' && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      · {DISCOGS_FMT_META[discogsFmtFilter].label} only
                    </span>
                  )}
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">
                {filteredDiscogsArtists.length} {filteredDiscogsArtists.length === 1 ? 'artist' : 'artists'}
              </span>
            </div>

            {discogsLoading && discogsReleases.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                Loading your collection…
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredDiscogsArtists.map((artist, i) => {
                  const isExpanded = expandedDiscogsArtists.has(artist.name)
                  const toggleExpanded = () => setExpandedDiscogsArtists(prev => {
                    const n = new Set(prev); n.has(artist.name) ? n.delete(artist.name) : n.add(artist.name); return n
                  })
                  const artistReleases = (discogsFmtFilter === 'all'
                    ? artist.releases
                    : artist.releases.filter(r => r.fmt === discogsFmtFilter)
                  ).sort((a, b) => (b.year ?? 0) - (a.year ?? 0))

                  return (
                    <div key={artist.name}>
                      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={toggleExpanded}>
                        <span className="text-xs font-bold tabular-nums w-6 text-right flex-shrink-0" style={{ color: DISCOGS_COLOR }}>
                          #{i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground truncate block">{artist.name}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Format breakdown mini-badges */}
                          <div className="hidden sm:flex items-center gap-1">
                            {DISCOGS_FMT_KEYS.filter(fmt => artist.formatCounts[fmt] > 0).map(fmt => (
                              <span key={fmt} className="text-[10px] px-1.5 py-px rounded font-medium"
                                style={{ background: `${DISCOGS_FMT_META[fmt].color}22`, color: DISCOGS_FMT_META[fmt].color }}>
                                {artist.formatCounts[fmt]}×{DISCOGS_FMT_META[fmt].shortLabel}
                              </span>
                            ))}
                          </div>
                          <span className="text-xs tabular-nums" style={{ color: DISCOGS_COLOR }}>
                            {artistReleases.length} {artistReleases.length === 1 ? 'record' : 'records'}
                          </span>
                          <span className="text-muted-foreground text-[10px] w-3 text-center select-none">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-border/40 bg-background/50">
                          <div className="grid px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-muted/30 border-b border-border/30"
                            style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 48px', color: TEAL }}>
                            <span>Title</span>
                            <span className="text-right">Year</span>
                            <span className="text-right">Fmt</span>
                          </div>
                          <div className="max-h-60 overflow-y-auto divide-y divide-border/10">
                            {artistReleases.map((rel, j) => (
                              <div key={j}
                                className="grid items-center px-4 py-2 hover:bg-muted/20 transition-colors"
                                style={{ gridTemplateColumns: 'minmax(0, 1fr) 72px 48px' }}>
                                <span className="text-xs text-foreground/80 truncate pr-3" title={rel.title}>{rel.title}</span>
                                <span className="text-xs text-foreground/50 tabular-nums text-right">{rel.year ?? '—'}</span>
                                <span className="text-[10px] font-semibold text-right"
                                  style={{ color: DISCOGS_FMT_META[rel.fmt].color }}>
                                  {DISCOGS_FMT_META[rel.fmt].shortLabel}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Spotify expandable artist list ── */}
        {viewMode === 'spotify' && hasSpotify && filteredSpotifyArtists.length > 0 && (
          <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <SpotifyIcon className="w-4 h-4" />
                <h2 className="text-sm font-semibold text-foreground">
                  Your Library
                  {selectedYear && <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedYear}{selectedMonth !== null ? ` – ${MONTHS[selectedMonth]}` : ''}</span>}
                </h2>
              </div>
              <span className="text-xs text-muted-foreground">{filteredSpotifyArtists.length} artists</span>
            </div>
            {spotifyLoading && spotifySongs.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                Loading your library…
              </div>
            ) : (
              <div className="divide-y divide-border">
                {filteredSpotifyArtists.map((artist, i) => {
                  const isExpanded = expandedSpotifyArtists.has(artist.name)
                  const toggleArtist = () => setExpandedSpotifyArtists(prev => {
                    const n = new Set(prev); n.has(artist.name) ? n.delete(artist.name) : n.add(artist.name); return n
                  })
                  const focusedAlbums = spotifyReleaseFocus?.artistId === artist.spotifyId
                    ? artist.albums.filter(alb => alb.year === spotifyReleaseFocus!.releaseYear)
                    : artist.albums
                  return (
                    <div key={artist.name}>
                      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer" onClick={toggleArtist}>
                        <span className="text-xs font-bold tabular-nums w-6 text-right flex-shrink-0" style={{ color: SPOTIFY_GREEN }}>#{i + 1}</span>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm text-foreground truncate">{artist.name}</span>
                          <SpotifyLink artistId={artist.spotifyId} />
                        </div>
                        <div className="flex items-center gap-3 flex-shrink-0">
                          <span className="text-xs tabular-nums" style={{ color: SPOTIFY_GREEN }}>{artist.count.toLocaleString()} {artist.count === 1 ? 'song' : 'songs'}</span>
                          <span className="text-muted-foreground text-[10px] w-3 text-center select-none">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/40 bg-background/50">
                          <div className="grid px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-muted/30 border-b border-border/30"
                            style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px', color: TEAL }}>
                            <span>Song</span><span className="text-right">Added</span>
                          </div>
                          <ArtistSongList albums={focusedAlbums} hasAlbumData={artist.hasAlbumData} focusYear={selectedYear} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Show list — hidden in Spotify and Discogs modes ── */}
        {viewMode !== 'spotify' && viewMode !== 'discogs' && (
          <>
            {/* Shows / Sets / Festivals sub-views */}
            {viewMode === 'shows' && (
              <div className="space-y-2">
                {billGroups.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg font-medium">No shows found</p>
                    {anyFilterActive && <button onClick={clearAll} className="mt-2 text-sm text-primary hover:underline">Clear filters</button>}
                  </div>
                ) : billGroups.map(group => {
                  const isExpanded = expandedBills.has(group.key)
                  return (
                    <div key={group.key} className="bg-card rounded-lg shadow border border-border overflow-hidden">
                      <div className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedBills(prev => { const n = new Set(prev); n.has(group.key) ? n.delete(group.key) : n.add(group.key); return n })}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground flex-shrink-0">{fmtDate(group.date)}</span>
                            {isFuture(group.date) && <span className="text-[10px] px-1.5 py-px rounded-full font-medium" style={{ background: 'rgba(0,191,168,0.12)', color: '#00BFA8', border: '1px solid rgba(0,191,168,0.25)' }}>Upcoming</span>}
                            <CapacityBadge category={group.capacity_category} />
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <p className="text-sm font-semibold text-foreground">
                              {group.isFestival ? (group.festival_name ?? group.headliner.artist.artist_name) : group.headliner.artist.artist_name}
                            </p>
                            {!group.isFestival && group.headliner.artist.spotify_artist_id && (
                              <SpotifyLink artistId={group.headliner.artist.spotify_artist_id} />
                            )}
                            {group.headliner.setlist_url && <SetlistLink url={group.headliner.setlist_url} />}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{group.venue_name}</p>
                          {group.shows.length > 1 && !isExpanded && (
                            <p className="text-[10px] text-muted-foreground mt-0.5">+ {group.shows.length - 1} more {group.shows.length - 1 === 1 ? 'act' : 'acts'}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!readOnly && (
                            <button onClick={e => { e.stopPropagation(); removeShow(group.headliner.show_id) }}
                              disabled={removingSet.has(group.headliner.show_id)}
                              className="text-muted-foreground hover:text-destructive text-sm transition-colors disabled:opacity-40">
                              {removingSet.has(group.headliner.show_id) ? <span className="inline-block w-3 h-3 border border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" /> : '×'}
                            </button>
                          )}
                          <span className="text-muted-foreground text-[10px]">{isExpanded ? '▲' : '▼'}</span>
                        </div>
                      </div>
                      {isExpanded && group.shows.length > 1 && (
                        <div className="border-t border-border/40 divide-y divide-border/10">
                          {group.shows.slice(1).map(show => (
                            <div key={show.show_id} className="flex items-center gap-3 px-3 py-2 bg-background/40">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-foreground/80">{show.artist.artist_name}</span>
                                  {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                  {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                </div>
                              </div>
                              {!readOnly && (
                                <button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)}
                                  className="text-muted-foreground hover:text-destructive text-sm transition-colors disabled:opacity-40 flex-shrink-0">
                                  {removingSet.has(show.show_id) ? <span className="inline-block w-3 h-3 border border-muted-foreground/40 border-t-muted-foreground rounded-full animate-spin" /> : '×'}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {billGroups.length > 0 && (
                  <div className="flex items-center justify-center gap-2 pt-2 text-sm text-muted-foreground">
                    <span>{billGroups.length} {billGroups.length === 1 ? 'show' : 'shows'}</span>
                    {filterRange && <span>· {filterRange}</span>}
                  </div>
                )}
              </div>
            )}

            {/* Sets view */}
            {viewMode === 'sets' && (
              <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
                <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/30">
                  {(['date','artist','venue'] as SortField[]).map(field => (
                    <button key={field} onClick={() => handleSort(field)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${sortField === field ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                      {field} {sortField === field ? (sortDir === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  ))}
                  <div className="flex items-center gap-1 ml-2 bg-muted rounded-lg p-0.5 border border-border">
                    <button onClick={() => setSetsSubView('card')} className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${setsSubView === 'card' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Card</button>
                    <button onClick={() => setSetsSubView('table')} className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${setsSubView === 'table' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Table</button>
                  </div>
                </div>

                {setsSubView === 'table' ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-border bg-muted/20">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Artist</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Venue</th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Size</th>
                        {!readOnly && <th className="w-8" />}
                      </tr></thead>
                      <tbody className="divide-y divide-border/30">
                        {currentShows.map(show => (
                          <tr key={show.show_id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-foreground text-sm truncate max-w-[200px]">{show.artist.artist_name}</span>
                                {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(show.date)}</td>
                            <td className="px-4 py-2 text-xs text-muted-foreground truncate max-w-[180px]">{show.venue.venue_name}</td>
                            <td className="px-4 py-2"><CapacityBadge category={show.venue.capacity_category} /></td>
                            {!readOnly && <td className="px-2 py-2 text-center"><button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors disabled:opacity-40">{removingSet.has(show.show_id) ? '…' : '×'}</button></td>}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {currentShows.map(show => (
                      <div key={show.show_id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-foreground truncate">{show.artist.artist_name}</span>
                            {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                            {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{fmtDate(show.date)} · {show.venue.venue_name}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <CapacityBadge category={show.venue.capacity_category} />
                          {!readOnly && <button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors disabled:opacity-40">{removingSet.has(show.show_id) ? '…' : '×'}</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                    <button onClick={() => handlePage(page - 1)} disabled={page === 1} className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80 disabled:opacity-40 transition-colors">‹ Prev</button>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Page</span>
                      <input type="number" min={1} max={totalPages} value={pageInput}
                        onChange={e => setPageInput(e.target.value)}
                        onBlur={e => handlePage(parseInt(e.target.value) || page)}
                        onKeyDown={e => { if (e.key === 'Enter') handlePage(parseInt(pageInput) || page) }}
                        className="w-14 text-center bg-muted border border-border rounded-md px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
                      <span className="text-muted-foreground">of {totalPages}</span>
                    </div>
                    <button onClick={() => handlePage(page + 1)} disabled={page === totalPages} className="px-3 py-1.5 rounded-md text-sm bg-muted hover:bg-muted/80 disabled:opacity-40 transition-colors">Next ›</button>
                  </div>
                )}
              </div>
            )}

            {/* Festivals view */}
            {viewMode === 'festivals' && (
              <div className="space-y-3">
                {festivalGroups.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground"><p className="text-lg font-medium">No festivals found</p></div>
                ) : festivalGroups.map(group => {
                  const isExpanded = expandedBills.has(group.key)
                  return (
                    <div key={group.key} className="bg-card rounded-lg shadow border border-border overflow-hidden">
                      <div className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => setExpandedBills(prev => { const n = new Set(prev); n.has(group.key) ? n.delete(group.key) : n.add(group.key); return n })}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(group.date_from)}{group.date_from !== group.date_to ? ` – ${fmtDate(group.date_to)}` : ''} · {group.year}
                            </span>
                            {isFuture(group.date_to) && <span className="text-[10px] px-1.5 py-px rounded-full font-medium" style={{ background: 'rgba(0,191,168,0.12)', color: '#00BFA8', border: '1px solid rgba(0,191,168,0.25)' }}>Upcoming</span>}
                          </div>
                          <p className="text-sm font-semibold text-foreground mt-0.5">{group.festival_name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{group.venue_name} · {group.shows.length} {group.shows.length === 1 ? 'act' : 'acts'}</p>
                        </div>
                        <span className="text-muted-foreground text-[10px] flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                      {isExpanded && (
                        <div className="border-t border-border/40 divide-y divide-border/10">
                          {group.shows.map(show => (
                            <div key={show.show_id} className="flex items-center gap-3 px-3 py-2 bg-background/40">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs text-foreground/80">{show.artist.artist_name}</span>
                                  {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                  {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                </div>
                                <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDate(show.date)}</p>
                              </div>
                              {!readOnly && <button onClick={() => removeShow(show.show_id)} disabled={removingSet.has(show.show_id)} className="text-muted-foreground hover:text-destructive text-sm transition-colors disabled:opacity-40 flex-shrink-0">{removingSet.has(show.show_id) ? '…' : '×'}</button>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

      </div>
    </div>
  )
}
