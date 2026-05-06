'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

// ─── Types ────────────────────────────────────────────────────────────────────
type Artist = {
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string;
  spotify_song_count: number;
  vancouver_show_count: number;
  vancouver_show_count_all: number;
  match_score: number;
  match_score_all: number;
};

type Venue = {
  venue_id: number;
  venue_name: string;
  capacity: number | null;
  capacity_category: string | null;
  total_shows: number;
  unique_artists: number;
  match_score: number;
  user_status: 'yes' | 'no' | 'not_sure' | null;
};

type MatchData = {
  first_concert_year: number;
  upper_bound_date: string;
  matched_artists_count: number;
  total_spotify_artists: number;
  total_shows_count: number;
  total_venues_matched: number;
  top_artists: Artist[];
  all_artists: Artist[];
  all_venues: Venue[];
  duration_seconds: number;
};

type CapacityFilter  = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';
type ArtistView     = 'current' | 'all';
type ArtistDisplay  = 'chart' | 'table';
type VenueStatus    = 'yes' | 'no' | 'not_sure';
type MobileTab      = 'unreviewed' | 'all';

const VENUES_PER_PAGE  = 10;
const ARTISTS_PER_PAGE = 10;
const SWIPE_THRESHOLD  = 72;
const SWIPE_MAX        = 110;

// ─── Capacity helpers ─────────────────────────────────────────────────────────
const CAPACITY_BUTTONS: {
  key: CapacityFilter; label: string; tooltip: string;
  textColor: string; badgeBg: string; badgeText: string;
}[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        textColor: 'text-gray-500',                        badgeBg: 'bg-gray-100 dark:bg-gray-800',        badgeText: 'text-gray-600 dark:text-gray-400'    },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     textColor: 'text-purple-400 dark:text-purple-300', badgeBg: 'bg-purple-100 dark:bg-purple-900/30', badgeText: 'text-purple-700 dark:text-purple-300' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', textColor: 'text-[#3A8FBD]',                       badgeBg: 'bg-blue-100 dark:bg-blue-900/30',     badgeText: 'text-[#3A8FBD]'                      },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  textColor: 'text-orange-600 dark:text-orange-400', badgeBg: 'bg-orange-100 dark:bg-orange-900/30', badgeText: 'text-orange-700 dark:text-orange-400' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    textColor: 'text-rose-600 dark:text-rose-400',     badgeBg: 'bg-rose-100 dark:bg-rose-900/30',     badgeText: 'text-rose-700 dark:text-rose-400'    },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  textColor: 'text-gray-400 dark:text-gray-500',     badgeBg: 'bg-gray-100 dark:bg-gray-800',        badgeText: 'text-gray-500'                       },
];

function capacityFilterKey(category: string | null): CapacityFilter {
  if (!category) return 'unknown';
  const c = category.toLowerCase();
  if (c.includes('small'))   return 'small';
  if (c.includes('medium'))  return 'medium';
  if (c.includes('x-large') || c.includes('10k')) return 'xlarge';
  if (c.includes('large'))   return 'large';
  return 'unknown';
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function CapacityBadge({ category, capacity }: { category: string | null; capacity: number | null }) {
  const key = capacityFilterKey(category);
  const btn = CAPACITY_BUTTONS.find(b => b.key === key)!;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${btn.badgeBg} ${btn.badgeText}`}>
      {btn.label}{capacity ? ` · ${capacity.toLocaleString()}` : ''}
    </span>
  );
}

function ScoreBar({ score, compact = false }: { score: number; compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      <div className={`bg-muted rounded-full h-1.5 flex-shrink-0 ${compact ? 'w-10' : 'w-24'}`}>
        <div className="bg-primary h-1.5 rounded-full transition-all" style={{ width: `${Math.min(score, 100)}%` }} />
      </div>
      <span className={`font-semibold text-primary tabular-nums text-right flex-shrink-0 ${compact ? 'text-xs w-10' : 'text-sm w-12'}`}>
        {score.toFixed(1)}%
      </span>
    </div>
  );
}

function SpotifyIcon({ artistId }: { artistId: string }) {
  return (
    <a href={`https://open.spotify.com/artist/${artistId}`} target="_blank" rel="noopener noreferrer"
      title="Open in Spotify" onClick={e => e.stopPropagation()}
      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center flex-shrink-0">
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    </a>
  );
}

