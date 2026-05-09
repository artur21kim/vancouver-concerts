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
  current_run_artists: Artist[];
  all_artists: Artist[];
  all_venues: Venue[];
  duration_seconds: number;
};

type CapacityFilter  = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';
type ArtistView     = 'current' | 'all';
type VenueStatus    = 'yes' | 'no' | 'not_sure';
type MobileTab      = 'unreviewed' | 'all';

const VENUES_PER_PAGE  = 10;
const ARTISTS_DEFAULT  = 10; // shown by default before expanding
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

        <div className="flex items-center gap-2">
          <button onClick={onMaybe} className="flex-1 py-1.5 rounded-lg text-xs font-medium border bg-card border-border text-muted-foreground">
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
      currentStatus === 'yes'        ? 'border-green-500/40 bg-green-500/5'
      : currentStatus === 'no'      ? 'border-destructive/30 bg-destructive/5'
      : currentStatus === 'not_sure' ? 'border-border bg-muted/20'
      : 'border-border hover:bg-muted/20'
    }`}>
      <span className="text-xl font-bold text-primary flex-shrink-0 w-9 text-center">#{rank}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-card-foreground">{venue.venue_name}</h3>
          <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {venue.total_shows} shows · {venue.unique_artists} artists
        </p>
      </div>
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
      <div className="flex-shrink-0 w-36">
        <ScoreBar score={venue.match_score} />
      </div>
    </div>
  );
}

// ─── Mobile All-Venues card ───────────────────────────────────────────────────
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

// ─── Artist bar chart ─────────────────────────────────────────────────────────
function ArtistBarChart({ artists, artistView, expanded }: {
  artists: Artist[];
  artistView: ArtistView;
  expanded: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  // Always scale relative to the global #1 (full list, not just visible slice)
  const globalMax = Math.max(...artists.map(a => artistView === 'current' ? a.match_score : a.match_score_all), 1);

  const displayArtists = expanded ? artists : artists.slice(0, ARTISTS_DEFAULT);

  if (displayArtists.length === 0) return <p className="text-muted-foreground text-center py-12">No artists to display</p>;

  const shows = (a: Artist) => artistView === 'current' ? a.vancouver_show_count : a.vancouver_show_count_all;
  const score = (a: Artist) => artistView === 'current' ? a.match_score : a.match_score_all;

  const songsPct  = (a: Artist) => Math.min((score(a) / globalMax) * 100 * 0.7, 100);
  const showsPct  = (a: Artist) => Math.min((score(a) / globalMax) * 100 * 0.3, 100);

  return (
    <div className="w-full space-y-1.5">
      {/* Column headers */}
      <div className="flex items-center gap-3 pb-1 px-2 border-b border-border">
        <span className="w-5 flex-shrink-0" />
        <span className="w-40 md:w-56 flex-shrink-0 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Artist</span>
        <span className="flex-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Match Score</span>
        <span className="w-16 text-right text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">Score</span>
      </div>

      {displayArtists.map((artist, i) => {
        const isHovered = hovered === artist.artist_id;
        const sp  = songsPct(artist);
        const shp = showsPct(artist);
        const sc  = score(artist);

        return (
          <div
            key={artist.artist_id}
            className={`flex items-center gap-3 py-1.5 px-2 rounded-lg transition-colors cursor-default ${isHovered ? 'bg-muted/60' : 'hover:bg-muted/30'}`}
            onMouseEnter={() => setHovered(artist.artist_id)}
            onMouseLeave={() => setHovered(null)}
          >
            {/* Rank */}
            <span className="w-5 flex-shrink-0 text-xs font-bold text-primary text-right">{i + 1}</span>

            {/* Name + Spotify */}
            <div className="w-40 md:w-56 flex-shrink-0 flex items-center gap-1.5 min-w-0">
              <span className="text-xs font-medium text-card-foreground truncate">{artist.artist_name}</span>
              {artist.spotify_artist_id && (
                <a
                  href={`https://open.spotify.com/artist/${artist.spotify_artist_id}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="flex-shrink-0 hover:opacity-70 transition-opacity"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1DB954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                </a>
              )}
            </div>

            {/* Segmented bar */}
            <div className="flex-1 relative">
              <div className="flex h-5 bg-muted/40" style={{ borderRadius: '9999px' }}>
                <div
                  className="h-full transition-all duration-300"
                  style={{
                    width: `${sp}%`,
                    backgroundColor: '#0d9488',
                    borderRadius: shp > 0 ? '9999px 0 0 9999px' : '9999px',
                  }}
                  title={`${artist.spotify_song_count} songs in library`}
                />
                {shp > 0 && (
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${shp}%`,
                      backgroundColor: '#5eead4',
                      borderRadius: '0 9999px 9999px 0',
                    }}
                    title={`${shows(artist)} Vancouver shows`}
                  />
                )}
              </div>

              {/* Hover tooltip */}
              {isHovered && (
                <div className="absolute left-0 -top-10 z-10 bg-card border border-border rounded-lg px-2.5 py-1.5 text-[10px] text-muted-foreground whitespace-nowrap shadow-lg pointer-events-none flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: '#0d9488' }} />
                    <svg className="w-2.5 h-2.5 flex-shrink-0" viewBox="0 0 24 24" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    {artist.spotify_song_count} songs
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: '#5eead4' }} />
                    📍 {shows(artist)} shows
                  </span>
                </div>
              )}
            </div>

            {/* Score */}
            <span className="w-16 text-right text-xs font-semibold text-primary tabular-nums flex-shrink-0">
              {sc.toFixed(1)}%
            </span>
          </div>
        );
      })}

      {/* Legend */}
      <div className="flex items-center gap-4 pt-3 border-t border-border text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#0d9488' }} />
          <span>Liked songs</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: '#5eead4' }} />
          <span>Vancouver shows</span>
        </div>
      </div>
    </div>
  );
}

// ─── Venue pagination controls ────────────────────────────────────────────────
function VenuePaginationControls({
  currentPage,
  totalPages,
  totalVenues,
  onPrev,
  onNext,
}: {
  currentPage: number;
  totalPages: number;
  totalVenues: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <button
        onClick={onPrev}
        disabled={currentPage === 1}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
          currentPage === 1
            ? 'border-border text-muted-foreground/40 cursor-not-allowed'
            : 'border-primary text-primary hover:bg-primary hover:text-primary-foreground'
        }`}
      >
        ← Previous
      </button>
      <span className="text-xs text-muted-foreground">
        Page <span className="font-semibold text-foreground">{currentPage}</span> of <span className="font-semibold text-foreground">{totalPages}</span>
        <span className="text-muted-foreground/60 ml-1.5">· {totalVenues} venues</span>
      </span>
      <button
        onClick={onNext}
        disabled={currentPage === totalPages}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
          currentPage === totalPages
            ? 'border-border text-muted-foreground/40 cursor-not-allowed'
            : 'border-primary text-primary hover:bg-primary hover:text-primary-foreground'
        }`}
      >
        Next →
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [matchData, setMatchData] = useState<MatchData | null>(null);

  // Venue state
  const [venueStatuses, setVenueStatuses] = useState<Map<number, VenueStatus>>(new Map());
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [mobileTab, setMobileTab]           = useState<MobileTab>('unreviewed');
  const [venuePage, setVenuePage]           = useState(1);

  // Artist state
  const [artistView, setArtistView]       = useState<ArtistView>('current');
  const [artistExpanded, setArtistExpanded] = useState(false);

  useEffect(() => { fetchMatches(); }, []);

  const fetchMatches = async () => {
    try {
      const res = await fetch('/api/match');
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed'); }
      const result = await res.json();
      // Support both old shape (top_artists) and new shape (current_run_artists)
      const data: MatchData = {
        ...result.data,
        current_run_artists: result.data.current_run_artists ?? result.data.top_artists ?? [],
        all_artists:         result.data.all_artists ?? [],
        all_venues:          result.data.all_venues ?? result.data.top_venues ?? [],
      };
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

  // ── Derived ───────────────────────────────────────────────────────────────────
  const yesCount      = Array.from(venueStatuses.values()).filter(s => s === 'yes').length;
  const noCount       = Array.from(venueStatuses.values()).filter(s => s === 'no').length;
  const reviewedCount = venueStatuses.size;
  const totalVenues   = matchData?.all_venues.length ?? 0;
  const hasConfirmedSome = venueStatuses.size > 0;

  const desktopVenues = matchData && Array.isArray(matchData.all_venues)
    ? matchData.all_venues.filter(v =>
        capacityFilter === 'all' || capacityFilterKey(v.capacity_category) === capacityFilter
      )
    : [];
  const totalVenuePages = Math.max(1, Math.ceil(desktopVenues.length / VENUES_PER_PAGE));
  const safePage        = Math.min(venuePage, totalVenuePages);
  const pagedVenues     = desktopVenues.slice((safePage - 1) * VENUES_PER_PAGE, safePage * VENUES_PER_PAGE);

  const unreviewedVenues = matchData?.all_venues.filter(v => !venueStatuses.has(v.venue_id)) ?? [];
  const top10Cleared     = unreviewedVenues.filter((_, i) => i < 10).length === 0;

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

  // Artist lists for each tab
  const currentRunArtists = matchData?.current_run_artists ?? [];
  const allArtists        = matchData?.all_artists ?? [];
  const activeArtistList  = artistView === 'current' ? currentRunArtists : allArtists;

  const setCapacityAndReset = (f: CapacityFilter) => { setCapacityFilter(f); setVenuePage(1); };

  // Reset expand state when switching tabs
  const handleArtistViewChange = (view: ArtistView) => {
    setArtistView(view);
    setArtistExpanded(false);
  };

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
                  <>
                    <span className="text-sm md:text-base font-normal text-muted-foreground ml-1">
                      of {matchData.total_spotify_artists.toLocaleString()}
                    </span>
                    <span className="text-xs md:text-sm font-semibold text-primary ml-2">
                      ({Math.round((matchData.matched_artists_count / matchData.total_spotify_artists) * 100)}%)
                    </span>
                  </>
                )}
              </p>
            </div>
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

            <div className="flex flex-col gap-2 mb-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-card-foreground">Top Matched Venues</h2>
                  <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                    Which of these venues have you attended? Each hosted shows by artists in your Spotify library.
                  </p>
                </div>
                {/* Desktop capacity filter */}
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

              {/* Mobile: capacity + tab toggle */}
              <div className="flex items-center justify-between gap-2 md:hidden">
                <div className="flex rounded-lg border border-border overflow-hidden text-xs font-medium">
                  {CAPACITY_BUTTONS.map(btn => (
                    <button key={btn.key} onClick={() => setCapacityAndReset(btn.key)} title={btn.tooltip}
                      className={`px-2 py-1.5 transition-colors ${capacityFilter === btn.key ? 'bg-primary text-primary-foreground' : `bg-card ${btn.textColor} hover:bg-muted`}`}>
                      {btn.label}
                    </button>
                  ))}
                </div>
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

            {/* Review status pills — desktop */}
            <div className="hidden md:flex items-center gap-2 flex-wrap mb-4">
              <span className="text-xs text-muted-foreground">
                <span className="font-medium text-primary">{reviewedCount}</span> of {totalVenues} reviewed
              </span>
              <span className="text-border select-none">·</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-green-500/10 text-green-600 border-green-500/30">
                ✓ {yesCount} attended
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border bg-destructive/10 text-destructive border-destructive/30">
                ✗ {noCount} never been
              </span>
            </div>

            {/* ── Desktop venue list ── */}
            <div className="hidden md:block">
              {/* Pagination at top */}
              {totalVenuePages > 1 && (
                <VenuePaginationControls
                  currentPage={safePage}
                  totalPages={totalVenuePages}
                  totalVenues={desktopVenues.length}
                  onPrev={() => setVenuePage(p => Math.max(1, p - 1))}
                  onNext={() => setVenuePage(p => Math.min(totalVenuePages, p + 1))}
                />
              )}

              <div className="space-y-2">
                <div className="flex items-center gap-4 px-4 pb-1">
                  <span className="w-9 flex-shrink-0" />
                  <span className="flex-1" />
                  <span className="flex-shrink-0 w-[148px]" />
                  <span className="flex-shrink-0 w-36 text-xs font-medium text-muted-foreground uppercase tracking-wider">Match Score</span>
                </div>
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
            </div>

            {/* ── Mobile: Unreviewed tab ── */}
            <div className={`md:hidden ${mobileTab !== 'unreviewed' ? 'hidden' : ''}`}>
              <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground">
                <span><span className="font-medium text-foreground">{reviewedCount}</span> of {totalVenues} reviewed</span>
                <span className="text-border">·</span>
                <span className="text-green-600">✓ {yesCount}</span>
                <span className="text-destructive">✗ {noCount}</span>
              </div>

              {unreviewedVenues.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-foreground font-semibold mb-1">All venues reviewed!</p>
                  <p className="text-xs text-muted-foreground mb-4">
                    Switch to All Venues to make changes, or continue to Likely Shows.
                  </p>
                </div>
              ) : (
                <>
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
                  <div className="space-y-2">
                    {unreviewedVenues.map(venue => (
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
                  {top10Cleared && unreviewedVenues.length > 0 && (
                    <div className="mt-4 p-3 bg-primary/10 border border-primary/20 rounded-lg text-center">
                      <p className="text-xs text-foreground font-medium mb-1">Top 10 reviewed ✓</p>
                      <p className="text-xs text-muted-foreground">Keep reviewing for better results, or save and continue.</p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Mobile: All Venues tab ── */}
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

            {/* Save & Continue */}
            <div className="mt-4 pt-4 border-t border-border">
              {error && (
                <div className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">{error}</div>
              )}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-xs md:text-sm text-muted-foreground">
                  {hasConfirmedSome ? (
                    <><span className="text-primary font-medium">{reviewedCount} venue{reviewedCount !== 1 ? 's' : ''} reviewed</span> — you can continue or keep reviewing.</>
                  ) : 'Review at least one venue to continue to Likely Shows.'}
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
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-1">
              <h2 className="text-xl md:text-2xl font-bold text-card-foreground">Top Matched Artists</h2>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button onClick={() => handleArtistViewChange('current')}
                  className={`px-3 py-1.5 transition-colors ${artistView === 'current' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  Current Run
                </button>
                <button onClick={() => handleArtistViewChange('all')}
                  className={`px-3 py-1.5 transition-colors ${artistView === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  All Artists
                </button>
              </div>
            </div>

            <p className="text-xs md:text-sm text-muted-foreground mb-4">
              {artistView === 'current'
                ? `Artists with past Vancouver shows since ${matchData.first_concert_year} — top ${Math.min(ARTISTS_DEFAULT, currentRunArtists.length)} shown`
                : `All ${allArtists.length} matched artists ranked by match score — top ${Math.min(ARTISTS_DEFAULT, allArtists.length)} shown`}
              {activeArtistList.length > ARTISTS_DEFAULT && !artistExpanded && ` of ${activeArtistList.length}`}
            </p>

            <ArtistBarChart
              artists={activeArtistList}
              artistView={artistView}
              expanded={artistExpanded}
            />

            {/* Expand / collapse */}
            {activeArtistList.length > ARTISTS_DEFAULT && (
              <div className="mt-4 pt-3 border-t border-border flex justify-center">
                <button
                  onClick={() => setArtistExpanded(prev => !prev)}
                  className="flex items-center gap-2 px-5 py-2 rounded-lg border border-primary text-primary text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {artistExpanded
                    ? <>Show top {ARTISTS_DEFAULT} only ↑</>
                    : <>View all {activeArtistList.length} artists ↓</>}
                </button>
              </div>
            )}
          </div>

        </div>
      </main>
    </>
  );
}
