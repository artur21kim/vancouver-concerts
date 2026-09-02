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
  tour_name: string | null
  added_at: string
  notes: string | null
  source: string | null
  city: string | null
  venue_state: string | null
  artist: {
    artist_id: number
    artist_name: string
    monthly_listeners: number | null
    spotify_artist_id: string | null
    kexp_url: string | null
    kexp_session_count: number | null
    tiny_desk_url: string | null
    tiny_desk_session_count: number | null
  }
  venue: {
    venue_id: number
    venue_name: string
    capacity: number | null
    capacity_category: string | null
    tm_url: string | null
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
  preferred_tab?:        string | null
}

type SortField     = 'date' | 'artist' | 'venue' | 'added_at'
type SortDir       = 'asc' | 'desc'
// GP-80: added 'spotify' view mode; GP-118: added 'discogs'
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

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const SPOTIFY_GREEN = '#1DB954'
const TEAL = '#0d9488'
// GP-93: fixed 6-color palette for album segments in SpotifyArtistBars
const SPOTIFY_PALETTE = ['#0d9488', '#0891b2', '#7c3aed', '#be185d', '#b45309', '#065f46'] as const

// GP-118: Discogs accent — adapts to theme (white in dark mode, dark in light mode); matches current Discogs brand
const DISCOGS_COLOR = 'var(--foreground)'

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
      <svg className="w-3 h-3" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" fill="#85B146" />
      </svg>
    </a>
  )
}

// ── KEXP Full Performance icon ────────────────────────────────────────────────
function KexpLink({ url, sessionCount }: { url: string; sessionCount?: number | null }) {
  const tooltip = sessionCount && sessionCount > 1
    ? `Watch on KEXP · ${sessionCount} sessions`
    : 'Watch on KEXP'
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={tooltip}
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity">
      <img src="https://www.kexp.org/favicon.ico" alt="KEXP" className="w-3 h-3" />
    </a>
  )
}

// ── NPR Tiny Desk icon ────────────────────────────────────────────────────────
function TinyDeskLink({ url, sessionCount }: { url: string; sessionCount?: number | null }) {
  const tooltip = sessionCount && sessionCount > 1
    ? `Watch on NPR Tiny Desk · ${sessionCount} sessions`
    : 'Watch on NPR Tiny Desk'
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={tooltip}
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity">
      <svg viewBox="0 0 21 12" className="h-3 w-auto">
        <rect width="6" height="12" fill="#FF330D" rx="1"/>
        <rect x="7.5" width="6" height="12" fill="#111111" rx="1" stroke="white" strokeWidth="0.5" strokeOpacity="0.3"/>
        <rect x="15" width="6" height="12" fill="#3366CC" rx="1"/>
      </svg>
    </a>
  )
}

function TmVenueLink({ url }: { url: string }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="View on Ticketmaster"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity">
      <img src="https://www.ticketmaster.com/favicon.ico" alt="Ticketmaster" className="w-3 h-3" />
    </a>
  )
}