// ─── Swipeable venue card (mobile Unreviewed tab) ─────────────────────────────
function SwipeableVenueCard({
  venue, rank, onYes, onNo, onMaybe,
}: {
  venue: Venue; rank: number;
  onYes: () => void; onNo: () => void; onMaybe: () => void;
}) {
  const [offset, setOffset]       = useState(0);
  const [animating, setAnimating] = useState(false);
  const touchStartX  = useRef<number | null>(null);
  const touchStartY  = useRef<number | null>(null);
  const axisLocked   = useRef<'h' | 'v' | null>(null);

  const progress = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1);
  const swipeDir = offset > 4 ? 'right' : offset < -4 ? 'left' : null;

  const bgColor = swipeDir === 'right'
    ? `rgba(34,197,94,${progress * 0.25})`
    : swipeDir === 'left'
    ? `rgba(239,68,68,${progress * 0.25})`
    : undefined;

  const springBack = () => {
    setAnimating(true); setOffset(0);
    setTimeout(() => setAnimating(false), 280);
  };

  const commit = (dir: 'right' | 'left') => {
    setAnimating(true);
    setOffset(dir === 'right' ? SWIPE_MAX : -SWIPE_MAX);
    setTimeout(() => { dir === 'right' ? onYes() : onNo(); }, 220);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    axisLocked.current  = null;
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!axisLocked.current) {
      if (Math.abs(dx) > Math.abs(dy) + 4) axisLocked.current = 'h';
      else if (Math.abs(dy) > Math.abs(dx) + 4) axisLocked.current = 'v';
      else return;
    }
    if (axisLocked.current === 'v') return;
    e.preventDefault();
    setOffset(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
  };

  const onTouchEnd = () => {
    if (axisLocked.current !== 'h') {
      touchStartX.current = null; touchStartY.current = null; return;
    }
    if (offset >= SWIPE_THRESHOLD) commit('right');
    else if (offset <= -SWIPE_THRESHOLD) commit('left');
    else springBack();
    touchStartX.current = null; touchStartY.current = null; axisLocked.current = null;
  };

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-border select-none"
      style={{ backgroundColor: bgColor }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      {/* Ghost icons */}
      {swipeDir === 'right' && (
        <div className="absolute left-3 top-0 bottom-0 flex items-center pointer-events-none" style={{ opacity: progress }}>
          <svg className="w-5 h-5 fill-green-500 text-green-500" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
      )}
      {swipeDir === 'left' && (
        <div className="absolute right-3 top-0 bottom-0 flex items-center pointer-events-none" style={{ opacity: progress }}>
          <svg className="w-5 h-5 text-destructive" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
      )}

      {/* Sliding content */}
      <div
        className="p-3 bg-card"
        style={{ transform: `translateX(${offset}px)`, transition: animating ? 'transform 0.25s ease' : 'none' }}
      >
        <div className="flex items-start gap-2 mb-2">
          <span className="text-sm font-bold text-primary flex-shrink-0 w-7 pt-0.5">#{rank}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-1.5 flex-wrap">
              <h3 className="text-sm font-semibold text-card-foreground leading-snug">{venue.venue_name}</h3>
              <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {venue.total_shows} shows · {venue.unique_artists} artists
            </p>
          </div>
          <div className="flex-shrink-0 w-[84px]">
            <ScoreBar score={venue.match_score} compact />
          </div>
        </div>

        {/* Maybe button + swipe hint */}
        <div className="flex items-center gap-2">
          <button
            onClick={onMaybe}
            className="flex-1 py-1.5 rounded-lg text-xs font-medium border bg-card border-border text-muted-foreground"
          >
            ? Maybe
          </button>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60 pr-1">
            <span>← No</span>
            <span>Yes →</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Desktop venue row ────────────────────────────────────────────────────────
function DesktopVenueRow({
  venue, rank, currentStatus, onStatus,
}: {
  venue: Venue; rank: number;
  currentStatus: VenueStatus | null;
  onStatus: (s: VenueStatus) => void;
}) {
  return (
    <div className={`hidden md:flex md:items-center md:gap-4 border rounded-lg px-4 py-3 transition-colors ${
      currentStatus === 'yes'       ? 'border-green-500/40 bg-green-500/5'
      : currentStatus === 'no'     ? 'border-destructive/30 bg-destructive/5'
      : currentStatus === 'not_sure' ? 'border-border bg-muted/20'
      : 'border-border hover:bg-muted/20'
    }`}>
      {/* Rank */}
      <span className="text-xl font-bold text-primary flex-shrink-0 w-9 text-center">#{rank}</span>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-card-foreground">{venue.venue_name}</h3>
          <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {venue.total_shows} shows · {venue.unique_artists} artists
        </p>
      </div>

      {/* Buttons — between name and score */}
      <div className="flex gap-1.5 flex-shrink-0">
        {(['yes', 'not_sure', 'no'] as VenueStatus[]).map(s => (
          <button
            key={s}
            onClick={() => onStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
              currentStatus === s
                ? s === 'yes'       ? 'bg-green-600 text-white border-green-600'
                : s === 'no'        ? 'bg-destructive text-white border-destructive'
                :                     'bg-muted border-foreground/30 text-foreground'
                : 'bg-card border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            {s === 'yes' ? '✓ Yes' : s === 'not_sure' ? '? Maybe' : '✗ No'}
          </button>
        ))}
      </div>

      {/* Score — right edge, fixed width */}
      <div className="flex-shrink-0 w-36">
        <ScoreBar score={venue.match_score} />
      </div>
    </div>
  );
}

// ─── Mobile All-Venues card (tap buttons, no swipe) ───────────────────────────
function MobileVenueCard({
  venue, rank, currentStatus, onStatus,
}: {
  venue: Venue; rank: number;
  currentStatus: VenueStatus | null;
  onStatus: (s: VenueStatus) => void;
}) {
  return (
    <div className={`md:hidden border rounded-lg p-3 transition-colors ${
      currentStatus === 'yes'        ? 'border-green-500/40 bg-green-500/5'
      : currentStatus === 'no'       ? 'border-destructive/30 bg-destructive/5'
      : currentStatus === 'not_sure' ? 'border-border bg-muted/20'
      : 'border-border'
    }`}>
      <div className="flex items-start gap-2 mb-2">
        <span className="text-sm font-bold text-primary flex-shrink-0 w-7 pt-0.5">#{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-card-foreground leading-snug">{venue.venue_name}</h3>
            <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {venue.total_shows} shows · {venue.unique_artists} artists
          </p>
        </div>
        <div className="flex-shrink-0 w-[84px]">
          <ScoreBar score={venue.match_score} compact />
        </div>
      </div>
      <div className="flex gap-1.5">
        {(['yes', 'not_sure', 'no'] as VenueStatus[]).map(s => (
          <button
            key={s}
            onClick={() => onStatus(s)}
            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              currentStatus === s
                ? s === 'yes'       ? 'bg-green-600 text-white border-green-600'
                : s === 'no'        ? 'bg-destructive text-white border-destructive'
                :                     'bg-muted border-foreground/30 text-foreground'
                : 'bg-card border-border text-muted-foreground'
            }`}
          >
            {s === 'yes' ? '✓ Yes' : s === 'not_sure' ? '? Maybe' : '✗ No'}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Bubble chart ─────────────────────────────────────────────────────────────
// Teal hardcoded so SVG doesn't need to inherit CSS vars (avoids black bubble bug)
const BUBBLE_FILL   = '#0d9488'; // teal-600
const BUBBLE_STROKE = '#14b8a6'; // teal-500
const LABEL_COLOR   = '#99f6e4'; // teal-200

function ArtistBubbleChart({ artists, artistView }: { artists: Artist[]; artistView: ArtistView }) {
  const [tooltip, setTooltip] = useState<{ artist: Artist; x: number; y: number } | null>(null);
  const svgRef   = useRef<SVGSVGElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);

  const top15 = artists.slice(0, 15);
  if (top15.length === 0) return <p className="text-muted-foreground text-center py-12">No artists to display</p>;

  // Chart dimensions — extra top padding for labels above bubbles
  const W = 580; const H = 380;
  const PAD = { top: 40, right: 24, bottom: 48, left: 52 };
  const CW = W - PAD.left - PAD.right;
  const CH = H - PAD.top - PAD.bottom;

  const shows = (a: Artist) => artistView === 'current' ? a.vancouver_show_count : a.vancouver_show_count_all;
  const score = (a: Artist) => artistView === 'current' ? a.match_score : a.match_score_all;

  const maxShows = Math.max(...top15.map(shows), 1);
  const maxSongs = Math.max(...top15.map(a => a.spotify_song_count), 1);
  const maxScore = Math.max(...top15.map(score), 1);

  const bx = (a: Artist) => PAD.left + (shows(a) / maxShows) * CW;
  const by = (a: Artist) => PAD.top + (1 - a.spotify_song_count / maxSongs) * CH;
  const br = (a: Artist) => 7 + (score(a) / maxScore) * 13;

  const xTicks = Array.from({ length: Math.min(maxShows + 1, 7) }, (_, i) =>
    Math.round((i / Math.min(maxShows, 6)) * maxShows)
  );
  const yTicks = [0, Math.round(maxSongs * 0.25), Math.round(maxSongs * 0.5), Math.round(maxSongs * 0.75), maxSongs];

  const handleInteract = (e: React.MouseEvent | React.TouchEvent, artist: Artist) => {
    const svg  = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const svgRect  = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = svgRect.width / W;
    const scaleY = svgRect.height / H;
    // Position tooltip relative to wrapper div (which is position:relative)
    const x = bx(artist) * scaleX + (svgRect.left - wrapRect.left);
    const y = by(artist) * scaleY + (svgRect.top  - wrapRect.top);
    setTooltip({ artist, x, y });
  };

  const truncate = (name: string, max = 13) =>
    name.length > max ? name.slice(0, max - 1) + '…' : name;

  return (
    <div className="relative w-full" ref={wrapRef}>
      {/* X axis label */}
      <div className="text-[10px] text-muted-foreground text-center mb-1">YVR Shows →</div>
      <div className="flex gap-0">
        {/* Y axis label */}
        <div className="flex items-center justify-center flex-shrink-0" style={{ width: 14 }}>
          <span className="text-[10px] text-muted-foreground whitespace-nowrap"
            style={{ transform: 'rotate(-90deg)', display: 'block', transformOrigin: 'center' }}>
            ← Your Songs
          </span>
        </div>

        {/* SVG chart */}
        <div className="relative flex-1">
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
            {/* Grid */}
            {yTicks.map(t => {
              const y = PAD.top + (1 - t / maxSongs) * CH;
              return (
                <g key={`y${t}`}>
                  <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y}
                    stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
                  <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={9}
                    fill="rgba(255,255,255,0.35)">{t}</text>
                </g>
              );
            })}
            {xTicks.map(t => {
              const x = PAD.left + (t / maxShows) * CW;
              return (
                <g key={`x${t}`}>
                  <line x1={x} y1={PAD.top} x2={x} y2={H - PAD.bottom}
                    stroke="rgba(255,255,255,0.07)" strokeWidth={1} />
                  <text x={x} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={9}
                    fill="rgba(255,255,255,0.35)">{t}</text>
                </g>
              );
            })}

            {/* Bubbles — render in reverse so top-ranked sit on top */}
            {[...top15].reverse().map((artist) => {
              const x = bx(artist); const y = by(artist); const r = br(artist);
              const label = truncate(artist.artist_name);
              // Place label above bubble, but flip below if too close to top
              const labelY = y - r - 5 < PAD.top + 8 ? y + r + 12 : y - r - 5;
              return (
                <g key={artist.artist_id}
                  onMouseEnter={e => handleInteract(e, artist)}
                  onMouseLeave={() => setTooltip(null)}
                  onTouchStart={e => { e.preventDefault(); handleInteract(e, artist); }}
                  onTouchEnd={() => setTooltip(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Expanded hit area */}
                  <circle cx={x} cy={y} r={r + 8} fill="transparent" />
                  {/* Glow ring */}
                  <circle cx={x} cy={y} r={r + 3} fill={BUBBLE_FILL} fillOpacity={0.12} />
                  {/* Main bubble */}
                  <circle cx={x} cy={y} r={r}
                    fill={BUBBLE_FILL} fillOpacity={0.45}
                    stroke={BUBBLE_STROKE} strokeWidth={1.5}
                  />
                  {/* Label — always shown, small */}
                  <text x={x} y={labelY} textAnchor="middle" fontSize={8}
                    fill={LABEL_COLOR} fillOpacity={0.85}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Tooltip — positioned relative to wrapper */}
          {tooltip && (() => {
            const wrapWidth = wrapRef.current?.getBoundingClientRect().width ?? 400;
            const tipW = 160;
            const left = Math.min(Math.max(tooltip.x + 14, 4), wrapWidth - tipW - 4);
            const top  = Math.max(tooltip.y - 80, 4);
            return (
              <div className="absolute z-20 pointer-events-none bg-card border border-border rounded-lg shadow-xl px-3 py-2 text-xs"
                style={{ left, top, width: tipW }}>
                <p className="font-semibold text-card-foreground mb-1.5 leading-tight">
                  {tooltip.artist.artist_name}
                </p>
                <div className="space-y-1 text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 24 24" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    <span>{tooltip.artist.spotify_song_count} songs in library</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]">📍</span>
                    <span>{shows(tooltip.artist)} Vancouver shows</span>
                  </div>
                  <p className="text-primary font-semibold pt-0.5">
                    {score(tooltip.artist).toFixed(1)}% match
                  </p>
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <svg width="30" height="14" viewBox="0 0 30 14">
            <circle cx="6" cy="7" r="4" fill={BUBBLE_FILL} fillOpacity={0.45} stroke={BUBBLE_STROKE} strokeWidth={1.5}/>
            <circle cx="22" cy="7" r="6" fill={BUBBLE_FILL} fillOpacity={0.45} stroke={BUBBLE_STROKE} strokeWidth={1.5}/>
          </svg>
          Bubble size = match score
        </div>
        <span className="text-muted-foreground/40">·</span>
        <span className="hidden sm:inline">Hover</span>
        <span className="sm:hidden">Tap</span>
        <span> a bubble for details</span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [matchData, setMatchData] = useState<MatchData | null>(null);

  // Venue state
  const [venueStatuses, setVenueStatuses] = useState<Map<number, VenueStatus>>(new Map());
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [mobileTab, setMobileTab]           = useState<MobileTab>('unreviewed');
  const [venuePage, setVenuePage]           = useState(1);

  // Artist state
  const [artistView, setArtistView]       = useState<ArtistView>('current');
  const [artistDisplay, setArtistDisplay] = useState<ArtistDisplay>('chart');
  const [artistPage, setArtistPage]       = useState(1);

  useEffect(() => { fetchMatches(); }, []);

  const fetchMatches = async () => {
    try {
      const res = await fetch('/api/match');
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const result = await res.json();
      const data = { ...result.data, all_venues: result.data.all_venues ?? result.data.top_venues ?? [] };
      setMatchData(data);
      const init = new Map<number, VenueStatus>();
      data.all_venues.forEach((v: Venue) => { if (v.user_status) init.set(v.venue_id, v.user_status as VenueStatus); });
      setVenueStatuses(init);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  };

  const handleVenueStatus = useCallback((venueId: number, status: VenueStatus) => {
    setVenueStatuses(prev => {
      const next = new Map(prev);
      if (next.get(venueId) === status) next.delete(venueId);
      else next.set(venueId, status);
      return next;
    });
  }, []);

  const handleSaveAndContinue = async () => {
    setSaving(true); setError('');
    try {
      const confirmations = Array.from(venueStatuses.entries()).map(([venue_id, status]) => ({ venue_id, status }));
      const res = await fetch('/api/venues/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmations }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      router.push('/likely-shows');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally { setSaving(false); }
  };

  // ── Derived ──────────────────────────────────────────────────────────────────
  const yesCount      = Array.from(venueStatuses.values()).filter(s => s === 'yes').length;
  const noCount       = Array.from(venueStatuses.values()).filter(s => s === 'no').length;
  const reviewedCount = venueStatuses.size;
  const totalVenues   = matchData?.all_venues.length ?? 0;
  const hasConfirmedSome = venueStatuses.size > 0;

  // Desktop: all venues filtered by capacity
  const desktopVenues = matchData && Array.isArray(matchData.all_venues)
    ? matchData.all_venues.filter(v =>
        capacityFilter === 'all' || capacityFilterKey(v.capacity_category) === capacityFilter
      )
    : [];
  const totalVenuePages = Math.max(1, Math.ceil(desktopVenues.length / VENUES_PER_PAGE));
  const safePage        = Math.min(venuePage, totalVenuePages);
  const pagedVenues     = desktopVenues.slice((safePage - 1) * VENUES_PER_PAGE, safePage * VENUES_PER_PAGE);

  // Mobile: unreviewed = no status set yet
  const unreviewedVenues = matchData?.all_venues.filter(v => !venueStatuses.has(v.venue_id)) ?? [];
  const top10Cleared     = unreviewedVenues.filter((_, i) => i < 10).length === 0;

  // Mobile All tab: paginated with capacity filter
  const mobileAllVenues = matchData && Array.isArray(matchData.all_venues)
    ? matchData.all_venues.filter(v =>
        capacityFilter === 'all' || capacityFilterKey(v.capacity_category) === capacityFilter
      )
    : [];
  const totalMobileAllPages = Math.max(1, Math.ceil(mobileAllVenues.length / VENUES_PER_PAGE));
  const safeMobileAllPage   = Math.min(venuePage, totalMobileAllPages);
  const pagedMobileAll      = mobileAllVenues.slice(
    (safeMobileAllPage - 1) * VENUES_PER_PAGE,
    safeMobileAllPage * VENUES_PER_PAGE,
  );

  // Artists
  const allDisplayArtists = matchData
    ? (artistView === 'current' ? matchData.top_artists : matchData.all_artists)
    : [];
  const totalArtistPages = Math.max(1, Math.ceil(allDisplayArtists.length / ARTISTS_PER_PAGE));
  const safeArtistPage   = Math.min(artistPage, totalArtistPages);
  const pagedArtists     = allDisplayArtists.slice(
    (safeArtistPage - 1) * ARTISTS_PER_PAGE, safeArtistPage * ARTISTS_PER_PAGE,
  );

  const dateRangeValue = matchData ? `${matchData.first_concert_year} – ${new Date().getFullYear()}` : '—';

  const setCapacityAndReset = (f: CapacityFilter) => { setCapacityFilter(f); setVenuePage(1); };

  // ── Loading / error ───────────────────────────────────────────────────────────
  if (loading) return (
    <>
      <Navigation />
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">Running matching algorithm...</p>
          <p className="text-muted-foreground text-sm mt-2">This may take a few seconds</p>
        </div>
      </div>
    </>
  );

  if (error && !matchData) return (
    <>
      <Navigation />
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-7xl mx-auto">
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
            <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Matches</h2>
            <p className="text-destructive/80">{error}</p>
            <button onClick={() => router.push('/discover')} className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg">Back to Discover</button>
          </div>
        </div>
      </div>
    </>
  );

  if (!matchData) return null;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-6 md:py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-1">Your Matched Artists & Venues</h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Based on your Spotify library and Vancouver show data from {matchData.first_concert_year} to {new Date().getFullYear()}
            </p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2 md:gap-4 mb-6 md:mb-8">
            {/* Spotify Artists card */}
            <div className="bg-card rounded-lg shadow p-3 md:p-4 border border-border">
              <div className="flex items-center gap-1.5 mb-0.5 md:mb-1">
                <p className="text-[10px] md:text-sm text-muted-foreground leading-tight">Matched Artists</p>
                <svg className="w-3 h-3 md:w-3.5 md:h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="#1DB954">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                </svg>
              </div>
              <p className="text-base md:text-2xl font-bold text-card-foreground">
                {matchData.matched_artists_count.toLocaleString()}
                {matchData.total_spotify_artists > 0 && (
                  <span className="text-sm md:text-base font-normal text-muted-foreground ml-1">
                    of {matchData.total_spotify_artists.toLocaleString()}
                  </span>
                )}
              </p>
            </div>
            {/* Venues reviewed card */}
            <div className="bg-card rounded-lg shadow p-3 md:p-4 border border-border">
              <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">Venues Reviewed</p>
              <p className="text-base md:text-2xl font-bold text-card-foreground">
                <span className="text-primary">{reviewedCount}</span>
                <span className="text-sm md:text-base font-normal text-muted-foreground ml-1">of {totalVenues}</span>
              </p>
            </div>
          </div>

          {/* ── Venues section ── */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6 mb-6 md:mb-8">

            {/* ── Header row (desktop + mobile share this) ── */}
            <div className="flex flex-col gap-2 mb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-card-foreground">Top Venues</h2>
                  <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                    These venues hosted the most shows by artists in your library — review more for better results.
                  </p>
                </div>
                {/* Desktop size filter — hidden on mobile (moved below) */}
                <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">Size:</span>
                  <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                    {CAPACITY_BUTTONS.map(btn => (
                      <button key={btn.key} onClick={() => setCapacityAndReset(btn.key)} title={btn.tooltip}
                        className={`px-2.5 py-1.5 transition-colors ${capacityFilter === btn.key ? 'bg-primary text-primary-foreground' : `bg-card ${btn.textColor} hover:bg-muted`}`}>
                        {btn.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Mobile controls row: size filter + Unreviewed/All toggle ── */}
              <div className="flex items-center justify-between gap-2 md:hidden">
                {/* Size filter */}
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                  {CAPACITY_BUTTONS.map(btn => (
                    <button key={btn.key} onClick={() => setCapacityAndReset(btn.key)} title={btn.tooltip}
                      className={`px-2 py-1.5 transition-colors ${capacityFilter === btn.key ? 'bg-primary text-primary-foreground' : `bg-card ${btn.textColor} hover:bg-muted`}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>

                {/* Unreviewed / All toggle */}
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                  <button
                    onClick={() => { setMobileTab('unreviewed'); setVenuePage(1); }}
                    className={`px-3 py-1.5 transition-colors ${mobileTab === 'unreviewed' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}
                  >
                    Unreviewed
                  </button>
                  <button
                    onClick={() => { setMobileTab('all'); setVenuePage(1); }}
                    className={`px-3 py-1.5 transition-colors ${mobileTab === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}`}
                  >
                    All Venues
                  </button>
                </div>
              </div>
            </div>

            {/* Review status pills — desktop only */}
            <div className="hidden md:flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{reviewedCount}</span> of {totalVenues} reviewed
              </span>
              <span className="text-border select-none">·</span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/30`}>
                ✓ {yesCount} attended
              </span>
              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-destructive/10 text-destructive border-destructive/30`}>
                ✗ {noCount} never been
              </span>
            </div>

            {/* ── DESKTOP venue list ── */}
            <div className="hidden md:block space-y-2">
              {desktopVenues.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No venues match this filter</p>
              ) : (
                pagedVenues.map(venue => {
                  const globalRank = desktopVenues.indexOf(venue) + 1;
                  return (
                    <DesktopVenueRow
                      key={venue.venue_id}
                      venue={venue}
                      rank={globalRank}
                      currentStatus={venueStatuses.get(venue.venue_id) ?? null}
                      onStatus={s => handleVenueStatus(venue.venue_id, s)}
                    />
                  );
                })
              )}
            </div>

            {/* Desktop pagination */}
            <div className="hidden md:flex items-center justify-between mt-4 pt-4 border-t border-border">
              <button onClick={() => setVenuePage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                ← Previous
              </button>
              <span className="text-xs md:text-sm text-muted-foreground">
                Page {safePage} of {totalVenuePages}
                <span className="text-muted-foreground/60 ml-1">· {desktopVenues.length} venues</span>
              </span>
              <button onClick={() => setVenuePage(p => Math.min(totalVenuePages, p + 1))} disabled={safePage === totalVenuePages}
                className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                Next →
              </button>
            </div>

            {/* ── MOBILE: Unreviewed tab ── */}
            <div className={`md:hidden ${mobileTab !== 'unreviewed' ? 'hidden' : ''}`}>
              {/* Progress */}
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <span><span className="font-medium text-foreground">{reviewedCount}</span> of {totalVenues} reviewed</span>
                <span className="text-border">·</span>
                <span className="text-green-600">✓ {yesCount}</span>
                <span className="text-destructive">✗ {noCount}</span>
              </div>

              {unreviewedVenues.length === 0 ? (
                /* All reviewed */
                <div className="text-center py-8">
                  <p className="text-foreground font-semibold mb-1">All venues reviewed!</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Switch to All Venues to make changes, or continue to Likely Shows.
                  </p>
                </div>
              ) : (
                <>
                  {/* Swipe hint */}
                  <div className="flex items-center justify-center gap-4 bg-muted/50 border border-border rounded-lg px-4 py-2 mb-3">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <svg className="w-3.5 h-3.5 text-destructive/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-xs">Swipe left = No</span>
                    </div>
                    <span className="text-muted-foreground/40">·</span>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="text-xs">Swipe right = Yes</span>
                      <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                  </div>

                  {/* Swipeable cards */}
                  <div className="space-y-2">
                    {unreviewedVenues.map((venue, i) => (
                      <SwipeableVenueCard
                        key={venue.venue_id}
                        venue={venue}
                        rank={matchData.all_venues.indexOf(venue) + 1}
                        onYes={() => handleVenueStatus(venue.venue_id, 'yes')}
                        onNo={() => handleVenueStatus(venue.venue_id, 'no')}
                        onMaybe={() => handleVenueStatus(venue.venue_id, 'not_sure')}
                      />
                    ))}
                  </div>

                  {/* After top 10 cleared */}
                  {top10Cleared && unreviewedVenues.length > 0 && (
                    <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-lg text-center">
                      <p className="text-xs text-foreground font-medium mb-1">Top 10 reviewed ✓</p>
                      <p className="text-xs text-muted-foreground">Keep reviewing for better results, or save and continue.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── MOBILE: All Venues tab ── */}
            <div className={`md:hidden ${mobileTab !== 'all' ? 'hidden' : ''}`}>
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <span><span className="font-medium text-foreground">{reviewedCount}</span> of {totalVenues} reviewed</span>
                <span className="text-border">·</span>
                <span className="text-green-600">✓ {yesCount}</span>
                <span className="text-destructive">✗ {noCount}</span>
              </div>

              {mobileAllVenues.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No venues match this filter</p>
              ) : (
                <div className="space-y-2">
                  {pagedMobileAll.map(venue => {
                    const globalRank = mobileAllVenues.indexOf(venue) + 1;
                    return (
                      <MobileVenueCard
                        key={venue.venue_id}
                        venue={venue}
                        rank={globalRank}
                        currentStatus={venueStatuses.get(venue.venue_id) ?? null}
                        onStatus={s => handleVenueStatus(venue.venue_id, s)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Mobile All pagination */}
              {totalMobileAllPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                  <button onClick={() => setVenuePage(p => Math.max(1, p - 1))} disabled={safeMobileAllPage === 1}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                    ← Previous
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Page {safeMobileAllPage} of {totalMobileAllPages}
                  </span>
                  <button onClick={() => setVenuePage(p => Math.min(totalMobileAllPages, p + 1))} disabled={safeMobileAllPage === totalMobileAllPages}
                    className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                    Next →
                  </button>
                </div>
              )}
            </div>

            {/* Save & Continue — shared */}
            <div className="mt-4 pt-4 border-t border-border">
              {error && (
                <div className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>
              )}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-xs md:text-sm text-muted-foreground">
                  {hasConfirmedSome
                    ? `${reviewedCount} venue${reviewedCount !== 1 ? 's' : ''} reviewed — you can continue or keep reviewing.`
                    : 'Review at least one venue to continue to Likely Shows.'}
                </p>
                <button
                  onClick={handleSaveAndContinue}
                  disabled={!hasConfirmedSome || saving}
                  className={`px-6 py-3 rounded-lg font-semibold text-sm md:text-base transition-colors flex items-center justify-center gap-2 flex-shrink-0 ${
                    hasConfirmedSome && !saving
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'bg-muted text-muted-foreground cursor-not-allowed'
                  }`}
                >
                  {saving && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />}
                  {saving ? 'Saving...' : 'Save & Continue to Likely Shows →'}
                </button>
              </div>
            </div>
          </div>

          {/* ── Artists section ── */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6">
            {/* Header row */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-2">
              <h2 className="text-xl md:text-2xl font-bold text-card-foreground">Top Matched Artists</h2>
              <div className="flex gap-2 flex-wrap">
                {/* Chart / Table toggle */}
                <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                  <button onClick={() => setArtistDisplay('chart')}
                    className={`px-3 py-1.5 transition-colors ${artistDisplay === 'chart' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    Chart
                  </button>
                  <button onClick={() => setArtistDisplay('table')}
                    className={`px-3 py-1.5 transition-colors ${artistDisplay === 'table' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    Table
                  </button>
                </div>
                {/* Current Run / All Artists toggle */}
                <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                  <button onClick={() => { setArtistView('current'); setArtistPage(1); }}
                    className={`px-3 py-1.5 transition-colors ${artistView === 'current' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    Current Run
                  </button>
                  <button onClick={() => { setArtistView('all'); setArtistPage(1); }}
                    className={`px-3 py-1.5 transition-colors ${artistView === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    All Artists
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground mb-4">
              {artistView === 'current'
                ? `Artists with past Vancouver shows since ${matchData.first_concert_year}`
                : `All matched artists who've played in Vancouver since ${matchData.first_concert_year}`}
              {artistDisplay === 'chart' && ' — top 15 plotted by your song count vs. Vancouver shows'}
            </p>

            {/* ── Bubble chart view ── */}
            {artistDisplay === 'chart' && (
              <ArtistBubbleChart artists={allDisplayArtists} artistView={artistView} />
            )}

            {/* ── Table view ── */}
            {artistDisplay === 'table' && (
              <>
                {pagedArtists.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">No artists to show — switch to "All Artists"</p>
                ) : (
                  <>
                    <div className="overflow-x-auto -mx-4 md:mx-0">
                      <table className="min-w-full">
                        <thead>
                          <tr className="bg-muted">
                            <th className="px-2 md:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-8">#</th>
                            <th className="px-2 md:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Artist</th>
                            <th className="px-2 md:px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Songs</th>
                            <th className="px-2 md:px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Shows</th>
                            <th className="px-2 md:px-4 py-3 pl-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap">Score</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {pagedArtists.map((artist, index) => {
                            const globalRank = (safeArtistPage - 1) * ARTISTS_PER_PAGE + index + 1;
                            const score = artistView === 'current' ? artist.match_score : artist.match_score_all;
                            const shows = artistView === 'current' ? artist.vancouver_show_count : artist.vancouver_show_count_all;
                            return (
                              <tr key={artist.artist_id} className="hover:bg-muted/50 transition-colors">
                                <td className="px-2 md:px-4 py-2.5 text-sm font-bold text-primary">{globalRank}</td>
                                <td className="px-2 md:px-4 py-2.5 max-w-[120px] md:max-w-none">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs md:text-sm font-medium text-card-foreground truncate">{artist.artist_name}</span>
                                    {artist.spotify_artist_id && (
                                      <a href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`} target="_blank" rel="noopener noreferrer"
                                        onClick={e => e.stopPropagation()} className="flex-shrink-0 hover:opacity-70">
                                        <svg className="w-3 h-3 md:w-3.5 md:h-3.5" viewBox="0 0 24 24" fill="#1DB954">
                                          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                                        </svg>
                                      </a>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 md:px-4 py-2.5 text-xs md:text-sm text-center text-muted-foreground tabular-nums">{artist.spotify_song_count}</td>
                                <td className="px-2 md:px-4 py-2.5 text-xs md:text-sm text-center text-muted-foreground tabular-nums">{shows}</td>
                                <td className="px-2 md:px-4 py-2.5 pl-3">
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-10 md:w-24 bg-muted rounded-full h-1.5 hidden xs:block flex-shrink-0">
                                      <div className="bg-primary h-1.5 rounded-full" style={{ width: `${Math.min(score, 100)}%` }} />
                                    </div>
                                    <span className="text-xs md:text-sm font-semibold text-primary tabular-nums">
                                      {score.toFixed(1)}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {totalArtistPages > 1 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                        <button onClick={() => setArtistPage(p => Math.max(1, p - 1))} disabled={safeArtistPage === 1}
                          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          ← Previous
                        </button>
                        <span className="text-xs md:text-sm text-muted-foreground">
                          Page {safeArtistPage} of {totalArtistPages}
                          <span className="text-muted-foreground/60 ml-1">· {allDisplayArtists.length} artists</span>
                        </span>
                        <button onClick={() => setArtistPage(p => Math.min(totalArtistPages, p + 1))} disabled={safeArtistPage === totalArtistPages}
                          className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed">
                          Next →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

        </div>
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow p-3 md:p-4 border border-border">
      <p className="text-[10px] md:text-sm text-muted-foreground mb-0.5 md:mb-1 leading-tight">{label}</p>
      <p className="text-base md:text-2xl font-bold text-card-foreground">{value}</p>
    </div>
  );
}