// ── Spotify icon SVG ──────────────────────────────────────────────────────────
function SpotifyIcon({ className = 'w-3 h-3', fill = SPOTIFY_GREEN }: { className?: string; fill?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={fill}>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

// ── Discogs icon — official D-in-circle brand mark ───────────────────────────
function DiscogsIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" xmlns="http://www.w3.org/2000/svg">
      <path fillRule="evenodd" d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.37 17.5H8.13V6.5h3.5c3.314 0 6 2.239 6 5.5s-2.686 5.5-6 5.5zm0-9.5H9.63v8h1.999c2.485 0 4.501-1.79 4.501-4s-2.016-4-4.501-4z" />
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
  // GP-109: album release markers (single-artist Spotify view only)
  const albumReleases: { name: string; ordinal: number }[] = payload[0]?.payload?.albumReleases ?? []
  // GP-110 (#2): plain album count for multi-artist months
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

        // One segment per show — equal width, own capacity colour preserves M vs XL distinction
        const segments: { year: string; venue: string; capKey: CapFilter; color: string; widthPct: number }[] = []
        for (const year of Object.keys(artist.showsByYear).sort()) {
          const shows = artist.showsByYear[year]
          shows.forEach((show) => {
            segments.push({
              year,
              venue: show.venue,
              capKey: show.capKey,
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
                      <div
                        key={i}
                        className="h-full flex items-center justify-center overflow-hidden"
                        style={{
                          width: `${seg.widthPct}%`,
                          backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                          cursor: onYearClick ? 'pointer' : 'default',
                        }}
                        onClick={() => onYearClick?.(artist.name, seg.year)}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, year: seg.year, venue: seg.venue, capKey: seg.capKey, x: e.clientX - rect.left })
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

              {tooltip?.artist === artist.name && (
                <div
                  className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[140px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}
                >
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

        // One segment per year, equal width — bar shows which years, not how many times
        const numYears = Object.keys(venue.showsByYear).length
        const yearSegments = Object.keys(venue.showsByYear).sort().map(year => {
          const yearShows = venue.showsByYear[year]
          const capCounts: Record<string, number> = {}
          for (const s of yearShows) { capCounts[s.capKey] = (capCounts[s.capKey] ?? 0) + 1 }
          const capKey = (Object.entries(capCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown') as CapFilter
          const artists = [...new Set(yearShows.map(s => s.artist))]
          return {
            year,
            count: yearShows.length,
            capKey,
            color: CAP_BY_KEY[capKey]?.color ?? 'rgba(156,163,175,0.75)',
            widthPct: (1 / numYears) * 100,
            artists,
          }
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
                      <div
                        key={seg.year}
                        className="h-full flex items-center justify-center overflow-hidden cursor-default"
                        style={{
                          width: `${seg.widthPct}%`,
                          backgroundColor: seg.color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                        }}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ venue: venue.name, year: seg.year, count: seg.count, artists: seg.artists, capKey: seg.capKey, x: e.clientX - rect.left })
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

// ── GP-118: Discogs artist bars (format-colored segments) ─────────────────────
function DiscogsArtistBars({ artists, max }: {
  artists: {
    name: string; discogsArtistId: number | null; total: number
    formatCounts: Record<DiscogsFmt, number>
    releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null; releaseId: number }[]
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
            color: DISCOGS_FMT_META[fmt].color,
            widthPct: (artist.formatCounts[fmt] / artist.total) * 100,
          }))
        return (
          <div key={artist.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              {artist.discogsArtistId ? (
                <a href={`https://www.discogs.com/artist/${artist.discogsArtistId}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right transition-opacity"
                  title={artist.name}>{artist.name}</a>
              ) : (
                <span className="text-xs text-primary truncate text-right" title={artist.name}>{artist.name}</span>
              )}
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
// Groups all albums from the same release year into one segment. This bounds
// segment count by career span in years (≤~20) rather than album output,
// preventing prolific artists (King Gizzard, Thee Oh Sees) from producing
// unreadable hairline slices.
function SpotifyArtistBars({ artists, max, onYearClick }: {
  artists: {
    name: string; count: number; spotifyId: string; hasAlbumData: boolean
    albums: { name: string | null; year: string | null; releaseDate: string | null; imageUrl: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }[]
  }[]
  max: number
  onYearClick?: (artistName: string, year: string, spotifyId: string) => void
}) {
  const [tooltip, setTooltip] = useState<{
    artist: string; year: string | null; albumNames: string[]; count: number; x: number
  } | null>(null)

  // GP-106: extract dominant vibrant color from album artwork via Canvas API.
  // Falls back to SPOTIFY_PALETTE while extracting or if image unavailable.
  const [extractedColors, setExtractedColors] = useState<Record<string, string>>({})

  useEffect(() => {
    const imageUrls = new Set<string>()
    for (const artist of artists) {
      for (const album of artist.albums) {
        if (album.imageUrl) imageUrls.add(album.imageUrl)
      }
    }
    if (imageUrls.size === 0) return

    const extractColor = (url: string): Promise<void> => new Promise((resolve) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 50; canvas.height = 50
          const ctx = canvas.getContext('2d')
          if (!ctx) { resolve(); return }
          ctx.drawImage(img, 0, 0, 50, 50)
          const { data } = ctx.getImageData(0, 0, 50, 50)
          // Find most saturated non-dark, non-washed-out pixel
          let best = { r: 0, g: 0, b: 0, sat: 0 }
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2]
            const max = Math.max(r, g, b), min = Math.min(r, g, b)
            const lightness = (max + min) / 510
            if (lightness < 0.15 || lightness > 0.85) continue
            const sat = max === 0 ? 0 : (max - min) / max
            if (sat > best.sat) best = { r, g, b, sat }
          }
          if (best.sat > 0.25) {
            setExtractedColors(prev => ({ ...prev, [url]: `rgb(${best.r},${best.g},${best.b})` }))
          }
        } catch { /* ignore, fall back to palette */ }
        resolve()
      }
      img.onerror = () => resolve()
      img.src = url
    })

    const urlArray = Array.from(imageUrls).slice(0, 100)
    const CHUNK = 10
    ;(async () => {
      for (let i = 0; i < urlArray.length; i += CHUNK) {
        await Promise.all(urlArray.slice(i, i + CHUNK).map(extractColor))
      }
    })()
  }, [artists]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full space-y-1.5">
      {artists.map((artist) => {
        const totalWidth = max > 0 ? (artist.count / max) * 100 : 0

        // Aggregate albums → year buckets
        const yearMap = new Map<string, { year: string | null; albumNames: string[]; firstImageUrl: string | null; count: number }>()
        for (const album of artist.albums) {
          const key = album.year ?? '__null__'
          if (!yearMap.has(key)) yearMap.set(key, { year: album.year, albumNames: [], firstImageUrl: album.imageUrl ?? null, count: 0 })
          const bucket = yearMap.get(key)!
          if (album.name) bucket.albumNames.push(album.name)
          if (!bucket.firstImageUrl && album.imageUrl) bucket.firstImageUrl = album.imageUrl
          bucket.count += album.songs.length
        }

        // Sort year buckets ascending (oldest left), null last
        const yearBuckets = Array.from(yearMap.values()).sort((a, b) => {
          if (!a.year && !b.year) return 0
          if (!a.year) return 1
          if (!b.year) return -1
          return parseInt(a.year) - parseInt(b.year)
        })

        return (
          <div key={artist.name} className="flex items-center gap-2 py-0.5">
            <div className="w-32 md:w-40 flex items-center justify-end gap-1 flex-shrink-0 min-w-0">
              <button
                className="text-xs text-primary hover:opacity-80 hover:underline truncate text-right cursor-default"
                title={artist.name}
              >
                {artist.name}
              </button>
              <SpotifyLink artistId={artist.spotifyId} />
            </div>

            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden flex">
                <div className="h-full flex" style={{ width: `${totalWidth}%` }}>
                  {yearBuckets.map((bucket, i) => {
                    const widthPct = (bucket.count / artist.count) * 100
                    const color = (bucket.firstImageUrl && extractedColors[bucket.firstImageUrl])
                      ? extractedColors[bucket.firstImageUrl]
                      : SPOTIFY_PALETTE[i % SPOTIFY_PALETTE.length]
                    const isFirst = i === 0
                    const isLast = i === yearBuckets.length - 1
                    // Absolute width check: segment must be ≥5% of the max-width bar to show a label.
                    // Relative-only threshold lets narrow overall bars show cramped labels even at 8%+.
                    const showLabel = widthPct >= 6 && (totalWidth * widthPct / 100) >= 5
                    const clickable = !!onYearClick && !!bucket.year
                    return (
                      <div
                        key={bucket.year ?? '__null__'}
                        className="h-full flex items-center justify-center overflow-hidden"
                        style={{
                          width: `${widthPct}%`,
                          backgroundColor: color,
                          borderRadius: isFirst && isLast ? '9999px' : isFirst ? '9999px 0 0 9999px' : isLast ? '0 9999px 9999px 0' : '0',
                          borderRight: !isLast ? '1px solid rgba(0,0,0,0.25)' : undefined,
                          cursor: clickable ? 'pointer' : 'default',
                        }}
                        onClick={() => clickable && onYearClick!(artist.name, bucket.year!, artist.spotifyId)}
                        onMouseEnter={e => {
                          const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                          setTooltip({ artist: artist.name, year: bucket.year, albumNames: bucket.albumNames, count: bucket.count, x: e.clientX - rect.left })
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {showLabel && (
                          <span
                            className="text-[9px] font-semibold leading-none select-none whitespace-nowrap px-0.5"
                            style={{ color: 'rgba(255,255,255,0.9)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}
                          >
                            {bucket.year ?? ''}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {tooltip?.artist === artist.name && (
                <div
                  className="absolute z-50 bg-card border border-border rounded-lg px-3 py-2 text-xs shadow-xl pointer-events-none min-w-[160px] max-w-[240px]"
                  style={{ left: Math.min(tooltip.x, 220), bottom: 'calc(100% + 6px)', transform: 'translateX(-30%)' }}
                >
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

// ── Expandable artist song list with scroll fade indicator ────────────────────
// Extracted as a sub-component so each expanded artist gets its own scroll
// state without lifting it into the parent.
type AlbumEntry = {
  name: string | null; year: string | null; releaseDate: string | null
  songs: { track_name: string; track_id: string | null; added_at: string }[]
}
function ArtistSongList({ albums, hasAlbumData, focusYear }: {
  albums: AlbumEntry[]; hasAlbumData: boolean; focusYear: string | null
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showFade, setShowFade] = useState(true)
  // Albums collapsed by default when there are multiple named albums (avoids long scroll)
  const [expandedAlbums, setExpandedAlbums] = useState<Set<string>>(new Set())

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const check = () => {
      setShowFade(el.scrollHeight - el.scrollTop > el.clientHeight + 16)
    }
    check()
    el.addEventListener('scroll', check, { passive: true })
    return () => el.removeEventListener('scroll', check)
  }, [albums])

  // Reset expansion when release-year focus changes
  useEffect(() => {
    setExpandedAlbums(new Set())
  }, [focusYear])

  const displayAlbums = focusYear
    ? albums.filter(alb => alb.year === focusYear)
    : albums

  // Use collapsed mode when there are multiple named albums
  const namedAlbumCount = displayAlbums.filter(a => a.name).length
  const useCollapsed = hasAlbumData && namedAlbumCount > 1

  const toggleAlbum = (key: string) => {
    setExpandedAlbums(prev => {
      const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n
    })
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
                <div
                  className={`px-4 py-2 bg-muted/50 transition-colors ${ai > 0 ? 'border-t border-teal-500/15' : ''} ${useCollapsed ? 'cursor-pointer hover:bg-muted/70' : ''}`}
                  style={{ color: '#0d9488' }}
                  title={album.releaseDate
                    ? (() => {
                        if (album.releaseDate.length === 4) return album.releaseDate
                        if (album.releaseDate.length === 7) {
                          const [y, m] = album.releaseDate.split('-')
                          return `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(m)-1]} ${y}`
                        }
                        return new Date(album.releaseDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
                      })()
                    : album.year ?? undefined}
                  onClick={useCollapsed ? () => toggleAlbum(albumKey) : undefined}
                >
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
                    <div
                      key={j}
                      className="grid items-center px-4 py-2 hover:bg-muted/20 transition-colors"
                      style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px' }}
                    >
                      <div className="min-w-0 pl-2 pr-3">
                        {song.track_id ? (
                          <a
                            href={`https://open.spotify.com/track/${song.track_id}`}
                            target="_blank" rel="noopener noreferrer"
                            className="text-xs text-foreground/80 hover:text-primary hover:underline truncate block transition-colors"
                            title={song.track_name}
                          >
                            {song.track_name}
                          </a>
                        ) : (
                          <span className="text-xs text-foreground/80 truncate block" title={song.track_name}>
                            {song.track_name}
                          </span>
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
        <div
          className="absolute bottom-0 left-0 right-0 h-14 pointer-events-none"
          style={{ background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.75))' }}
        />
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
              <button
                className="text-xs hover:opacity-80 text-right min-w-0 flex-1"
                title={`${album.albumName}${album.year ? ` (${album.year})` : ''} · ${album.artistName}`}
                onClick={() => onAlbumClick(album.artistName, album.year, album.artistId, album.addedYear)}
              >
                {/* GP-111 (#3): year moved onto bar; label is just album name + artist */}
                <span className="block text-primary truncate leading-tight">{album.albumName}</span>
                <span className="block text-[10px] text-muted-foreground truncate">{album.artistName}</span>
              </button>
              {album.artistId && <SpotifyLink artistId={album.artistId} />}
            </div>
            <div className="flex-1 relative">
              <div className="h-5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full cursor-pointer flex items-center overflow-hidden"
                  style={{ width: `${totalWidth}%`, backgroundColor: SPOTIFY_GREEN, opacity: 0.8 }}
                  onClick={() => onAlbumClick(album.artistName, album.year, album.artistId, album.addedYear)}
                  onMouseEnter={e => {
                    const rect = (e.currentTarget as HTMLElement).closest('.flex-1')!.getBoundingClientRect()
                    setTooltip({ key, albumName: album.albumName, artistName: album.artistName, year: album.year, count: album.count, x: e.clientX - rect.left })
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  {album.year && totalWidth >= 8 && (
                    <span className="text-[9px] font-semibold text-black/70 px-2 ml-auto select-none whitespace-nowrap">
                      {album.year}
                    </span>
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
function ProfileHeaderCard({ header, readOnly, discogsStats, grooveprintSince }: {
  header: ProfileHeader
  readOnly: boolean
  discogsStats?: { count: number; artistCount: number; sinceYear: number | null; lastAdded?: { title: string; artist: string | null; year: number | null; fmt: string } | null } | null
  grooveprintSince?: string | null
}) {
  const router = useRouter()
  const supabase = createClient()
  const [actionLoading, setActionLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [imgError, setImgError] = useState(false)

  const profileUrl = `https://grooveprint.app/profile/${header.username}`
  const showSpotifyStats = (header.is_own_profile || header.show_spotify_stats) && header.spotify_connected && (header.spotify_song_count ?? 0) > 0
  // Grooveprint badge date: month+year from RPC when available, falls back to year-only from profile
  const grooveprintDate = grooveprintSince ?? (header.first_show_year ? String(header.first_show_year) : null)
  // Year-only for badge — "Dec 2008" → "2008"; full date still shown in Concert Timeline
  const grooveprintYear = grooveprintDate?.split(' ').at(-1) ?? null

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
              {/* Username + bio inline — bio flows alongside username on the same baseline */}
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold text-primary shrink-0">@{header.username}</h2>
                {header.bio && <p className="text-sm text-muted-foreground leading-relaxed">{header.bio}</p>}
              </div>

              {/* 2-col grid: badge column auto-sizes to widest badge; stats in natural flex rows */}
              <div className="mt-1.5" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', rowGap: '0.375rem', columnGap: '0.375rem', alignItems: 'center' }}>

                {/* Row 1: concerts */}
                <div>
                  {header.confirmed_shows > 0 && grooveprintYear && (
                    <span className="flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium tabular-nums"
                      style={{ background: 'rgba(0,191,168,0.12)', color: '#00BFA8', border: '1px solid rgba(0,191,168,0.3)' }}>
                      First Show {grooveprintYear}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-sm flex-wrap">
                  <span className="font-semibold text-foreground">{header.confirmed_shows}</span><span className="text-muted-foreground">shows</span>
                  <span className="text-border">·</span>
                  <span className="font-semibold text-foreground">{header.unique_artists}</span><span className="text-muted-foreground">artists</span>
                  <span className="text-border">·</span>
                  <span className="font-semibold text-foreground">{header.unique_venues}</span><span className="text-muted-foreground">venues</span>
                  {header.festival_count > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.festival_count}</span><span className="text-muted-foreground">{header.festival_count === 1 ? 'festival' : 'festivals'}</span></>)}
                </div>

                {/* Row 2: Spotify */}
                {showSpotifyStats && (<>
                  <div>
                    {header.spotify_user_id && (
                      <a href={`https://open.spotify.com/user/${header.spotify_user_id}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tabular-nums hover:opacity-80 transition-opacity"
                        style={{ background: 'rgba(29,185,84,0.12)', color: SPOTIFY_GREEN, border: '1px solid rgba(29,185,84,0.3)' }}>
                        <SpotifyIcon className="w-3 h-3" />Spotify{header.spotify_since_year ? ` ${header.spotify_since_year}` : ''}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm flex-wrap">
                    <span className="font-semibold text-foreground">{header.spotify_song_count?.toLocaleString()}</span><span className="text-muted-foreground">songs</span>
                    {(header.spotify_album_count ?? 0) > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.spotify_album_count?.toLocaleString()}</span><span className="text-muted-foreground">albums</span></>)}
                    {(header.spotify_artist_count ?? 0) > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{header.spotify_artist_count?.toLocaleString()}</span><span className="text-muted-foreground">artists</span></>)}
                  </div>
                </>)}

                {/* Row 3: Discogs */}
                {header.discogs_connected && (<>
                  <div>
                    {header.discogs_connected && header.discogs_username && (
                      <a href={`https://www.discogs.com/user/${header.discogs_username}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium tabular-nums hover:opacity-80 transition-opacity"
                        style={{ background: 'rgba(20,20,20,0.9)', color: '#ffffff', border: '1px solid rgba(255,255,255,0.18)' }}>
                        <DiscogsIcon className="w-3 h-3" />Discogs{discogsStats?.sinceYear ? ` ${discogsStats.sinceYear}` : ''}
                      </a>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 text-sm flex-wrap">
                    {discogsStats ? (
                      <>
                        <span className="font-semibold text-foreground">{discogsStats.count.toLocaleString()}</span><span className="text-muted-foreground">records</span>
                        {discogsStats.artistCount > 0 && (<><span className="text-border">·</span><span className="font-semibold text-foreground">{discogsStats.artistCount.toLocaleString()}</span><span className="text-muted-foreground">artists</span></>)}
                        {discogsStats.lastAdded && (
                          <><span className="text-border">·</span>
                          <span className="text-foreground">
                            <span className="font-semibold text-foreground">last added: </span><span style={{ color: '#00BFA8' }}>{discogsStats.lastAdded.title}{discogsStats.lastAdded.artist ? ` - ${discogsStats.lastAdded.artist}` : ''}</span>
                          </span></>
                        )}
                      </>
                    ) : null}
                  </div>
                </>)}

              </div>
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
  spotifySongs: initialSpotifySongs,   // GP-124: wrapped in state for lazy-load
  discogsReleases: initialDiscogsReleases = [],  // GP-118: Discogs tab
  readOnly = false,
  username,
  profileHeader,
}: {
  shows: Show[]
  spotifySongs: { added_at: string; spotify_artist_id: string | null; artist_name: string; track_name: string; spotify_album_name: string | null; spotify_album_release_date: string | null; spotify_track_id: string | null; spotify_album_image_url: string | null }[]
  discogsReleases?: DiscogsRelease[]
  readOnly?: boolean
  username?: string
  profileHeader?: ProfileHeader
}) {
  const router  = useRouter()
  const supabase = createClient()

  const [shows, setShows] = useState(initialShows)
  // GP-124: songs start empty, fetched client-side on first Spotify tab click
  const [spotifySongs, setSpotifySongs] = useState(initialSpotifySongs)
  const [spotifyLoading, setSpotifyLoading] = useState(false)
  const [spotifyLoaded, setSpotifyLoaded] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('shows')

  // GP-125: read ?tab= on mount to support nav tab jump links
  // GP-127: fall back to user's preferred_tab setting when no URL param present
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab === 'spotify' || tab === 'discogs') {
      setViewMode(tab as 'spotify' | 'discogs')
    } else if (profileHeader?.preferred_tab === 'spotify' || profileHeader?.preferred_tab === 'discogs') {
      setViewMode(profileHeader.preferred_tab as 'spotify' | 'discogs')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [setsSubView, setSetsSubView]           = useState<SetsSubView>('card')
  const [sortField, setSortField]               = useState<SortField>('date')
  const [sortDir, setSortDir]                   = useState<SortDir>('desc')
  const [removingSet, setRemovingSet]           = useState<Set<number>>(new Set())
  const [page, setPage]                         = useState(1)
  const [pageInput, setPageInput]               = useState('1')
  const [selectedYear, setSelectedYear]         = useState<string | null>(null)
  const [selectedMonth, setSelectedMonth]       = useState<number | null>(null)   // GP-112
  const [capFilter, setCapFilter]               = useState<CapFilter>('all')
  const [chartSection, setChartSection]         = useState<'artists' | 'venues'>('artists')
  const [showAllArtists, setShowAllArtists]     = useState(false)
  const [showAllVenues, setShowAllVenues]       = useState(false)
  const [expandedBills, setExpandedBills]       = useState<Set<string>>(new Set())
  const [isPlaying, setIsPlaying]               = useState(false)
  const [expandedSpotifyArtists, setExpandedSpotifyArtists] = useState<Set<string>>(new Set())
  const [filterText, setFilterText]                         = useState('')
  // GP-107: release-year focus for SpotifyArtistBars drilldown (separate from selectedYear which filters by added_at)
  const [spotifyReleaseFocus, setSpotifyReleaseFocus]       = useState<{ artistId: string; releaseYear: string } | null>(null)
  // GP-111: Top Albums toggle
  const [spotifyLibraryView, setSpotifyLibraryView] = useState<'artists' | 'albums'>('artists')
  const [showAllAlbums, setShowAllAlbums]             = useState(false)
  const [expandedAlbumKeys, setExpandedAlbumKeys]     = useState<Set<string>>(new Set())

  // GP-126: first show date for Grooveprint badge (e.g. "Dec 2008")
  const [grooveprintSince, setGrooveprintSince] = useState<string | null>(null)

  // GP-118: Discogs tab state
  const [discogsReleases, setDiscogsReleases]             = useState<DiscogsRelease[]>(initialDiscogsReleases)
  const [discogsLoading, setDiscogsLoading]               = useState(false)
  const [discogsLoaded, setDiscogsLoaded]                 = useState(initialDiscogsReleases.length > 0)
  const [showAllDiscogsArtists, setShowAllDiscogsArtists] = useState(false)
  const [discogsFmtFilter, setDiscogsFmtFilter]           = useState<DiscogsFmt | 'all'>('all')
  const [expandedDiscogsArtists, setExpandedDiscogsArtists] = useState<Set<string>>(new Set())
  const [discogsView, setDiscogsView]                     = useState<'artists' | 'years'>('artists')

  // Unadded CTA — own profile only
  const [unaddedArtists, setUnaddedArtists]         = useState<UnaddedArtist[]>([])
  const [unaddedDismissed, setUnaddedDismissed]     = useState(false)
  const [unaddedExpanded, setUnaddedExpanded]       = useState(false)
  const [addingUnadded, setAddingUnadded]           = useState(false)
  // GP-90: per-row and bulk skip state
  const [addingIndividual, setAddingIndividual]     = useState<Set<number>>(new Set())
  const [skippingIndividual, setSkippingIndividual] = useState<Set<number>>(new Set())
  const [skippingAll, setSkippingAll]               = useState(false)
  // GP-90: skipped artists restore
  const [skippedArtists, setSkippedArtists]         = useState<UnaddedArtist[]>([])
  const [skippedExpanded, setSkippedExpanded]       = useState(false)
  const [restoringIndividual, setRestoringIndividual] = useState<Set<number>>(new Set())
  const [sessionShowsModified, setSessionShowsModified] = useState(false)

  const PER_PAGE = 50
  // GP-124: tab visible when Spotify connected (even pre-load); data memos still guard on songs.length
  const hasSpotify = (profileHeader?.is_own_profile && profileHeader?.spotify_connected) || spotifySongs.length > 0
  // GP-118: tab visible when Discogs connected; don't gate on release_count (GP-119 not yet built)
  const hasDiscogs = !!(profileHeader?.discogs_connected)
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

      // GP-90: exclude show_ids already in user_show_reviews (previously skipped)
      const { data: reviewedRows } = await supabase
        .from('user_show_reviews')
        .select('show_id')
        .eq('user_id', user.id)
      const reviewedIds = new Set((reviewedRows ?? []).map((r: any) => r.show_id))
      setUnaddedArtists(unadded.filter(a => !reviewedIds.has(a.show_id)))
      setSkippedArtists(unadded.filter(a => reviewedIds.has(a.show_id)))
    } catch (e) { console.error('Error checking unadded:', e) }
  }, [shows, supabase, readOnly])

  useEffect(() => { checkUnaddedArtists() }, [])
  useEffect(() => { if (sessionShowsModified) { checkUnaddedArtists(); setSessionShowsModified(false) } }, [sessionShowsModified])
  // GP-62: silently page through /api/spotify/backfill-albums in the background
  // when the user has rows missing spotify_album_image_url. Fire-and-forget —
  // reloads spotifySongs on completion so colors appear without a page refresh.
  const runAlbumBackfillSilently = useCallback(async () => {
    // Pause the loop if the tab is hidden — resumes automatically when visible again
    const waitWhileHidden = () => new Promise<void>(resolve => {
      if (document.visibilityState !== 'hidden') { resolve(); return }
      const handler = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handler)
          resolve()
        }
      }
      document.addEventListener('visibilitychange', handler)
    })

    let cursor: string | undefined
    let pages = 0
    const MAX_PAGES = 300
    while (pages < MAX_PAGES) {
      await waitWhileHidden()
      try {
        const res = await fetch('/api/spotify/backfill-albums', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cursor ? { cursor } : {}),
        })
        if (!res.ok) break
        const json = await res.json()
        if (!json.next_url) {
          const { data } = await supabase
            .from('user_spotify_songs')
            .select('added_at, spotify_artist_id, artist_name, track_name, spotify_album_name, spotify_album_release_date, spotify_track_id, spotify_album_image_url')
            .not('added_at', 'is', null)
          if (data) setSpotifySongs(data as typeof initialSpotifySongs)
          break
        }
        cursor = json.next_url
        pages++
        await new Promise(r => setTimeout(r, 1500))
      } catch { break }
    }
  }, [supabase]) // eslint-disable-line react-hooks/exhaustive-deps

  // GP-124: lazy-load Spotify songs on first Spotify tab click; cache in state
  useEffect(() => {
    if (viewMode !== 'spotify') return
    if (spotifyLoaded || spotifyLoading) return
    if (readOnly || !profileHeader?.spotify_connected) return
    setSpotifyLoading(true)
    supabase
      .from('user_spotify_songs')
      .select('added_at, spotify_artist_id, artist_name, track_name, spotify_album_name, spotify_album_release_date, spotify_track_id, spotify_album_image_url')
      .not('added_at', 'is', null)
      .then(({ data, error }) => {
        if (!error && data) {
          setSpotifySongs(data as typeof initialSpotifySongs)
          const needsBackfill = data.some((s: any) => !s.spotify_album_image_url)
          if (needsBackfill) runAlbumBackfillSilently()
        }
        setSpotifyLoaded(true)
        setSpotifyLoading(false)
      })
  }, [viewMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // GP-126: load first show date for Grooveprint badge (own profile only)
  useEffect(() => {
    if (readOnly || !profileHeader?.confirmed_shows) return
    supabase.rpc('get_first_show_date')
      .then(({ data, error }) => { if (!error && data) setGrooveprintSince(data as string) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // GP-118: load Discogs releases on mount when own profile is connected — data ready for header stats + Discogs tab
  useEffect(() => {
    if (discogsLoaded || discogsLoading || readOnly) return
    if (!profileHeader?.discogs_connected) return
    setDiscogsLoading(true)
    supabase
      .from('user_discogs_releases')
      .select('discogs_release_id, discogs_instance_id, title, year, formats, discogs_artist_names, discogs_artist_ids, date_added')
      .then(({ data, error }) => {
        if (!error && data) setDiscogsReleases(data as DiscogsRelease[])
        setDiscogsLoaded(true)
        setDiscogsLoading(false)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

    return {
      total: shows.length,
      artists: new Set(shows.map(s => s.artist.artist_id)).size,
      venues:  new Set(shows.map(s => s.venue.venue_id)).size,
      past, future,
      firstShow,
      lastShow,
    }
  }, [shows])

  // ── Raw Spotify songs per year/month ──────────────────────────────────────
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

  // GP-80: Artist-contextual Spotify songs per year/month.
  const artistContextualByYearMonth = useMemo(() => {
    if (!hasSpotify || spotifySongs.length === 0) return {} as Record<string, Record<number, number>>

    const showArtistsByKey: Record<string, Set<string>> = {}
    for (const show of shows) {
      if (!show.artist.spotify_artist_id) continue
      const [yearStr, monthStr] = show.date.split('-')
      const year  = parseInt(yearStr)
      const month = parseInt(monthStr) - 1

      for (let delta = -1; delta <= 1; delta++) {
        let m = month + delta
        let y = year
        if (m < 0)  { m += 12; y-- }
        if (m > 11) { m -= 12; y++ }
        const key = `${y}-${m}`
        if (!showArtistsByKey[key]) showArtistsByKey[key] = new Set()
        showArtistsByKey[key].add(show.artist.spotify_artist_id)
      }
    }

    const result: Record<string, Record<number, number>> = {}
    for (const song of spotifySongs) {
      if (!song.spotify_artist_id) continue
      const dt = new Date(song.added_at)
      const y  = dt.getFullYear()
      const m  = dt.getMonth()
      const key = `${y}-${m}`
      if (showArtistsByKey[key]?.has(song.spotify_artist_id)) {
        const yStr = String(y)
        if (!result[yStr]) result[yStr] = {}
        result[yStr][m] = (result[yStr][m] ?? 0) + 1
      }
    }
    return result
  }, [shows, spotifySongs, hasSpotify])

  // GP-80 / GP-88: Top Spotify artists by liked-song count (respects selectedYear filter).
  const topSpotifyArtists = useMemo(() => {
    if (spotifySongs.length === 0) return [] as {
      name: string; count: number; spotifyId: string; hasAlbumData: boolean
      albums: { name: string | null; year: string | null; releaseDate: string | null; imageUrl: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }[]
    }[]
    // GP-113: filter by year AND month (when selectedMonth is set for day drilldown)
    const src = selectedYear
      ? spotifySongs.filter(s => {
          const dt = new Date(s.added_at)
          if (String(dt.getFullYear()) !== selectedYear) return false
          if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false
          return true
        })
      : spotifySongs
    const raw: Record<string, {
      name: string; count: number; spotifyId: string
      songList: { track_name: string; album_name: string | null; album_image_url: string | null; release_year: string | null; release_date: string | null; track_id: string | null; added_at: string }[]
    }> = {}
    for (const song of src) {
      if (!song.spotify_artist_id) continue
      if (!raw[song.spotify_artist_id]) {
        raw[song.spotify_artist_id] = {
          name: song.artist_name,
          count: 0,
          spotifyId: song.spotify_artist_id,
          songList: [],
        }
      }
      raw[song.spotify_artist_id].count++
      raw[song.spotify_artist_id].songList.push({
        track_name:      song.track_name,
        album_name:      song.spotify_album_name ?? null,
        album_image_url: song.spotify_album_image_url ?? null,
        release_year:    song.spotify_album_release_date ? song.spotify_album_release_date.substring(0, 4) : null,
        release_date:    song.spotify_album_release_date ?? null,
        track_id:        song.spotify_track_id ?? null,
        added_at:        song.added_at,
      })
    }
    return Object.values(raw)
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map(artist => {
        const sorted = [...artist.songList].sort((a, b) => b.added_at.localeCompare(a.added_at))
        const hasAlbumData = sorted.some(s => s.album_name)
        const albumMap: Record<string, { name: string | null; year: string | null; releaseDate: string | null; imageUrl: string | null; songs: { track_name: string; track_id: string | null; added_at: string }[] }> = {}
        for (const song of sorted) {
          const key = song.album_name ?? '__null__'
          if (!albumMap[key]) albumMap[key] = { name: song.album_name, year: song.release_year, releaseDate: song.release_date ?? null, imageUrl: song.album_image_url ?? null, songs: [] }
          albumMap[key].songs.push({ track_name: song.track_name, track_id: song.track_id, added_at: song.added_at })
        }
        // Sort albums: year desc (newest first for expandable list), null-named albums last
        const albums = Object.values(albumMap).sort((a, b) => {
          if (a.name === null) return 1
          if (b.name === null) return -1
          if (!a.year && !b.year) return 0
          if (!a.year) return 1
          if (!b.year) return -1
          return parseInt(b.year) - parseInt(a.year)
        })
        return { name: artist.name, count: artist.count, spotifyId: artist.spotifyId, hasAlbumData, albums }
      })
  }, [spotifySongs, hasSpotify, selectedYear, selectedMonth])

  const firstSpotifyYear = useMemo(() => Object.keys(spotifyByYearMonth).sort()[0] ?? null, [spotifyByYearMonth])

  // GP-111: Top Albums memo — aggregates songs by album, respects filterText + selectedYear
  const topSpotifyAlbums = useMemo(() => {
    if (spotifySongs.length === 0) return [] as { albumName: string; artistName: string; artistId: string | null; year: string | null; releaseDate: string | null; addedYear: string | null; count: number; songs: { track_name: string; track_id: string | null; added_at: string }[] }[]
    const q = filterText.trim().toLowerCase()
    const src0 = q
      ? spotifySongs.filter(s =>
          s.artist_name.toLowerCase().includes(q) ||
          (s.spotify_album_name?.toLowerCase().includes(q) ?? false)
        )
      : spotifySongs
    // GP-113: filter by year AND month when selectedMonth is set
    const src = selectedYear
      ? src0.filter(s => {
          const dt = new Date(s.added_at)
          if (String(dt.getFullYear()) !== selectedYear) return false
          if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false
          return true
        })
      : src0
    const albumMap: Record<string, { albumName: string; artistName: string; artistId: string | null; year: string | null; releaseDate: string | null; addedYear: string | null; count: number; songs: { track_name: string; track_id: string | null; added_at: string }[]; addedYearCounts: Record<string, number> }> = {}
    for (const song of src) {
      if (!song.spotify_album_name) continue
      const key = `${song.spotify_album_name}::${song.spotify_artist_id ?? ''}`
      if (!albumMap[key]) albumMap[key] = { albumName: song.spotify_album_name, artistName: song.artist_name, artistId: song.spotify_artist_id ?? null, year: song.spotify_album_release_date ? song.spotify_album_release_date.substring(0, 4) : null, releaseDate: song.spotify_album_release_date ?? null, addedYear: null, count: 0, songs: [], addedYearCounts: {} }
      albumMap[key].count++
      albumMap[key].songs.push({ track_name: song.track_name, track_id: song.spotify_track_id ?? null, added_at: song.added_at })
      // GP-111 (#4): track which added year has the most songs to use for drilldown
      const addedY = String(new Date(song.added_at).getFullYear())
      albumMap[key].addedYearCounts[addedY] = (albumMap[key].addedYearCounts[addedY] ?? 0) + 1
    }
    return Object.values(albumMap)
      .map(alb => {
        // Pick the mode year (most songs added)
        const addedYear = Object.entries(alb.addedYearCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        const { addedYearCounts: _, ...rest } = alb
        return { ...rest, addedYear }
      })
      .sort((a, b) => b.count - a.count).slice(0, 50)
  }, [spotifySongs, hasSpotify, filterText, selectedYear, selectedMonth])

  // GP-118: Discogs timeline — release year (area) + date_added year (dashed line)
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

  // GP-118: top Discogs artists (Various Artists excluded), sorted by total desc, sliced to 50
  const topDiscogsArtists = useMemo(() => {
    if (discogsReleases.length === 0) return [] as {
      name: string; discogsArtistId: number | null; total: number
      formatCounts: Record<DiscogsFmt, number>
      releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null; releaseId: number }[]
    }[]
    const map: Record<string, {
      name: string; discogsArtistId: number | null; total: number
      formatCounts: Record<DiscogsFmt, number>
      releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null; releaseId: number }[]
    }> = {}
    for (const r of discogsReleases) {
      const fmt = getDiscogsFmt(r.formats)
      for (let idx = 0; idx < r.discogs_artist_names.length; idx++) {
        const name = r.discogs_artist_names[idx]
        const nl = name.toLowerCase()
        if (nl === 'various' || nl === 'various artists') continue
        const artistId = r.discogs_artist_ids[idx] ?? null
        if (!map[name]) map[name] = { name, discogsArtistId: artistId, total: 0, formatCounts: { vinyl: 0, cd: 0, cassette: 0, other: 0 }, releases: [] }
        map[name].total++
        map[name].formatCounts[fmt]++
        map[name].releases.push({ title: r.title, year: r.year, fmt, date_added: r.date_added, releaseId: r.discogs_release_id })
      }
    }
    return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 50)
  }, [discogsReleases])

  // GP-118: format breakdown for donut
  const discogsFormatData = useMemo(() => {
    if (discogsReleases.length === 0) return [] as { fmt: DiscogsFmt; label: string; value: number; color: string }[]
    const counts: Record<DiscogsFmt, number> = { vinyl: 0, cd: 0, cassette: 0, other: 0 }
    for (const r of discogsReleases) counts[getDiscogsFmt(r.formats)]++
    return DISCOGS_FMT_KEYS
      .map(fmt => ({ fmt, label: DISCOGS_FMT_META[fmt].label, value: counts[fmt], color: DISCOGS_FMT_META[fmt].color }))
      .filter(d => d.value > 0)
  }, [discogsReleases])

  // GP-118: filtered Discogs artists (respects format filter + text filter)
  const filteredDiscogsArtists = useMemo(() => {
    const fmtFiltered = discogsFmtFilter === 'all'
      ? topDiscogsArtists
      : topDiscogsArtists.filter(a => a.formatCounts[discogsFmtFilter] > 0)
    if (!filterText.trim()) return fmtFiltered
    const q = filterText.toLowerCase()
    return fmtFiltered.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.releases.some(r => r.title.toLowerCase().includes(q))
    )
  }, [topDiscogsArtists, discogsFmtFilter, filterText])

  // GP-118: aggregate releases by release year (sorted by total desc for "Top Years" ranking)
  const topDiscogsYears = useMemo(() => {
    if (discogsReleases.length === 0) return [] as typeof filteredDiscogsArtists
    const map: Record<string, {
      name: string; discogsArtistId: null; total: number
      formatCounts: Record<DiscogsFmt, number>
      releases: { title: string; year: number | null; fmt: DiscogsFmt; date_added: string | null; releaseId: number }[]
    }> = {}
    for (const r of discogsReleases) {
      const fmt = getDiscogsFmt(r.formats)
      const key = r.year ? String(r.year) : 'Unknown'
      if (!map[key]) map[key] = { name: key, discogsArtistId: null, total: 0, formatCounts: { vinyl: 0, cd: 0, cassette: 0, other: 0 }, releases: [] }
      map[key].total++
      map[key].formatCounts[fmt]++
      map[key].releases.push({ title: r.title, year: r.year, fmt, date_added: r.date_added, releaseId: r.discogs_release_id })
    }
    return Object.values(map).sort((a, b) => b.total - a.total)
  }, [discogsReleases])

  const filteredDiscogsYears = useMemo(() => {
    const fmtFiltered = discogsFmtFilter === 'all'
      ? topDiscogsYears
      : topDiscogsYears.filter(y => y.formatCounts[discogsFmtFilter] > 0)
    if (!filterText.trim()) return fmtFiltered
    const q = filterText.toLowerCase()
    return fmtFiltered.filter(y => y.releases.some(r => r.title.toLowerCase().includes(q)))
  }, [topDiscogsYears, discogsFmtFilter, filterText])

  // GP-118: summary stats for ProfileHeaderCard — computed from loaded releases
  const discogsStats = useMemo(() => {
    if (discogsReleases.length === 0) return null
    const nonVarious = new Set(discogsReleases.flatMap(r =>
      r.discogs_artist_names.filter(n => {
        const nl = n.toLowerCase()
        return nl !== 'various' && nl !== 'various artists'
      })
    ))
    const years = discogsReleases
      .filter(r => r.date_added)
      .map(r => new Date(r.date_added!).getFullYear())
    const sinceYear = years.length > 0 ? Math.min(...years) : null
    const fmtCounts: Record<DiscogsFmt, number> = { vinyl: 0, cd: 0, cassette: 0, other: 0 }
    for (const r of discogsReleases) fmtCounts[getDiscogsFmt(r.formats)]++
    const formatCount = DISCOGS_FMT_KEYS.filter(f => fmtCounts[f] > 0).length
    const dominantFmt = DISCOGS_FMT_KEYS.reduce((a, b) => fmtCounts[a] >= fmtCounts[b] ? a : b)
    const latestRelease = discogsReleases
      .filter(r => r.date_added)
      .sort((a, b) => new Date(b.date_added!).getTime() - new Date(a.date_added!).getTime())[0] ?? null
    const lastAdded = latestRelease ? {
      title:  latestRelease.title,
      artist: latestRelease.discogs_artist_names[0] ?? null,
      year:   latestRelease.year,
      fmt:    DISCOGS_FMT_META[getDiscogsFmt(latestRelease.formats)].label,
    } : null
    return { count: discogsReleases.length, artistCount: nonVarious.size, sinceYear, formatCount, dominantFmt, lastAdded }
  }, [discogsReleases])

  // GP-112: Day-level data — computed when selectedMonth is set in Spotify mode
  const dayTimelineData = useMemo(() => {
    if (selectedMonth === null || !selectedYear || viewMode !== 'spotify') return [] as { day: string; shows: number; albumReleases: string[] }[]
    const q = filterText.trim().toLowerCase()
    const src = q
      ? spotifySongs.filter(s =>
          s.artist_name.toLowerCase().includes(q) ||
          (s.spotify_album_name?.toLowerCase().includes(q) ?? false)
        )
      : spotifySongs
    const byDay: Record<number, number> = {}
    for (const song of src) {
      const dt = new Date(song.added_at)
      if (String(dt.getFullYear()) !== selectedYear || dt.getMonth() !== selectedMonth) continue
      const d = dt.getDate()
      byDay[d] = (byDay[d] ?? 0) + 1
    }
    // Album releases on specific days (day-precision release dates only)
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
    return Array.from({ length: daysInMonth }, (_, i) => ({
      day: String(i + 1),
      shows: byDay[i + 1] ?? 0,
      albumReleases: albumReleasesByDay[i + 1] ?? [],
    }))
  }, [spotifySongs, selectedYear, selectedMonth, viewMode, filterText])

  // ── GP-92: text-filtered base ─────────────────────────────────────────
  const textFiltered = useMemo(() => {
    if (!filterText.trim()) return shows
    const q = filterText.toLowerCase()
    return shows.filter(s =>
      s.artist.artist_name.toLowerCase().includes(q) ||
      s.venue.venue_name.toLowerCase().includes(q) ||
      (s.festival_name ?? '').toLowerCase().includes(q)
    )
  }, [shows, filterText])

  const filterRange = useMemo(() => {
    if (!filterText.trim() || textFiltered.length === 0) return null
    const years = textFiltered.map(s => s.date.split('-')[0]).sort()
    const first = years[0]
    const last  = years[years.length - 1]
    return first === last ? first : `${first}–${last}`
  }, [textFiltered, filterText])

  // ── Year-filtered set ────────────────────────────────────────────────────
  const yearFiltered = useMemo(() => {
    if (!selectedYear) return textFiltered
    return textFiltered.filter(s => s.date.split('-')[0] === selectedYear)
  }, [textFiltered, selectedYear])

  // GP-80: yearTimelineData
  // GP-108: Spotify branch now filters by filterText so chart tracks the active artist/venue filter
  const yearTimelineData = useMemo(() => {
    // GP-118: Discogs uses its own discogsTimelineData; this memo returns empty to suppress the timeline card
    if (viewMode === 'discogs') return []

    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      // GP-111 (#3): also match spotify_album_name so users can filter by album title
      const src = q
        ? spotifySongs.filter(s =>
            s.artist_name.toLowerCase().includes(q) ||
            (s.spotify_album_name?.toLowerCase().includes(q) ?? false)
          )
        : spotifySongs
      const byYear: Record<string, number> = {}
      const artistsByYear: Record<string, Set<string>> = {}
      for (const song of src) {
        const y = String(new Date(song.added_at).getFullYear())
        byYear[y] = (byYear[y] ?? 0) + 1
        if (song.spotify_artist_id) {
          if (!artistsByYear[y]) artistsByYear[y] = new Set()
          artistsByYear[y].add(song.spotify_artist_id)
        }
      }

      // GP-110: count unique albums released in each year (release year, not added year)
      const albumsByReleaseYear: Record<string, Set<string>> = {}
      for (const song of src) {
        if (!song.spotify_album_release_date || !song.spotify_album_name) continue
        const releaseYear = song.spotify_album_release_date.substring(0, 4)
        if (!albumsByReleaseYear[releaseYear]) albumsByReleaseYear[releaseYear] = new Set()
        albumsByReleaseYear[releaseYear].add(song.spotify_album_name)
      }

      return Object.entries(byYear)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([year, count]) => ({
          year,
          shows: count,
          albumCount: albumsByReleaseYear[year]?.size ?? 0,
          artistCount: artistsByYear[year]?.size ?? 0,
        }))
    }

    let src: (Show | BillGroup)[]
    if (viewMode === 'festivals') {
      src = textFiltered.filter(isFestivalShow)
    } else if (viewMode === 'shows') {
      const groups = buildBillGroups(textFiltered.filter(s => !isFestivalShow(s)))
      src = groups
    } else {
      src = textFiltered
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
  }, [textFiltered, viewMode, spotifySongs, filterText])

  const availableYears = useMemo(
    () => yearTimelineData.map(d => d.year),
    [yearTimelineData]
  )

  // GP-79: Slideshow
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

  // GP-80: monthTimelineData
  // GP-108: Spotify branch inline-filters by filterText so month drilldown tracks active artist
  // GP-109: single-artist Spotify view adds albumReleasesByMonth for release month markers
  const monthTimelineData = useMemo(() => {
    if (!selectedYear) return []

    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      // GP-111 (#3): also match spotify_album_name
      const src = q
        ? spotifySongs.filter(s =>
            s.artist_name.toLowerCase().includes(q) ||
            (s.spotify_album_name?.toLowerCase().includes(q) ?? false)
          )
        : spotifySongs
      const songsByMonth: Record<number, number> = {}
      for (const song of src) {
        const dt = new Date(song.added_at)
        if (String(dt.getFullYear()) !== selectedYear) continue
        const m = dt.getMonth()
        songsByMonth[m] = (songsByMonth[m] ?? 0) + 1
      }

      // GP-110 (#2): album count per month for bubble markers — all Spotify views
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

      // GP-109: compute album release markers for single-artist view.
      // Sequential ordinals (#1, #2...) ordered by release date within the year.
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
          // Sort chronologically within the year, then assign sequential ordinals
          releases.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate))
          releases.forEach((r, i) => {
            if (!albumReleasesByMonth[r.month]) albumReleasesByMonth[r.month] = []
            albumReleasesByMonth[r.month].push({ name: r.name, ordinal: i + 1 })
          })
        }
      }
      const hasReleaseMarkers = Object.keys(albumReleasesByMonth).length > 0

      return Array.from({ length: 12 }, (_, m) => ({
        month: MONTHS[m],
        shows: songsByMonth[m] ?? 0,
        albumMonthCount: albumCountByMonth[m] ?? 0,
        ...(hasReleaseMarkers ? { albumReleases: albumReleasesByMonth[m] ?? [] } : {}),
      }))
    }

    const src = viewMode === 'festivals'
      ? textFiltered.filter(isFestivalShow).filter(s => s.date.split('-')[0] === selectedYear)
      : textFiltered.filter(s => s.date.split('-')[0] === selectedYear)
    const byMonth: Record<number, number> = {}
    for (let m = 0; m < 12; m++) byMonth[m] = 0
    for (const s of src) {
      const m = parseInt(s.date.split('-')[1]) - 1
      byMonth[m]++
    }

    const contextualByMonth = artistContextualByYearMonth[selectedYear] ?? {}
    const hasContextual = Object.keys(contextualByMonth).length > 0

    return Array.from({ length: 12 }, (_, m) => ({
      month: MONTHS[m],
      shows: byMonth[m],
      albumMonthCount: 0,  // not applicable in concert modes; keeps type uniform with Spotify branch
      ...(hasSpotify && hasContextual ? { songs: contextualByMonth[m] ?? 0 } : {}),
    }))
  }, [textFiltered, selectedYear, viewMode, spotifySongs, filterText, artistContextualByYearMonth, hasSpotify])

  const firstYear = stats.firstShow?.date.split('-')[0]
  const lastYear  = stats.lastShow?.date.split('-')[0]

  const drilldownHasSpotify = selectedYear
    ? spotifySongs.length > 0 &&
    viewMode !== 'spotify' &&
      Object.keys(artistContextualByYearMonth[selectedYear] ?? {}).length > 0
    : false

  // GP-118: show dashed "added" line on Discogs timeline when date_added data exists
  const drilldownHasDiscogsAdded = viewMode === 'discogs' && discogsTimelineData.some(d => d.added > 0)

  const chartLineColor = viewMode === 'spotify' ? SPOTIFY_GREEN
    : viewMode === 'discogs' ? DISCOGS_COLOR
    : TEAL

  const timelineLegendLabel = viewMode === 'spotify' ? 'Songs added per year'
    : viewMode === 'discogs' ? 'Releases by year'
    : viewMode === 'sets' ? 'Sets per year'
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
    const groups = Array.from(map.entries()).map(([key, fs]) => {
      const [name] = key.split('__')
      const sorted = [...fs].sort((a, b) => b.date.localeCompare(a.date))
      const dates  = fs.map(s => s.date).sort()
      return { key, festival_name: name, year: fs[0].date.split('-')[0], shows: sorted, date_from: dates[0], date_to: dates[dates.length - 1], venue_name: fs[0].venue.venue_name }
    }).sort((a, b) => b.date_to.localeCompare(a.date_to))
    return groups
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

  // Filtered Spotify artists — client-side text filter on top of topSpotifyArtists
  const filteredSpotifyArtists = useMemo(() => {
    if (!filterText.trim()) return topSpotifyArtists
    const q = filterText.toLowerCase()
    // GP-111 (#3): match artist name OR any album name
    return topSpotifyArtists.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.albums.some(alb => alb.name?.toLowerCase().includes(q))
    )
  }, [topSpotifyArtists, filterText])

  const totalPages   = Math.ceil(setsFiltered.length / PER_PAGE)
  const currentShows = setsFiltered.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  // GP-80: dynamicStats
  // GP-108: Spotify branch now filters by filterText so badge counts reflect active filter
  const dynamicStats = useMemo(() => {
    // GP-118: Discogs branch
    if (viewMode === 'discogs') {
      const fmtFiltered = discogsFmtFilter === 'all'
        ? discogsReleases
        : discogsReleases.filter(r => getDiscogsFmt(r.formats) === discogsFmtFilter)
      const q = filterText.trim().toLowerCase()
      const src = q
        ? fmtFiltered.filter(r =>
            r.discogs_artist_names.some(n => n.toLowerCase().includes(q)) ||
            r.title.toLowerCase().includes(q))
        : fmtFiltered
      const nonVarious = new Set(src.flatMap(r =>
        r.discogs_artist_names.filter(n => { const nl = n.toLowerCase(); return nl !== 'various' && nl !== 'various artists' })
      ))
      return { sets: src.length, shows: 0, artists: nonVarious.size, venues: 0, festivals: 0 }
    }
    if (viewMode === 'spotify') {
      const q = filterText.trim().toLowerCase()
      // GP-111 (#3): also match spotify_album_name
      const artistFiltered = q
        ? spotifySongs.filter(s =>
            s.artist_name.toLowerCase().includes(q) ||
            (s.spotify_album_name?.toLowerCase().includes(q) ?? false)
          )
        : spotifySongs
      // GP-113: filter by year AND month when selectedMonth is set
      const src = selectedYear
        ? artistFiltered.filter(s => {
            const dt = new Date(s.added_at)
            if (dt.getFullYear() !== parseInt(selectedYear)) return false
            if (selectedMonth !== null && dt.getMonth() !== selectedMonth) return false
            return true
          })
        : artistFiltered
      return {
        sets: src.length,
        shows: 0,
        artists: new Set(src.map(s => s.spotify_artist_id).filter(Boolean)).size,
        venues: 0,
        festivals: 0,
      }
    }
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
  }, [viewMode, billGroups, setsFiltered, festivalGroups, spotifySongs, selectedYear, selectedMonth, filterText, discogsReleases, discogsFmtFilter])

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
    setSelectedYear(null); setSelectedMonth(null); setCapFilter('all'); setFilterText('')
    setPage(1); setPageInput('1'); setShowAllArtists(false)
    setSpotifyReleaseFocus(null)
    setDiscogsFmtFilter('all')
    setShowAllDiscogsArtists(false)
  }, [])

  // GP-91: set filter text and reset pagination
  const applyFilter = useCallback((name: string) => {
    setFilterText(name)
    setPage(1)
    setPageInput('1')
  }, [])

  // GP-107: year segment click — drills to that artist + year in one click
  const handleYearSegmentClick = useCallback((artistName: string, year: string) => {
    setIsPlaying(false)
    setFilterText(artistName)
    setSelectedYear(year)
    setSelectedMonth(null)
    setPage(1)
    setPageInput('1')
    setShowAllArtists(false)
  }, [])

  // GP-107: Spotify segment click — drills to release-year albums for that artist.
  // Does NOT use selectedYear for the expandable list (which stays filtered by spotifyReleaseFocus),
  // but DOES set selectedYear so the timeline immediately shows the monthly drilldown for that year.
  const handleSpotifySegmentClick = useCallback((artistName: string, releaseYear: string, spotifyId: string) => {
    setIsPlaying(false)
    setFilterText(artistName)
    setSelectedYear(releaseYear)
    setSelectedMonth(null)
    setExpandedSpotifyArtists(new Set([spotifyId]))
    setSpotifyReleaseFocus({ artistId: spotifyId, releaseYear })
    setPage(1)
    setPageInput('1')
  }, [])

  // GP-111: album row click — drills into artist + release year, switches back to artist view
  // GP-111 (#4): uses addedYear (not releaseYear) for selectedYear so the timeline shows when songs were added
  const handleAlbumClick = useCallback((artistName: string, releaseYear: string | null, artistId: string | null, addedYear: string | null) => {
    setFilterText(artistName)
    if (artistId) {
      setIsPlaying(false)
      setExpandedSpotifyArtists(new Set([artistId]))
      if (releaseYear) setSpotifyReleaseFocus({ artistId, releaseYear })
      // Use addedYear for the timeline (when user actually added these songs), falling back to releaseYear
      const yearForTimeline = addedYear ?? releaseYear
      if (yearForTimeline) {
        setSelectedYear(yearForTimeline)
        setSelectedMonth(null)
      }
    }
    setSpotifyLibraryView('artists')
    setPage(1)
    setPageInput('1')
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
        .select(`show_id, added_at, source, fact_shows ( show_id, date, setlist_url, show_type, festival_name, tour_name, dim_artist ( artist_id, artist_name, monthly_listeners, spotify_artist_id, kexp_url, kexp_session_count, tiny_desk_url, tiny_desk_session_count ), dim_venue ( venue_id, venue_name, capacity, capacity_category, city, state, tm_url ) )`)
        .eq('user_id', user.id).order('added_at', { ascending: false })
      if (newShows) {
        const mapped = newShows.map((us: any) => {
          const show = Array.isArray(us.fact_shows) ? us.fact_shows[0] : us.fact_shows
          if (!show) return null
          const artist = Array.isArray(show.dim_artist) ? show.dim_artist[0] : show.dim_artist
          const venue  = Array.isArray(show.dim_venue)  ? show.dim_venue[0]  : show.dim_venue
          if (!artist || !venue) return null
          return { show_id: show.show_id, date: show.date, setlist_url: show.setlist_url, show_type: show.show_type, festival_name: show.festival_name, tour_name: show.tour_name ?? null, added_at: us.added_at, notes: null, source: us.source, city: venue.city ?? null, venue_state: venue.state ?? null, artist: { artist_id: artist.artist_id, artist_name: artist.artist_name, monthly_listeners: artist.monthly_listeners, spotify_artist_id: artist.spotify_artist_id, kexp_url: artist.kexp_url ?? null, kexp_session_count: artist.kexp_session_count ?? null, tiny_desk_url: artist.tiny_desk_url ?? null, tiny_desk_session_count: artist.tiny_desk_session_count ?? null }, venue: { venue_id: venue.venue_id, venue_name: venue.venue_name, capacity: venue.capacity ?? null, capacity_category: venue.capacity_category ?? null, tm_url: venue.tm_url ?? null } }
        }).filter(Boolean)
        setShows(mapped as Show[])
      }
      setUnaddedArtists([])
    } catch (e) { console.error('Error adding unadded:', e) }
    finally { setAddingUnadded(false) }
  }

  // GP-90: add a single co-billed artist to user_shows
  const addUnaddedOne = async (artist: UnaddedArtist) => {
    if (readOnly) return
    setAddingIndividual(prev => new Set(prev).add(artist.show_id))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_shows').upsert(
        { user_id: user.id, show_id: artist.show_id, status: 'attended', source: 'manual' },
        { onConflict: 'user_id,show_id' }
      )
      setUnaddedArtists(prev => prev.filter(a => a.show_id !== artist.show_id))
      setSessionShowsModified(true)
    } catch (e) { console.error('Error adding show:', e) }
    finally { setAddingIndividual(prev => { const s = new Set(prev); s.delete(artist.show_id); return s }) }
  }

  // GP-90: skip a single co-billed artist
  const skipUnaddedOne = async (artist: UnaddedArtist) => {
    if (readOnly) return
    setSkippingIndividual(prev => new Set(prev).add(artist.show_id))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase.from('user_show_reviews').upsert(
        { user_id: user.id, show_id: artist.show_id, source: 'cobill', status: 'skipped' },
        { onConflict: 'user_id,show_id' }
      )
      setUnaddedArtists(prev => prev.filter(a => a.show_id !== artist.show_id))
      setSkippedArtists(prev => [...prev, artist].sort((a, b) => a.date.localeCompare(b.date)))
    } catch (e) { console.error('Error skipping show:', e) }
    finally { setSkippingIndividual(prev => { const s = new Set(prev); s.delete(artist.show_id); return s }) }
  }

  // GP-90: skip all remaining unadded artists at once
  const skipUnaddedAll = async () => {
    if (readOnly || !unaddedArtists.length) return
    setSkippingAll(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const records = unaddedArtists.map(a => ({
        user_id: user.id, show_id: a.show_id, source: 'cobill', status: 'skipped',
      }))
      await supabase.from('user_show_reviews').upsert(records, { onConflict: 'user_id,show_id' })
      setSkippedArtists(prev => [...prev, ...unaddedArtists].sort((a, b) => a.date.localeCompare(b.date)))
      setUnaddedArtists([])
    } catch (e) { console.error('Error skipping all:', e) }
    finally { setSkippingAll(false) }
  }

  // GP-90: restore a previously skipped artist
  const restoreSkipped = async (artist: UnaddedArtist) => {
    if (readOnly) return
    setRestoringIndividual(prev => new Set(prev).add(artist.show_id))
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('user_show_reviews')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', artist.show_id)
      setSkippedArtists(prev => prev.filter(a => a.show_id !== artist.show_id))
      setUnaddedArtists(prev => [...prev, artist].sort((a, b) => a.date.localeCompare(b.date)))
    } catch (e) { console.error('Error restoring show:', e) }
    finally { setRestoringIndividual(prev => { const s = new Set(prev); s.delete(artist.show_id); return s }) }
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
            {readOnly ? `${username}'s Grooveprint` : 'My Grooveprint'}
            {filterText.trim() ? (
              <>
                <span className="text-muted-foreground font-normal"> · {filterText}</span>
                {selectedYear
                  ? <span className="text-muted-foreground font-normal"> · {selectedMonth !== null ? `${MONTHS[selectedMonth]} ` : ''}{selectedYear}</span>
                  : filterRange && <span className="text-muted-foreground font-normal"> · {filterRange}</span>
                }
              </>
            ) : (
              <>
                {selectedYear && <span className="text-muted-foreground font-normal"> · {selectedMonth !== null ? `${MONTHS[selectedMonth]} ` : ''}{selectedYear}</span>}
                {!selectedYear && capFilter !== 'all' && <span className="text-muted-foreground font-normal"> · {CAP_BY_KEY[capFilter]?.legendLabel}</span>}
              </>
            )}
          </h1>

          {/* ── GP-114: Profile header card ── */}
          {profileHeader && (
            <ProfileHeaderCard
              header={profileHeader}
              readOnly={readOnly}
              discogsStats={!readOnly ? discogsStats : null}
              grooveprintSince={grooveprintSince}
            />
          )}

          {/* ── Unadded CTA ── */}
          {!readOnly && !unaddedDismissed && unaddedArtists.length > 0 && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">

                  {unaddedArtists.length > 0 && (
                    <>
                      <p className="text-sm font-medium text-foreground mb-1">
                        {unaddedArtists.length} artist{unaddedArtists.length !== 1 ? 's' : ''} from shows you attended {unaddedArtists.length !== 1 ? "haven't" : "hasn't"} been added yet
                      </p>

                      {!unaddedExpanded && (
                        <p className="text-xs text-muted-foreground truncate">
                          {unaddedArtists.slice(0, 4).map(a => a.artist_name).join(', ')}
                          {unaddedArtists.length > 4 ? ` + ${unaddedArtists.length - 4} more` : ''}
                        </p>
                      )}

                      {unaddedExpanded && (
                        <div className="mt-2 space-y-1 max-h-52 overflow-y-auto pr-1">
                          {unaddedArtists.map(a => {
                            const isAdding   = addingIndividual.has(a.show_id)
                            const isSkipping = skippingIndividual.has(a.show_id)
                            const isBusy     = isAdding || isSkipping
                            const globalBusy = addingUnadded || skippingAll
                            return (
                              <div key={a.show_id} className="grid items-center gap-x-3 py-1.5" style={{ gridTemplateColumns: '80px 200px auto' }}>
                                <span className="text-muted-foreground text-[11px] tabular-nums">{fmtDate(a.date)}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate" style={{ color: TEAL }}>{a.artist_name}</p>
                                  <p className="text-[11px] text-foreground/75 truncate">@ {a.venue_name}</p>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => addUnaddedOne(a)}
                                    disabled={isBusy || globalBusy}
                                    className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40"
                                  >
                                    {isAdding
                                      ? <div className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" />
                                      : '+ Add'}
                                  </button>
                                  <button
                                    onClick={() => skipUnaddedOne(a)}
                                    disabled={isBusy || globalBusy}
                                    className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-muted text-foreground/70 hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-40"
                                  >
                                    {isSkipping
                                      ? <div className="w-2.5 h-2.5 border border-foreground/40 border-t-transparent rounded-full animate-spin" />
                                      : '× Skip'}
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <button
                          onClick={addUnaddedAll}
                          disabled={addingUnadded || skippingAll || addingIndividual.size > 0 || skippingIndividual.size > 0}
                          className="text-xs font-semibold px-3 py-1.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition disabled:opacity-50"
                        >
                          {addingUnadded ? 'Adding...' : 'Add All'}
                        </button>
                        <button
                          onClick={skipUnaddedAll}
                          disabled={addingUnadded || skippingAll || addingIndividual.size > 0 || skippingIndividual.size > 0}
                          className="text-xs font-semibold text-destructive hover:opacity-75 transition disabled:opacity-50"
                        >
                          {skippingAll ? 'Skipping...' : 'Skip All'}
                        </button>
                        <button
                          onClick={() => setUnaddedExpanded(v => !v)}
                          className="text-xs text-primary hover:opacity-80 transition"
                        >
                          {unaddedExpanded ? 'Show less' : 'Review'}
                        </button>
                      </div>
                    </>
                  )}

                  {skippedArtists.length > 0 && (
                    <div className={unaddedArtists.length > 0 ? 'mt-3 pt-2.5 border-t border-primary/15' : ''}>
                      {unaddedArtists.length === 0 && (
                        <p className="text-sm font-medium text-foreground mb-1.5">
                          {skippedArtists.length} skipped artist{skippedArtists.length !== 1 ? 's' : ''}
                        </p>
                      )}
                      <button
                        onClick={() => setSkippedExpanded(v => !v)}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
                      >
                        <span>{skippedExpanded ? '▴' : '▾'}</span>
                        View skipped ({skippedArtists.length})
                      </button>
                      {skippedExpanded && (
                        <div className="mt-2 max-h-44 overflow-y-auto pr-1 divide-y divide-border/20">
                          {skippedArtists.map(a => {
                            const isRestoring = restoringIndividual.has(a.show_id)
                            return (
                              <div key={a.show_id} className="grid items-center gap-x-3 py-1.5 opacity-60 hover:opacity-80 transition-opacity" style={{ gridTemplateColumns: '80px 200px auto' }}>
                                <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(a.date)}</span>
                                <div className="min-w-0">
                                  <p className="text-xs font-medium truncate" style={{ color: TEAL }}>{a.artist_name}</p>
                                  <p className="text-[11px] text-foreground/75 truncate">@ {a.venue_name}</p>
                                </div>
                                <button
                                  onClick={() => restoreSkipped(a)}
                                  disabled={isRestoring}
                                  className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40 opacity-100 justify-self-start"
                                >
                                  {isRestoring
                                    ? <div className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" />
                                    : '↩ Restore'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}

                </div>
                <button onClick={() => setUnaddedDismissed(true)} className="text-muted-foreground hover:text-foreground transition text-lg leading-none flex-shrink-0">×</button>
              </div>
            </div>
          )}

          {/* ── Restore skipped link (shown only when no unadded remain) ── */}
          {!readOnly && !unaddedDismissed && unaddedArtists.length === 0 && skippedArtists.length > 0 && (
            <div>
              <button onClick={() => setSkippedExpanded(v => !v)}
                className="text-xs text-muted-foreground hover:text-foreground transition flex items-center gap-1">
                {skippedExpanded ? '▴' : '▾'} {skippedArtists.length} skipped co-bill {skippedArtists.length === 1 ? 'artist' : 'artists'} · restore?
              </button>
              {skippedExpanded && (
                <div className="mt-2 bg-card border border-border rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto">
                  {skippedArtists.map(a => {
                    const isRestoring = restoringIndividual.has(a.show_id)
                    return (
                      <div key={a.show_id} className="grid items-center gap-x-3 py-1" style={{ gridTemplateColumns: '80px 200px auto' }}>
                        <span className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(a.date)}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium truncate" style={{ color: TEAL }}>{a.artist_name}</p>
                          <p className="text-[11px] text-foreground/75 truncate">@ {a.venue_name}</p>
                        </div>
                        <button onClick={() => restoreSkipped(a)} disabled={isRestoring}
                          className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors disabled:opacity-40">
                          {isRestoring ? <div className="w-2.5 h-2.5 border border-primary border-t-transparent rounded-full animate-spin" /> : '↩ Restore'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Concert / Spotify / Discogs Timeline ── */}
          {(viewMode === 'discogs' ? hasDiscogs : yearTimelineData.length > 0) && (
            <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5">
              <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  {/* GP-93: dynamic title */}
                  <h2 className="text-lg md:text-xl font-bold text-foreground">
                    {viewMode === 'spotify' ? 'Spotify Timeline' : viewMode === 'discogs' ? 'Collection Timeline' : 'Concert Timeline'}
                  </h2>
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
                    {viewMode === 'spotify' && <>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: SPOTIFY_GREEN }}>{dynamicStats.sets.toLocaleString()}</span>
                        <span className="text-muted-foreground"> songs</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: SPOTIFY_GREEN }}>{dynamicStats.artists.toLocaleString()}</span>
                        <span className="text-muted-foreground"> artists</span>
                      </span>
                    </>}
                    {viewMode === 'discogs' && <>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: DISCOGS_COLOR }}>{dynamicStats.sets.toLocaleString()}</span>
                        <span className="text-muted-foreground"> records</span>
                      </span>
                      <span className="bg-muted rounded-md px-2 py-0.5 font-medium">
                        <span style={{ color: DISCOGS_COLOR }}>{dynamicStats.artists.toLocaleString()}</span>
                        <span className="text-muted-foreground"> artists</span>
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
                  {!selectedYear && yearTimelineData.length > 1 && (
                    <button
                      onClick={handlePlayPause}
                      title={isPlaying ? 'Pause slideshow' : 'Play year-by-year slideshow'}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all bg-primary text-primary-foreground shadow-sm hover:opacity-90 hover:shadow-md ${
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

                  <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                    {(['shows', 'sets', 'festivals'] as ViewMode[]).map((m, i) => (
                      <button key={m} onClick={() => setViewMode(m)}
                        className={`px-3 py-1.5 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          viewMode === m ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}>{m}</button>
                    ))}
                    {hasSpotify && (
                      <button
                        onClick={() => setViewMode('spotify')}
                        className={`px-3 py-1.5 flex items-center gap-1 transition-colors border-l border-border ${
                          viewMode === 'spotify' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <SpotifyIcon className="w-3 h-3" fill={viewMode === 'spotify' ? 'currentColor' : SPOTIFY_GREEN} />
                        Spotify
                      </button>
                    )}
                    {hasDiscogs && (
                      <button
                        onClick={() => setViewMode('discogs')}
                        className={`px-3 py-1.5 flex items-center gap-1 transition-colors border-l border-border ${
                          viewMode === 'discogs' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <DiscogsIcon className="w-3 h-3" />
                        Discogs
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm inline-block" style={{ background: chartLineColor }} />
                  {selectedYear
                    ? (viewMode === 'spotify' ? 'Songs' : viewMode === 'sets' ? 'Sets' : viewMode === 'festivals' ? 'Festivals' : viewMode === 'discogs' ? 'Releases' : 'Shows')
                    : timelineLegendLabel}
                </span>
                {drilldownHasSpotify && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-sm inline-block" style={{ background: SPOTIFY_GREEN }} />
                    Matched artist songs {firstSpotifyYear && <span className="text-muted-foreground/50 ml-0.5">(from {firstSpotifyYear})</span>}
                  </span>
                )}
                {drilldownHasDiscogsAdded && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-0 border-t-2 border-dashed inline-block" style={{ borderColor: TEAL }} />
                    Added to collection
                  </span>
                )}
                {viewMode !== 'sets' && viewMode !== 'spotify' && viewMode !== 'discogs' && (
                  <span className="text-muted-foreground/50 text-[10px]">
                    {viewMode === 'shows' ? '· Bills with multiple acts count as 1 show' : '· Festival shows only'}
                  </span>
                )}
              </div>

              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {selectedMonth !== null ? (
                    // GP-112: Day chart — third level of Spotify drilldown
                    <AreaChart data={dayTimelineData} margin={{ top: 22, right: 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={chartLineColor} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={chartLineColor} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false}
                        tickFormatter={(v: string) => (parseInt(v) % 5 === 0 || v === '1') ? v : ''} />
                      <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip content={(props: any) => <DayTip {...props} month={selectedMonth} year={selectedYear} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="shows" stroke={chartLineColor} strokeWidth={2} fill="url(#gradShows)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          const releases: string[] = payload?.albumReleases ?? []
                          if (releases.length > 0) {
                            const bubbleY = Math.max(10, cy - 18)
                            return (
                              <g key={`day-rel-${cx}`}>
                                <circle cx={cx} cy={cy} r={4} fill={SPOTIFY_GREEN} stroke="var(--background)" strokeWidth={1.5}/>
                                <circle cx={cx} cy={bubbleY} r={8} fill="rgba(29,185,84,0.15)" stroke={SPOTIFY_GREEN} strokeWidth={1}/>
                                <text x={cx} y={bubbleY + 4} textAnchor="middle" fontSize={releases.length >= 10 ? 7 : 9} fontWeight={700} fill={SPOTIFY_GREEN}>{releases.length}</text>
                              </g>
                            )
                          }
                          if ((payload.shows ?? 0) === 0) return <g key={`e-${cx}`} />
                          return <circle key={`d-${cx}`} cx={cx} cy={cy} r={3} fill={chartLineColor} stroke="var(--background)" strokeWidth={1.5}/>
                        }} activeDot={{ r: 4, fill: chartLineColor }} />
                    </AreaChart>
                  ) : selectedYear ? (
                    <ComposedChart data={monthTimelineData} margin={{ top: 16, right: drilldownHasSpotify ? 40 : 8, left: -20, bottom: 0 }}
                      onClick={(d: any) => {
                        if (viewMode === 'spotify') {
                          const monthLabel = d?.activeLabel as string | undefined
                          const monthIdx = MONTHS.indexOf(monthLabel ?? '')
                          if (monthIdx >= 0) setSelectedMonth(monthIdx)
                        }
                      }}
                      style={{ cursor: viewMode === 'spotify' ? 'pointer' : 'default' }}>
                      <defs>
                        <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={chartLineColor} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={chartLineColor} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="shows" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => v.toLocaleString()} />
                      {drilldownHasSpotify && (
                        <YAxis yAxisId="songs" orientation="right" tick={{ fill: SPOTIFY_GREEN, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      )}
                      <Tooltip content={(props: any) => <MonthTip {...props} viewMode={viewMode} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                      <Area yAxisId="shows" type="monotone" dataKey="shows" stroke={chartLineColor} strokeWidth={2} fill="url(#gradShows)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          // GP-109: release month marker — distinctive outlined dot + sequential ordinal label
                          const releases: { name: string; ordinal: number }[] = payload?.albumReleases ?? []
                          if (releases.length > 0) {
                            const ords = releases.map(r => r.ordinal)
                            const lo = Math.min(...ords), hi = Math.max(...ords)
                            const label = lo === hi ? `#${lo}` : `#${lo}–${hi}`
                            return (
                              <g key={`rel-${cx}`}>
                                <circle cx={cx} cy={cy} r={5} fill={SPOTIFY_GREEN} stroke="var(--background)" strokeWidth={2}/>
                                <circle cx={cx} cy={cy} r={8} fill="none" stroke={SPOTIFY_GREEN} strokeWidth={1.5} opacity={0.55}/>
                                <text x={cx} y={cy - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={SPOTIFY_GREEN}>
                                  {label}
                                </text>
                              </g>
                            )
                          }
                          // GP-110 (#2): plain count bubble for multi-artist months
                          const monthCount: number = payload?.albumMonthCount ?? 0
                          if (monthCount > 0) {
                            const bubbleY = Math.max(10, cy - 18)
                            return (
                              <g key={`mc-${cx}`}>
                                <circle cx={cx} cy={cy} r={3} fill={chartLineColor} stroke="var(--background)" strokeWidth={1.5}/>
                                <circle cx={cx} cy={bubbleY} r={9} fill="rgba(29,185,84,0.15)" stroke={SPOTIFY_GREEN} strokeWidth={1}/>
                                <text x={cx} y={bubbleY + 4} textAnchor="middle" fontSize={monthCount >= 100 ? 7 : monthCount >= 10 ? 8 : 9} fontWeight={700} fill={SPOTIFY_GREEN}>
                                  {monthCount}
                                </text>
                              </g>
                            )
                          }
                          if ((payload.shows ?? 0) === 0) return <g key={`e-${cx}`} />
                          return <circle key={`s-${cx}`} cx={cx} cy={cy} r={3} fill={chartLineColor} stroke="var(--background)" strokeWidth={1.5}/>
                        }} activeDot={{ r: 4, fill: chartLineColor }} />
                      {drilldownHasSpotify && (
                        <Line yAxisId="songs" type="monotone" dataKey="songs" stroke={SPOTIFY_GREEN} strokeWidth={2}
                          dot={(p: any) => {
                            const { cx, cy, payload } = p
                            if (!payload.songs || payload.songs === 0) return <g key={`e-${cx}`} />
                            return <circle key={`sp-${cx}`} cx={cx} cy={cy} r={3} fill={SPOTIFY_GREEN} stroke="var(--background)" strokeWidth={1.5}/>
                          }} connectNulls={false} activeDot={{ r: 4, fill: SPOTIFY_GREEN }} />
                      )}
                    </ComposedChart>
                  ) : viewMode === 'discogs' ? (
                    // GP-118: Discogs non-interactive area chart — releases by year + dashed added line
                    <ComposedChart data={discogsTimelineData} margin={{ top: 16, right: drilldownHasDiscogsAdded ? 40 : 8, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradDiscogs" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={DISCOGS_COLOR} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={DISCOGS_COLOR} stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="year" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis yAxisId="releases" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => v.toLocaleString()} />
                      {drilldownHasDiscogsAdded && (
                        <YAxis yAxisId="added" orientation="right" tick={{ fill: TEAL, fontSize: 10 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      )}
                      <Tooltip content={(props: any) => <DiscogsTip {...props} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                      <Area yAxisId="releases" type="monotone" dataKey="releases" stroke={DISCOGS_COLOR} strokeWidth={2} fill="url(#gradDiscogs)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          if ((payload.releases ?? 0) === 0) return <g key={`e-${cx}`} />
                          return <circle key={`d-${cx}`} cx={cx} cy={cy} r={3} fill={DISCOGS_COLOR} stroke="var(--background)" strokeWidth={1.5}/>
                        }} activeDot={{ r: 4, fill: DISCOGS_COLOR }} />
                      {drilldownHasDiscogsAdded && (
                        <Line yAxisId="added" type="monotone" dataKey="added" stroke={TEAL} strokeWidth={2} strokeDasharray="5 3"
                          dot={(p: any) => {
                            const { cx, cy, payload } = p
                            if (!payload.added || payload.added === 0) return <g key={`e-${cx}`} />
                            return <circle key={`a-${cx}`} cx={cx} cy={cy} r={3} fill={TEAL} stroke="var(--background)" strokeWidth={1.5}/>
                          }} connectNulls={false} activeDot={{ r: 4, fill: TEAL }} />
                      )}
                    </ComposedChart>
                  ) : (
                    <AreaChart data={yearTimelineData} margin={{ top: 16, right: 8, left: -20, bottom: 0 }}
                      onClick={(d: any) => { const y = d?.activeLabel; if (y) handleYearClick(y) }}
                      style={{ cursor: 'pointer' }}>
                      <defs>
                        <linearGradient id="gradShows" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={chartLineColor} stopOpacity={0.3}/>
                          <stop offset="95%" stopColor={chartLineColor} stopOpacity={0.02}/>
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
                      <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} tickFormatter={(v: number) => v.toLocaleString()} />
                      <Tooltip content={(props: any) => <YearTip {...props} viewMode={viewMode} />} cursor={{ stroke: 'var(--border)', strokeWidth: 1 }} />
                      <Area type="monotone" dataKey="shows" stroke={chartLineColor} strokeWidth={2} fill="url(#gradShows)"
                        dot={(p: any) => {
                          const { cx, cy, payload } = p
                          // GP-110: album release count bubble in Spotify mode (plain number, no # prefix)
                          if (viewMode === 'spotify') {
                            const albumCount: number = payload?.albumCount ?? 0
                            const bubbleY = Math.max(10, cy - 18)
                            return (
                              <g key={`sp-${cx}`}>
                                <circle cx={cx} cy={cy} r={3} fill={chartLineColor} fillOpacity={0.8}/>
                                {albumCount > 0 && (
                                  <>
                                    <circle cx={cx} cy={bubbleY} r={9} fill="rgba(29,185,84,0.15)" stroke={SPOTIFY_GREEN} strokeWidth={1}/>
                                    <text x={cx} y={bubbleY + 4} textAnchor="middle" fontSize={albumCount >= 100 ? 7 : albumCount >= 10 ? 8 : 9} fontWeight={700} fill={SPOTIFY_GREEN}>
                                      {albumCount}
                                    </text>
                                  </>
                                )}
                              </g>
                            )
                          }
                          if (payload.year === firstYear)
                            return <circle key={`f-${cx}`} cx={cx} cy={cy} r={5} fill={chartLineColor} stroke="var(--background)" strokeWidth={2}/>
                          if (payload.year === lastYear && lastYear !== firstYear)
                            return <circle key={`l-${cx}`} cx={cx} cy={cy} r={5} fill={TEAL} stroke="var(--background)" strokeWidth={2}/>
                          return <circle key={`d-${cx}`} cx={cx} cy={cy} r={3} fill={chartLineColor} fillOpacity={0.7}/>
                        }} activeDot={{ r: 5, fill: chartLineColor }} />
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>

              {selectedMonth !== null ? (
                // GP-112: Day drilldown nav — month pills
                <div className="flex items-center justify-center gap-2 mt-3">
                  <button
                    onClick={() => setSelectedMonth(prev => prev !== null && prev > 0 ? prev - 1 : null)}
                    disabled={selectedMonth === 0}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)' }}
                    onMouseEnter={e => { if (selectedMonth > 0) (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.22)' }}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.12)'}
                  >
                    ‹ {selectedMonth > 0 ? MONTHS[selectedMonth - 1] : ''}
                  </button>
                  <span className="px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: 'rgba(13,148,136,0.2)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.4)' }}>
                    {MONTHS[selectedMonth]} {selectedYear}
                  </span>
                  <button
                    onClick={() => setSelectedMonth(prev => prev !== null && prev < 11 ? prev + 1 : null)}
                    disabled={selectedMonth === 11}
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
                    style={{ background: 'rgba(94,234,212,0.12)', color: '#5eead4', border: '1px solid rgba(94,234,212,0.25)' }}
                    onMouseEnter={e => { if (selectedMonth < 11) (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.22)' }}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'rgba(94,234,212,0.12)'}
                  >
                    {selectedMonth < 11 ? MONTHS[selectedMonth + 1] : ''} ›
                  </button>
                </div>
              ) : selectedYear && viewMode !== 'discogs' ? (() => {
                const idx = availableYears.indexOf(selectedYear)
                const prevYear = idx > 0 ? availableYears[idx - 1] : null
                const nextYear = idx < availableYears.length - 1 ? availableYears[idx + 1] : null
                return (
                  <div className="flex items-center justify-center gap-2 mt-3">
                    <button
                      onClick={() => { setIsPlaying(false); prevYear && setSelectedYear(prevYear); setSelectedMonth(null) }}
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
                      onClick={() => { setIsPlaying(false); nextYear && setSelectedYear(nextYear); setSelectedMonth(null) }}
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
              })() : (
                viewMode !== 'spotify' && viewMode !== 'discogs' && (stats.firstShow || stats.lastShow) && (
                  <div className="flex items-start justify-between gap-2 mt-2 text-xs text-muted-foreground">
                    {stats.firstShow && <span>First: <span className="text-foreground font-medium">{stats.firstShow.artist.artist_name}</span> · {fmtDate(stats.firstShow.date)}</span>}
                    {stats.lastShow && lastYear !== firstYear && <span className="text-right flex-shrink-0">Last: <span className="text-foreground font-medium">{stats.lastShow.artist.artist_name}</span> · {fmtDate(stats.lastShow.date)}</span>}
                  </div>
                )
              )}
            </div>
          )}

          {/* ── Filter search box ── */}
          {(shows.length > 0 || hasSpotify || hasDiscogs) && (
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none text-primary/60"
                fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
              <input
                type="text"
                value={filterText}
                onChange={e => { setFilterText(e.target.value); setPage(1); setPageInput('1') }}
                placeholder={viewMode === 'spotify' ? 'Filter by artist or album…' : viewMode === 'discogs' ? 'Filter by artist or title…' : 'Filter by artist or venue…'}
                className="w-full pl-9 pr-8 py-2 text-sm bg-card border border-primary/30 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors shadow-sm"
              />
              {filterText && (
                <button
                  onClick={() => { setFilterText(''); setPage(1); setPageInput('1'); setSpotifyReleaseFocus(null) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}

          {/* ── Top Artists / Venues + Donut ── */}
          {shows.length > 0 && (
            <div className="flex gap-4">
              <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 flex-1 min-w-0">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  {/* GP-93: dynamic card title */}
                  <h2 className="text-lg font-bold text-foreground">
                    {viewMode === 'spotify'
                      ? (spotifyLibraryView === 'albums' ? 'Top Albums in Your Library' : 'Top Artists in Your Library')
                      : viewMode === 'discogs'
                      ? (discogsView === 'years' ? 'Top Years in Your Collection' : 'Top Artists in Your Collection')
                      : (chartSection === 'artists' ? 'Top Artists' : 'Top Venues')}
                    {selectedYear && <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedYear}</span>}
                  </h2>
                  {spotifyReleaseFocus && viewMode === 'spotify' && spotifyLibraryView === 'artists' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ background: 'rgba(29,185,84,0.15)', color: SPOTIFY_GREEN }}>
                      {spotifyReleaseFocus.releaseYear} releases
                      <button onClick={() => setSpotifyReleaseFocus(null)} className="hover:opacity-70 leading-none">×</button>
                    </span>
                  )}
                  {/* GP-93/111/118: Artists/Years in Discogs; Artists/Albums in Spotify; Artists/Venues in concert */}
                  {viewMode === 'discogs' ? (
                    <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                      {(['artists', 'years'] as const).map((v, i) => (
                        <button key={v}
                          onClick={() => { setDiscogsView(v); setShowAllDiscogsArtists(false) }}
                          className={`px-2.5 py-1 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                            discogsView === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  ) : viewMode === 'spotify' ? (
                    <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                      {(['artists', 'albums'] as const).map((v, i) => (
                        <button key={v} onClick={() => setSpotifyLibraryView(v)}
                          className={`px-2.5 py-1 capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                            spotifyLibraryView === v ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'
                          }`}>
                          {v.charAt(0).toUpperCase() + v.slice(1)}
                        </button>
                      ))}
                    </div>
                  ) : (
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
                  )}
                </div>

                {/* GP-93/111/118: Discogs artist/year bars; Spotify Albums → SpotifyAlbumBars; Spotify Artists → SpotifyArtistBars; concert → existing */}
                {viewMode === 'discogs' ? (() => {
                  if (discogsLoading && discogsReleases.length === 0) return (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                      Loading your Discogs collection…
                    </div>
                  )
                  const discogsData = discogsView === 'years' ? filteredDiscogsYears : filteredDiscogsArtists
                  const label = discogsView === 'years' ? 'years' : 'artists'
                  if (discogsData.length === 0) return (
                    <p className="text-sm text-muted-foreground italic">No collection data.</p>
                  )
                  return (
                    <>
                      <DiscogsArtistBars
                        artists={discogsData.slice(0, showAllDiscogsArtists ? undefined : 10)}
                        max={discogsData[0]?.total ?? 1}
                      />
                      {discogsData.length > 10 && (
                        <button onClick={() => setShowAllDiscogsArtists(v => !v)} className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                          {showAllDiscogsArtists ? '← Show less' : `View all ${discogsData.length} ${label} \u2192`}
                        </button>
                      )}
                    </>
                  )
                })() : viewMode === 'spotify' && spotifyLibraryView === 'albums' ? (
                  spotifyLoading && spotifySongs.length === 0 ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                      Loading your Spotify library…
                    </div>
                  ) : topSpotifyAlbums.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No album data{selectedYear ? ` for ${selectedYear}` : ''}.</p>
                  ) : (
                    <>
                      <SpotifyAlbumBars
                        albums={topSpotifyAlbums.slice(0, showAllAlbums ? undefined : 10)}
                        max={topSpotifyAlbums[0]?.count ?? 1}
                        onAlbumClick={handleAlbumClick}
                      />
                      {topSpotifyAlbums.length > 10 && (
                        <button onClick={() => setShowAllAlbums(v => !v)} className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                          {showAllAlbums ? '← Show less' : `View all ${topSpotifyAlbums.length} library albums \u2192`}
                        </button>
                      )}
                    </>
                  )
                ) : viewMode === 'spotify' ? (
                  spotifyLoading && spotifySongs.length === 0 ? (
                    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                      <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                      Loading your Spotify library…
                    </div>
                  ) : filteredSpotifyArtists.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No Spotify data{selectedYear ? ` for ${selectedYear}` : ''}.</p>
                  ) : (
                    <>
                      <SpotifyArtistBars
                        artists={filteredSpotifyArtists.slice(0, showAllArtists ? undefined : 10)}
                        max={filteredSpotifyArtists[0]?.count ?? 1}
                        onYearClick={handleSpotifySegmentClick}
                      />
                      {filteredSpotifyArtists.length > 10 && (
                        <button onClick={() => setShowAllArtists(v => !v)} className="mt-3 text-xs text-primary hover:opacity-80 font-medium">
                          {showAllArtists ? '← Show less' : `View all ${filteredSpotifyArtists.length} library artists \u2192`}
                        </button>
                      )}
                    </>
                  )
                ) : chartSection === 'artists' ? (
                  topArtists.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No shows{selectedYear ? ` in ${selectedYear}` : ''}.</p>
                  ) : (
                    <>
                      <ArtistYearBars
                        artists={topArtists.slice(0, showAllArtists ? undefined : 10)}
                        max={maxArtistShows}
                        onNavigate={(name) => applyFilter(name)}
                        onYearClick={handleYearSegmentClick}
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
                        onNavigate={(name) => applyFilter(name)}
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

              {/* Donut — format breakdown in Discogs mode, venue sizes otherwise (hidden in Spotify mode) */}
              {viewMode === 'discogs' ? (
                <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-56 flex-shrink-0 hidden md:flex flex-col">
                  <h2 className="text-base font-bold text-foreground mb-3">By Format</h2>
                  {discogsFormatData.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No data</p>
                  ) : (
                    <>
                      <div className="relative" style={{ height: 148 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={discogsFormatData} cx="50%" cy="50%"
                              innerRadius={38} outerRadius={62} paddingAngle={2} dataKey="value" stroke="none"
                              onClick={(d: any) => setDiscogsFmtFilter(prev => prev === d.fmt ? 'all' : d.fmt as DiscogsFmt)}
                              style={{ cursor: 'pointer' }}
                              label={({ cx, cy, midAngle, innerRadius, outerRadius, percent, fmt }: any) => {
                                if (midAngle == null || percent == null || percent < 0.05) return null
                                const RADIAN = Math.PI / 180
                                const r = (innerRadius + outerRadius) * 0.5
                                const x = cx + r * Math.cos(-midAngle * RADIAN)
                                const y = cy + r * Math.sin(-midAngle * RADIAN)
                                return (
                                  <text x={x} y={y} fill="rgba(255,255,255,0.95)" textAnchor="middle" dominantBaseline="central"
                                    fontSize={11} fontWeight={700} style={{ pointerEvents: 'none' }}>
                                    {DISCOGS_FMT_META[fmt as DiscogsFmt]?.shortLabel ?? '?'}
                                  </text>
                                )
                              }}
                              labelLine={false}>
                              {discogsFormatData.map(entry => (
                                <Cell key={entry.fmt} fill={entry.color}
                                  opacity={discogsFmtFilter === 'all' || discogsFmtFilter === entry.fmt ? 1 : 0.25} />
                              ))}
                            </Pie>
                            <Tooltip content={(props: any) => {
                              if (!props.active || !props.payload?.length) return null
                              const e = props.payload[0]?.payload
                              if (!e) return null
                              return (
                                <div className="bg-card border border-border rounded-lg px-2.5 py-1.5 text-xs shadow-lg pointer-events-none">
                                  <p className="font-semibold text-foreground">{e.label}</p>
                                  <p style={{ color: DISCOGS_COLOR }} className="tabular-nums">{e.value} records</p>
                                </div>
                              )
                            }} />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-1.5 mt-1">
                        {discogsFormatData.map(entry => {
                          const total = discogsFormatData.reduce((s, d) => s + d.value, 0)
                          const pct   = total > 0 ? Math.round((entry.value / total) * 100) : 0
                          const isActive = discogsFmtFilter === 'all' || discogsFmtFilter === entry.fmt
                          return (
                            <button key={entry.fmt} onClick={() => setDiscogsFmtFilter(prev => prev === entry.fmt ? 'all' : entry.fmt)}
                              className={`w-full flex items-center gap-2 text-left transition-opacity ${isActive ? '' : 'opacity-35'}`}>
                              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: entry.color }} />
                              <span className="text-[11px] text-foreground flex-1 truncate">{entry.label}:</span>
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
                    </>
                  )}
                </div>
              ) : viewMode !== 'spotify' && <div className="bg-card rounded-lg shadow border border-border p-4 md:p-5 w-56 flex-shrink-0 hidden md:flex flex-col">
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
              </div>}
            </div>
          )}

          {/* ── GP-80 / GP-88 / GP-111: Spotify tab — artists or albums expandable list ── */}
          {viewMode === 'spotify' && hasSpotify && (
            <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <SpotifyIcon className="w-4 h-4" />
                  <h2 className="text-sm font-semibold text-foreground">
                    {spotifyLibraryView === 'albums' ? 'Top Albums in Your Library' : 'Top Artists in Your Library'}
                    {selectedYear && <span className="ml-2 text-sm font-normal text-muted-foreground">· {selectedYear}</span>}
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">
                  {spotifyLibraryView === 'albums'
                    ? `${topSpotifyAlbums.length} albums`
                    : `${filteredSpotifyArtists.length} artists`}
                </span>
              </div>
              {spotifyLibraryView === 'albums' ? (
                // GP-111: Album expandable list
                topSpotifyAlbums.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-4 py-6">No album data{selectedYear ? ` for ${selectedYear}` : ''}.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {topSpotifyAlbums.map((album, i) => {
                      const albumKey = `${album.albumName}::${album.artistName}`
                      const isExpanded = expandedAlbumKeys.has(albumKey)
                      return (
                        <div key={albumKey}>
                          <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                            onClick={() => setExpandedAlbumKeys(prev => { const n = new Set(prev); n.has(albumKey) ? n.delete(albumKey) : n.add(albumKey); return n })}>
                            <span className="text-xs font-bold tabular-nums w-6 text-right flex-shrink-0" style={{ color: SPOTIFY_GREEN }}>#{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm text-foreground truncate">{album.albumName}{album.year ? ` (${album.year})` : ''}</span>
                                {album.artistId && (
                                  <a href={`https://open.spotify.com/artist/${album.artistId}`} target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()} className="flex-shrink-0 hover:opacity-70 transition-opacity">
                                    <SpotifyIcon className="w-3 h-3" />
                                  </a>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground">{album.artistName}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-xs tabular-nums" style={{ color: SPOTIFY_GREEN }}>{album.count.toLocaleString()} {album.count === 1 ? 'song' : 'songs'}</span>
                              <span className="text-muted-foreground text-[10px] w-3 text-center">{isExpanded ? '▲' : '▼'}</span>
                            </div>
                          </div>
                          {isExpanded && (
                            <div className="border-t border-border/40 bg-background/50">
                              <div className="grid px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-muted/30 border-b border-border/30"
                                style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px', color: TEAL }}>
                                <span>Track</span><span className="text-right">Liked on</span>
                              </div>
                              <div className="max-h-48 overflow-y-auto divide-y divide-border/10">
                                {album.songs.map((song, j) => (
                                  <div key={j} className="grid items-center px-4 py-2 hover:bg-muted/20 transition-colors"
                                    style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px' }}>
                                    <div className="min-w-0 pl-2 pr-3">
                                      {song.track_id ? (
                                        <a href={`https://open.spotify.com/track/${song.track_id}`} target="_blank" rel="noopener noreferrer"
                                          className="text-xs text-foreground/80 hover:text-primary hover:underline truncate block transition-colors">
                                          {song.track_name}
                                        </a>
                                      ) : (
                                        <span className="text-xs text-foreground/80 truncate block">{song.track_name}</span>
                                      )}
                                    </div>
                                    <span className="text-xs text-foreground/50 tabular-nums text-right">
                                      {new Date(song.added_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
                )
              ) : (
              // Original artist expandable list
              spotifyLoading && spotifySongs.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                  Loading your Spotify library…
                </div>
              ) : filteredSpotifyArtists.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">No Spotify data{selectedYear ? ` for ${selectedYear}` : ''}.</p>
              ) : (
                <div className="divide-y divide-border">
                  {filteredSpotifyArtists.map((artist, i) => {
                    const isExpanded  = expandedSpotifyArtists.has(artist.spotifyId)
                    const toggleExpanded = () => setExpandedSpotifyArtists(prev => {
                      const n = new Set(prev)
                      n.has(artist.spotifyId) ? n.delete(artist.spotifyId) : n.add(artist.spotifyId)
                      return n
                    })
                    return (
                      <div key={artist.spotifyId}>
                        <div
                          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={toggleExpanded}
                        >
                          <span className="text-xs font-bold tabular-nums w-6 text-right flex-shrink-0" style={{ color: SPOTIFY_GREEN }}>
                            #{i + 1}
                          </span>
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <span className="text-sm text-foreground truncate">{artist.name}</span>
                            <a href={`https://open.spotify.com/artist/${artist.spotifyId}`}
                              target="_blank" rel="noopener noreferrer" title="Open in Spotify"
                              onClick={e => e.stopPropagation()}
                              className="flex-shrink-0 hover:opacity-70 transition-opacity">
                              <SpotifyIcon className="w-3 h-3" />
                            </a>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs tabular-nums" style={{ color: SPOTIFY_GREEN }}>
                              {artist.count} {artist.count === 1 ? 'song' : 'songs'}
                            </span>
                            <span className="text-muted-foreground text-[10px] w-3 text-center">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border/40 bg-background/50">
                            <div
                              className="grid px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-muted/30 border-b border-border/30"
                              style={{ gridTemplateColumns: 'minmax(0, 1fr) 108px', color: TEAL }}
                            >
                              <span>Album</span>
                              <span className="text-right">Liked on</span>
                            </div>
                            <ArtistSongList
                              albums={artist.albums}
                              hasAlbumData={artist.hasAlbumData}
                              focusYear={spotifyReleaseFocus?.artistId === artist.spotifyId
                                ? spotifyReleaseFocus.releaseYear
                                : null}
                            />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ── GP-118: Discogs tab — expandable collection list ── */}
          {viewMode === 'discogs' && hasDiscogs && (
            <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <DiscogsIcon className="w-4 h-4 text-foreground/60" />
                  <h2 className="text-sm font-semibold text-foreground">
                    Your Collection
                  </h2>
                </div>
                <span className="text-xs text-muted-foreground">{filteredDiscogsArtists.length} artists</span>
              </div>
              {discogsLoading && discogsReleases.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                  <div className="w-4 h-4 border-2 border-muted-foreground/40 border-t-primary rounded-full animate-spin" />
                  Loading your Discogs collection…
                </div>
              ) : filteredDiscogsArtists.length === 0 ? (
                <p className="text-sm text-muted-foreground px-4 py-6">No collection data.</p>
              ) : (
                <div className="divide-y divide-border">
                  {filteredDiscogsArtists.map((artist, i) => {
                    const isExpanded = expandedDiscogsArtists.has(artist.name)
                    const toggleExpanded = () => setExpandedDiscogsArtists(prev => {
                      const n = new Set(prev)
                      n.has(artist.name) ? n.delete(artist.name) : n.add(artist.name)
                      return n
                    })
                    return (
                      <div key={artist.name}>
                        <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors cursor-pointer"
                          onClick={toggleExpanded}>
                          <span className="text-xs font-bold tabular-nums w-6 text-right flex-shrink-0" style={{ color: DISCOGS_COLOR }}>
                            #{i + 1}
                          </span>
                          <div className="flex-1 min-w-0 flex items-center gap-1.5">
                            <span className="text-sm text-foreground truncate">{artist.name}</span>
                            {artist.discogsArtistId && (
                              <a href={`https://www.discogs.com/artist/${artist.discogsArtistId}`}
                                target="_blank" rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                className="flex-shrink-0 text-foreground/50 hover:opacity-70 transition-opacity">
                                <DiscogsIcon className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className="text-xs tabular-nums" style={{ color: DISCOGS_COLOR }}>
                              {artist.total} {artist.total === 1 ? 'record' : 'records'}
                            </span>
                            <span className="text-muted-foreground text-[10px] w-3 text-center">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border/40 bg-background/50">
                            <div className="max-h-48 overflow-y-auto divide-y divide-border/10">
                              <div className="grid sticky top-0 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider bg-muted/60 border-b border-border/30 z-10"
                                style={{ gridTemplateColumns: 'minmax(0, 1fr) 52px 60px', color: TEAL }}>
                                <span className="pl-2">Title</span><span>Year</span><span>Format</span>
                              </div>
                              {artist.releases.sort((a, b) => (b.year ?? 0) - (a.year ?? 0)).map((rel, j) => (
                                <div key={j} className="grid items-center px-4 py-2 hover:bg-muted/20 transition-colors"
                                  style={{ gridTemplateColumns: 'minmax(0, 1fr) 52px 60px' }}>
                                  <div className="min-w-0 pl-2 pr-3">
                                    <a href={`https://www.discogs.com/release/${rel.releaseId}`}
                                      target="_blank" rel="noopener noreferrer"
                                      className="text-xs text-foreground/80 hover:text-primary hover:underline truncate block transition-colors">
                                      {rel.title}
                                    </a>
                                  </div>
                                  <span className="text-xs text-foreground/50 tabular-nums">{rel.year ?? '—'}</span>
                                  <span className="text-xs tabular-nums" style={{ color: DISCOGS_FMT_META[rel.fmt].color }}>
                                    {DISCOGS_FMT_META[rel.fmt].label}
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

          {/* ── Show list — hidden in Spotify and Discogs modes ── */}
          {viewMode !== 'spotify' && viewMode !== 'discogs' && (
          <>
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
                  ) : (
                    <>
                      <div className="hidden md:flex items-center gap-3 px-4 py-2.5 bg-muted border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {!readOnly && <div className="flex-shrink-0 w-5" />}
                        <div className="w-10 flex-shrink-0" />
                        <div className="w-24 flex-shrink-0">Date</div>
                        <div className="flex-1 min-w-0">Artist / Venue</div>
                        <div className="w-32 flex-shrink-0">City</div>
                        <div className="w-40 flex-shrink-0">Tour / Festival</div>
                      </div>
                      {billGroups.map((group, idx) => {
                    const supporters = group.shows.slice(1)
                    const future = isFuture(group.date)
                    const isExpanded = expandedBills.has(group.key)
                    const canExpand = group.shows.length > 1
                    const toggleExpand = () => setExpandedBills(prev => {
                      const n = new Set(prev); n.has(group.key) ? n.delete(group.key) : n.add(group.key); return n
                    })
                    return (
                      <div key={group.key} className="">
                        <div
                          className={`group/row flex items-center gap-3 px-4 py-3 transition-colors ${canExpand ? 'cursor-pointer hover:bg-muted/30' : ''}`}
                          onClick={canExpand ? toggleExpand : undefined}
                        >
                          {!readOnly && (
                            <div className="flex-shrink-0" onClick={e => { e.stopPropagation(); removeShow(group.headliner.show_id) }}>
                              <button disabled={removingSet.has(group.headliner.show_id)} className="focus:outline-none disabled:opacity-50">
                                {removingSet.has(group.headliner.show_id)
                                  ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" />
                                  : <HeartIcon size={5} />}
                              </button>
                            </div>
                          )}
                          <div className="w-10 flex-shrink-0 text-right">
                            <span className="text-sm font-bold tabular-nums" style={{ color: TEAL }}>#{idx + 1}</span>
                            {canExpand && <span className="text-[10px] text-muted-foreground ml-0.5">{isExpanded ? '▴' : '▾'}</span>}
                          </div>
                          <div className="w-24 flex-shrink-0">
                            <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(group.date)}</p>
                            {future && <span style={{ backgroundColor: 'rgba(0,191,168,0.15)', color: '#00BFA8' }} className="text-[9px] font-semibold px-1.5 py-px rounded">upcoming</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <button
                                onClick={e => { e.stopPropagation(); applyFilter(group.headliner.artist.artist_name) }}
                                className="text-sm font-medium text-primary hover:opacity-80 hover:underline text-left">
                                {group.headliner.artist.artist_name}
                              </button>
                              {group.headliner.artist.spotify_artist_id && (
                                <span onClick={e => e.stopPropagation()}>
                                  <SpotifyLink artistId={group.headliner.artist.spotify_artist_id} />
                                </span>
                              )}
                              {group.headliner.artist.kexp_url && (
                                <span onClick={e => e.stopPropagation()}>
                                  <KexpLink url={group.headliner.artist.kexp_url} sessionCount={group.headliner.artist.kexp_session_count} />
                                </span>
                              )}
                              {group.headliner.artist.tiny_desk_url && (
                                <span onClick={e => e.stopPropagation()}>
                                  <TinyDeskLink url={group.headliner.artist.tiny_desk_url} sessionCount={group.headliner.artist.tiny_desk_session_count} />
                                </span>
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
                                      <button
                                        onClick={e => { e.stopPropagation(); applyFilter(s.artist.artist_name) }}
                                        className="hover:text-primary hover:underline transition-colors">
                                        {s.artist.artist_name}
                                      </button>
                                    </span>
                                  ))}
                                  {supporters.length > 3 && <span className="text-[11px] text-muted-foreground/50">+{supporters.length - 3}</span>}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <button onClick={e => { e.stopPropagation(); applyFilter(group.venue_name) }} className="text-[13px] text-muted-foreground hover:text-primary hover:underline transition-colors">{group.venue_name}</button>
                              <CapacityBadge category={group.capacity_category} />
                              {group.headliner.venue.tm_url && <span onClick={e => e.stopPropagation()}><TmVenueLink url={group.headliner.venue.tm_url} /></span>}
                            </div>
                          </div>
                          {/* City column — desktop only */}
                          <div className="w-32 flex-shrink-0 hidden md:block" onClick={e => e.stopPropagation()}>
                            {group.headliner.city && group.headliner.venue_state
                              ? <span className="text-sm text-muted-foreground">{group.headliner.city}, {group.headliner.venue_state}</span>
                              : <span className="text-muted-foreground/40 text-sm">—</span>}
                          </div>
                          {/* Tour / Festival column — desktop only */}
                          <div className="w-40 flex-shrink-0 hidden md:block" onClick={e => e.stopPropagation()}>
                            {group.headliner.tour_name
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={group.headliner.tour_name}>{group.headliner.tour_name}</span>
                              : group.festival_name
                              ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={group.festival_name}>{group.festival_name}</span>
                              : null}
                          </div>
                        </div>

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
                                    <button
                                      onClick={e => { e.stopPropagation(); applyFilter(show.artist.artist_name) }}
                                      className="text-sm font-medium text-primary hover:opacity-80 hover:underline text-left">
                                      {show.artist.artist_name}
                                    </button>
                                    {show.artist.spotify_artist_id && (
                                      <span onClick={e => e.stopPropagation()}><SpotifyLink artistId={show.artist.spotify_artist_id} /></span>
                                    )}
                                    {show.artist.kexp_url && (
                                      <span onClick={e => e.stopPropagation()}><KexpLink url={show.artist.kexp_url} sessionCount={show.artist.kexp_session_count} /></span>
                                    )}
                                    {show.artist.tiny_desk_url && (
                                      <span onClick={e => e.stopPropagation()}><TinyDeskLink url={show.artist.tiny_desk_url} sessionCount={show.artist.tiny_desk_session_count} /></span>
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
                    </>
                  )}
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
                                  <button
                                    onClick={() => applyFilter(show.artist.artist_name)}
                                    className="text-xs text-foreground hover:text-primary hover:underline transition-colors">
                                    {show.artist.artist_name}
                                  </button>
                                  {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                  {show.artist.kexp_url && <KexpLink url={show.artist.kexp_url} sessionCount={show.artist.kexp_session_count} />}
                                  {show.artist.tiny_desk_url && <TinyDeskLink url={show.artist.tiny_desk_url} sessionCount={show.artist.tiny_desk_session_count} />}
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
                        style={{ gridTemplateColumns: readOnly ? '120px 1fr 130px minmax(80px,1fr)' : '40px 120px 1fr 130px minmax(80px,1fr)' }}>
                        {!readOnly && <div className="px-3 py-3" />}
                        <button className="px-3 py-3 text-left hover:text-foreground" onClick={() => handleSort('date')}>Date{sortArrow('date')}</button>
                        <div className="px-3 py-3 flex gap-3">
                          <button className="hover:text-foreground" onClick={() => handleSort('artist')}>Artist{sortArrow('artist')}</button>
                          <span className="text-muted-foreground/30">/</span>
                          <button className="hover:text-foreground" onClick={() => handleSort('venue')}>Venue{sortArrow('venue')}</button>
                        </div>
                        <div className="px-3 py-3">City</div>
                        <div className="px-3 py-3">Tour / Festival</div>
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
                            <div key={show.show_id} className={`hover:bg-muted/30 transition-colors`}>
                              <div className="hidden md:grid items-center"
                                style={{ gridTemplateColumns: readOnly ? '120px 1fr 130px minmax(80px,1fr)' : '40px 120px 1fr 130px minmax(80px,1fr)' }}>
                                {!readOnly && (
                                  <div className="px-3 py-3.5 flex items-center">
                                    <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                      {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                    </button>
                                  </div>
                                )}
                                <div className="px-3 py-3.5">
                                  <p className="text-sm text-foreground whitespace-nowrap">{fmtDate(show.date)}</p>
                                  {future && <span style={{ backgroundColor: 'rgba(0,191,168,0.15)', color: '#00BFA8' }} className="text-[9px] font-semibold px-1.5 py-px rounded">upcoming</span>}
                                </div>
                                <div className="px-3 py-3.5 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                    <button onClick={() => applyFilter(show.artist.artist_name)} className="text-sm font-medium text-primary hover:opacity-80 hover:underline">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.artist.kexp_url && <KexpLink url={show.artist.kexp_url} sessionCount={show.artist.kexp_session_count} />}
                                    {show.artist.tiny_desk_url && <TinyDeskLink url={show.artist.tiny_desk_url} sessionCount={show.artist.tiny_desk_session_count} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => applyFilter(show.venue.venue_name)} className="text-[13px] text-muted-foreground hover:text-primary hover:underline">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                    {show.venue.tm_url && <TmVenueLink url={show.venue.tm_url} />}
                                  </div>
                                </div>
                                <div className="px-3 py-3.5">
                                  {show.city && show.venue_state
                                    ? <span className="text-sm text-muted-foreground">{show.city}, {show.venue_state}</span>
                                    : <span className="text-muted-foreground/40">—</span>}
                                </div>
                                <div className="px-3 py-3.5">
                                  {show.tour_name
                                    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={show.tour_name}>{show.tour_name}</span>
                                    : show.festival_name
                                    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={show.festival_name}>{show.festival_name}</span>
                                    : null}
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
                                  {future && <span style={{ backgroundColor: 'rgba(0,191,168,0.15)', color: '#00BFA8' }} className="text-[9px] font-semibold px-1.5 py-px rounded">upcoming</span>}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 mb-0.5 flex-wrap">
                                    <button onClick={() => applyFilter(show.artist.artist_name)} className="text-[11px] font-medium text-primary hover:opacity-80 truncate">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.artist.kexp_url && <KexpLink url={show.artist.kexp_url} sessionCount={show.artist.kexp_session_count} />}
                                    {show.artist.tiny_desk_url && <TinyDeskLink url={show.artist.tiny_desk_url} sessionCount={show.artist.tiny_desk_session_count} />}
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <button onClick={() => applyFilter(show.venue.venue_name)} className="text-[10px] text-muted-foreground hover:text-primary truncate">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                    {show.venue.tm_url && <TmVenueLink url={show.venue.tm_url} />}
                                  </div>
                                  {show.city && show.venue_state && (
                                    <p className="text-[9px] text-muted-foreground/60 leading-tight mt-0.5">{show.city}, {show.venue_state}</p>
                                  )}
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
                            <th className="px-3 py-3 text-left">City</th>
                            <th className="px-3 py-3 text-left">Tour / Festival</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {setsFiltered.length === 0 ? (
                            <tr><td colSpan={readOnly ? 5 : 6} className="text-center py-10 text-muted-foreground">No shows match this filter.</td></tr>
                          ) : currentShows.map(show => {
                            const removing = removingSet.has(show.show_id)
                            const future   = isFuture(show.date)
                            return (
                              <tr key={show.show_id} className={`hover:bg-muted/30 transition-colors`}>
                                {!readOnly && (
                                  <td className="px-3 py-3">
                                    <button onClick={() => removeShow(show.show_id)} disabled={removing} className="focus:outline-none disabled:opacity-50">
                                      {removing ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin" /> : <HeartIcon size={5} />}
                                    </button>
                                  </td>
                                )}
                                <td className="px-3 py-3 whitespace-nowrap text-foreground">
                                  {fmtDate(show.date)}
                                  {future && <span style={{ backgroundColor: 'rgba(0,191,168,0.15)', color: '#00BFA8' }} className="ml-1.5 text-[9px] font-semibold px-1.5 py-px rounded">upcoming</span>}
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => applyFilter(show.artist.artist_name)} className="text-primary hover:opacity-80 hover:underline text-left">{show.artist.artist_name}</button>
                                    {show.artist.spotify_artist_id && <SpotifyLink artistId={show.artist.spotify_artist_id} />}
                                    {show.artist.kexp_url && <KexpLink url={show.artist.kexp_url} sessionCount={show.artist.kexp_session_count} />}
                                    {show.artist.tiny_desk_url && <TinyDeskLink url={show.artist.tiny_desk_url} sessionCount={show.artist.tiny_desk_session_count} />}
                                    {show.setlist_url && <SetlistLink url={show.setlist_url} />}
                                  </div>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <button onClick={() => applyFilter(show.venue.venue_name)} className="text-muted-foreground hover:text-primary hover:underline text-left">{show.venue.venue_name}</button>
                                    <CapacityBadge category={show.venue.capacity_category} />
                                    {show.venue.tm_url && <TmVenueLink url={show.venue.tm_url} />}
                                  </div>
                                </td>
                                <td className="px-3 py-3 text-sm text-muted-foreground whitespace-nowrap">
                                  {show.city && show.venue_state ? `${show.city}, ${show.venue_state}` : <span className="text-muted-foreground/40">—</span>}
                                </td>
                                <td className="px-3 py-3">
                                  {show.tour_name
                                    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={show.tour_name}>{show.tour_name}</span>
                                    : show.festival_name
                                    ? <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium truncate cursor-default" style={{ backgroundColor: 'rgba(13,148,136,0.12)', color: '#0d9488', border: '1px solid rgba(13,148,136,0.25)' }} title={show.festival_name}>{show.festival_name}</span>
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
          </>
          )}

        </div>
      </main>
    </>
  )
}
