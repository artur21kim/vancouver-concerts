'use client';

import { Suspense } from 'react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../../components/Navigation';
import { createClient } from '@/lib/supabase/client';

type Show = {
  show_id: number;
  date: string;
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string | null;
  venue_id: number;
  venue_name: string;
  capacity: number | null;
  capacity_category: string | null;
  ticketmaster_url: string | null;
  status: 'pending' | 'added' | 'skipped';
  match_score: number;
  spotify_song_count: number;
  vancouver_show_count: number;
  is_spotify_match: boolean;
};

type SortKey = 'date' | 'artist' | 'venue';
type SortDir = 'asc' | 'desc';
type Scope = 'spotify' | 'all';
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';
type SwipeContext = 'new' | 'saved' | 'skipped';

const CAPACITY_BUTTONS: {
  key: CapacityFilter;
  label: string;
  tooltip: string;
  textColor: string;
}[] = [
  { key: 'all',     label: 'All Venues', tooltip: 'All venues',  textColor: 'text-muted-foreground'                },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     textColor: 'text-purple-400 dark:text-purple-300' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', textColor: 'text-[#3A8FBD]'                       },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  textColor: 'text-orange-600 dark:text-orange-400' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    textColor: 'text-rose-600 dark:text-rose-400'     },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  textColor: 'text-gray-400 dark:text-gray-500'     },
];

function getCapacityKey(category: string | null): CapacityFilter {
  if (!category) return 'unknown';
  const c = category.toLowerCase();
  if (c.includes('x-large') || c.includes('xlarge')) return 'xlarge';
  if (c.includes('large'))  return 'large';
  if (c.includes('medium')) return 'medium';
  if (c.includes('small'))  return 'small';
  return 'unknown';
}

function getCapacityButton(category: string | null) {
  const key = getCapacityKey(category);
  return CAPACITY_BUTTONS.find(b => b.key === key) ?? CAPACITY_BUTTONS[CAPACITY_BUTTONS.length - 1];
}

function formatCapacityTooltip(category: string | null, capacity: number | null): string {
  const labels: Record<CapacityFilter, string> = {
    small: 'Small', medium: 'Medium', large: 'Large',
    xlarge: 'X-Large', unknown: 'Unknown capacity', all: '',
  };
  const key = getCapacityKey(category);
  return capacity ? `${labels[key]} · ${capacity.toLocaleString()}` : labels[key];
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

// ─── Spotify icon ─────────────────────────────────────────────────────────────
function SpotifyIcon({ artistId, isMatch }: { artistId: string; isMatch: boolean }) {
  return (
    <a
      href={`https://open.spotify.com/artist/${artistId}`}
      target="_blank" rel="noopener noreferrer"
      title="Open in Spotify"
      onClick={e => e.stopPropagation()}
      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center shrink-0"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24"
        fill={isMatch ? '#1DB954' : 'currentColor'}
        style={isMatch ? {} : { color: 'var(--muted-foreground)', opacity: 0.4 }}>
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    </a>
  );
}

// ─── Swipe config ─────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 72;
const SWIPE_MAX = 110;

type SwipeAction = 'save' | 'skip' | 'noop-saved' | 'noop-skipped';

function getSwipeActions(context: SwipeContext): { right: SwipeAction; left: SwipeAction } {
  switch (context) {
    case 'new':     return { right: 'save',         left: 'skip'          };
    case 'saved':   return { right: 'noop-saved',   left: 'skip'          };
    case 'skipped': return { right: 'save',         left: 'noop-skipped'  };
  }
}

function getSwipeColors(action: SwipeAction, progress: number) {
  const alpha = Math.min(progress, 1) * 0.25;
  switch (action) {
    case 'save':         return `rgba(34,197,94,${alpha})`;
    case 'skip':         return `rgba(239,68,68,${alpha})`;
    case 'noop-saved':   return `rgba(234,179,8,${alpha})`;
    case 'noop-skipped': return `rgba(234,179,8,${alpha})`;
  }
}

function getGhostIcon(action: SwipeAction) {
  switch (action) {
    case 'save':
      return (
        <svg className="w-5 h-5 fill-green-500 text-green-500" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      );
    case 'skip':
      return (
        <svg className="w-4 h-4 text-destructive" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case 'noop-saved':
      return (
        <svg className="w-5 h-5 fill-amber-400 text-amber-400" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      );
    case 'noop-skipped':
      return (
        <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
  }
}

function getNoopLabel(action: SwipeAction) {
  if (action === 'noop-saved')   return 'Already saved';
  if (action === 'noop-skipped') return 'Already skipped';
  return '';
}

// ─── Swipeable row ────────────────────────────────────────────────────────────
function SwipeableRow({
  show, context, onSave, onSkip, showSpotifyBadge,
}: {
  show: Show;
  context: SwipeContext;
  onSave: (show: Show) => void;
  onSkip: (show: Show) => void;
  showSpotifyBadge: boolean;
}) {
  const [offset, setOffset]       = useState(0);
  const [animating, setAnimating] = useState(false);
  const [noopLabel, setNoopLabel] = useState('');

  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const axisLocked  = useRef<'h' | 'v' | null>(null);

  const actions    = getSwipeActions(context);
  const progress   = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1);
  const activeAction: SwipeAction | null =
    offset > 4 ? actions.right : offset < -4 ? actions.left : null;
  const rowBg = noopLabel
    ? 'rgba(234,179,8,0.20)'
    : activeAction ? getSwipeColors(activeAction, progress) : undefined;

  const capBtn     = getCapacityButton(show.capacity_category);
  const capTooltip = formatCapacityTooltip(show.capacity_category, show.capacity);

  const springBack = () => {
    setAnimating(true); setOffset(0);
    setTimeout(() => setAnimating(false), 280);
  };

  const commit = (action: SwipeAction) => {
    if (action === 'noop-saved' || action === 'noop-skipped') {
      setAnimating(true); setOffset(0);
      setNoopLabel(getNoopLabel(action));
      setTimeout(() => { setNoopLabel(''); setAnimating(false); }, 900);
      return;
    }
    setAnimating(true);
    setOffset(action === 'save' ? SWIPE_MAX : -SWIPE_MAX);
    setTimeout(() => {
      if (action === 'save') onSave(show); else onSkip(show);
      setOffset(0); setAnimating(false);
    }, 220);
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
    const triggered =
      offset >= SWIPE_THRESHOLD  ? actions.right :
      offset <= -SWIPE_THRESHOLD ? actions.left  : null;
    if (triggered) commit(triggered); else springBack();
    touchStartX.current = null; touchStartY.current = null; axisLocked.current = null;
  };

  const handleDesktopHeart = () => {
    if (context === 'new' || context === 'skipped') onSave(show);
  };
  const handleDesktopSkip = () => {
    if (context === 'new' || context === 'saved') onSkip(show);
  };

  const ticketIcon = show.ticketmaster_url
    ? (
      <a href={show.ticketmaster_url} target="_blank" rel="noopener noreferrer"
        title="Buy tickets on Ticketmaster" onClick={e => e.stopPropagation()}
        className="hover:opacity-70 transition-opacity inline-flex items-center justify-center">
        <img src="https://www.ticketmaster.ca/favicon.ico" alt="Ticketmaster" className="w-4 h-4" />
      </a>
    )
    : <span className="text-muted-foreground text-xs">—</span>;

  return (
    <tr
      className={`relative overflow-hidden select-none border-b border-border last:border-0 ${showSpotifyBadge && show.is_spotify_match ? 'bg-primary/5' : ''}`}
      style={{ backgroundColor: rowBg }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
    >
      {/* Desktop */}
      <td className="hidden md:table-cell px-4 py-4 w-16">
        <div className="flex items-center gap-2">
          <button onClick={handleDesktopHeart} title="Save show" className="focus:outline-none">
            <svg className={`w-5 h-5 transition-colors ${context === 'saved' ? 'fill-destructive text-destructive' : 'fill-none text-muted-foreground hover:text-destructive'}`}
              stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </button>
          <button onClick={handleDesktopSkip} title="Skip show" className="focus:outline-none">
            <svg className={`w-4 h-4 transition-colors ${context === 'skipped' ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
              stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </td>
      <td className="hidden md:table-cell px-4 py-4 w-36 text-sm text-foreground whitespace-nowrap">
        {formatDate(show.date)}
      </td>
      <td className="hidden md:table-cell px-4 py-4">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-medium text-primary">{show.artist_name}</span>
          {show.spotify_artist_id && <SpotifyIcon artistId={show.spotify_artist_id} isMatch={show.is_spotify_match} />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground">{show.venue_name}</span>
          {show.capacity_category && (
            <span title={capTooltip} className={`shrink-0 text-[10px] font-semibold ${capBtn.textColor}`}>{capBtn.label}</span>
          )}
        </div>
      </td>
      <td className="hidden md:table-cell px-4 py-4 w-24 text-center align-middle">{ticketIcon}</td>

      {/* Mobile */}
      <td colSpan={3} className="md:hidden p-0 overflow-hidden">
        <div className="relative">
          {activeAction && !noopLabel && (
            <div className={`absolute top-0 bottom-0 flex items-center pointer-events-none ${offset > 0 ? 'left-3' : 'right-3'}`}
              style={{ opacity: progress }}>
              {getGhostIcon(activeAction)}
            </div>
          )}
          {noopLabel ? (
            <div className="flex items-center w-full justify-center" style={{ minHeight: '52px' }}>
              <span className="text-xs font-semibold text-amber-400">{noopLabel}</span>
            </div>
          ) : (
            <div className="flex items-center w-full py-3"
              style={{ transform: `translateX(${offset}px)`, transition: animating ? 'transform 0.25s ease' : 'none' }}>
              <div className="pl-3 shrink-0 w-[85px]">
                <span className="text-xs text-foreground whitespace-nowrap">{formatDate(show.date)}</span>
              </div>
              <div className="flex-1 min-w-0 px-2">
                <div className="flex items-center gap-1 mb-0.5">
                  <span className="text-[11px] font-medium truncate text-primary">{show.artist_name}</span>
                  {show.spotify_artist_id && <SpotifyIcon artistId={show.spotify_artist_id} isMatch={show.is_spotify_match} />}
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="text-[10px] text-muted-foreground truncate">{show.venue_name}</span>
                  {show.capacity_category && (
                    <span title={capTooltip} className={`shrink-0 text-[9px] font-semibold ${capBtn.textColor}`}>{capBtn.label}</span>
                  )}
                </div>
              </div>
              <div className="pr-3 shrink-0 w-[52px] flex items-center justify-center">{ticketIcon}</div>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Sortable table headers ───────────────────────────────────────────────────
type TableSortProps = { sortBy: SortKey; sortDir: SortDir; onSort: (key: SortKey) => void; };

function TableHeaders({ sortBy, sortDir, onSort }: TableSortProps) {
  const arrow = (key: SortKey) =>
    sortBy === key
      ? <span className="ml-0.5">{sortDir === 'asc' ? '↑' : '↓'}</span>
      : <span className="ml-0.5 text-muted-foreground/30">↕</span>;

  const thSort = 'text-xs font-medium text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors select-none';

  return (
    <thead className="bg-muted/60">
      <tr>
        {/* Desktop */}
        <th className="hidden md:table-cell px-4 py-3 w-16" />
        <th className={`hidden md:table-cell px-4 py-3 w-36 text-left ${thSort}`} onClick={() => onSort('date')}>
          Date{arrow('date')}
        </th>
        {/* Artist / Venue split into two clickable spans */}
        <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span className={`${thSort}`} onClick={() => onSort('artist')}>Artist{arrow('artist')}</span>
          <span className="mx-1.5 text-muted-foreground/30">/</span>
          <span className={`${thSort}`} onClick={() => onSort('venue')}>Venue{arrow('venue')}</span>
        </th>
        <th className="hidden md:table-cell px-4 py-3 w-24 text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Tickets</th>

        {/* Mobile */}
        <th colSpan={3} className="md:hidden p-0">
          <div className="flex items-center w-full py-2.5">
            <div className={`pl-3 shrink-0 w-[85px] text-left ${thSort}`} onClick={() => onSort('date')}>
              Date{arrow('date')}
            </div>
            <div className="flex-1 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide px-2">
              <span className={thSort} onClick={() => onSort('artist')}>Artist{arrow('artist')}</span>
              <span className="mx-1 text-muted-foreground/30">/</span>
              <span className={thSort} onClick={() => onSort('venue')}>Venue{arrow('venue')}</span>
            </div>
            <div className="pr-3 shrink-0 w-[52px] text-center text-xs font-medium text-muted-foreground uppercase tracking-wide">Tix</div>
          </div>
        </th>
      </tr>
    </thead>
  );
}

// ─── New Shows table ───────────────────────────────────────────────────────────
function NewShowsTable({
  title, shows, allReviewed, onSave, onSkip, onSaveAll, onSkipAll,
  showSpotifyBadge, highlightHeader = false, onViewMyShows, onBrowse,
  sortBy, sortDir, onSort,
}: {
  title: string; shows: Show[]; allReviewed: boolean;
  onSave: (show: Show) => void; onSkip: (show: Show) => void;
  onSaveAll: () => void; onSkipAll: () => void;
  showSpotifyBadge: boolean; highlightHeader?: boolean;
  onViewMyShows: () => void; onBrowse: () => void;
} & TableSortProps) {
  return (
    <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
      <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${highlightHeader ? 'bg-primary/5' : ''}`}>
        <h2 className="font-semibold text-card-foreground flex items-center gap-2">
          {highlightHeader && <SpotifyHeaderIcon />}
          {title}
          <span className="text-muted-foreground font-normal ml-1">({shows.length})</span>
        </h2>
        {shows.length > 1 && (
          <div className="flex gap-2">
            <button onClick={onSaveAll} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition">Save All</button>
            <button onClick={onSkipAll} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition">Skip All</button>
          </div>
        )}
      </div>
      <table className="w-full">
        {shows.length > 0 && <TableHeaders sortBy={sortBy} sortDir={sortDir} onSort={onSort} />}
        <tbody>
          {shows.map(show => (
            <SwipeableRow key={show.show_id} show={show} context="new" onSave={onSave} onSkip={onSkip} showSpotifyBadge={showSpotifyBadge} />
          ))}
          {allReviewed && (
            <tr>
              <td colSpan={4} className="px-4 py-5">
                <p className="text-foreground font-semibold text-sm mb-1">You're all set!</p>
                <p className="text-muted-foreground text-xs mb-3">Saved shows will appear in My Shows. Check back soon for new upcoming shows.</p>
                <div className="flex gap-2">
                  <button onClick={onViewMyShows} className="px-4 py-1.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition">View My Shows</button>
                  <button onClick={onBrowse} className="px-4 py-1.5 bg-card border border-border text-foreground text-sm font-semibold rounded-lg hover:bg-muted transition">Browse All Shows</button>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Generic show table ────────────────────────────────────────────────────────
function ShowTable({
  title, shows, context, onSave, onSkip, onSaveAll, onSkipAll,
  showBulk = false, hideTitleBar = false, showSpotifyBadge = false,
  highlightHeader = false, sortBy, sortDir, onSort,
}: {
  title: string; shows: Show[]; context: SwipeContext;
  onSave: (show: Show) => void; onSkip: (show: Show) => void;
  onSaveAll?: () => void; onSkipAll?: () => void;
  showBulk?: boolean; hideTitleBar?: boolean;
  showSpotifyBadge?: boolean; highlightHeader?: boolean;
} & TableSortProps) {
  const tableContent = (
    <table className="w-full">
      <TableHeaders sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
      <tbody>
        {shows.map(show => (
          <SwipeableRow key={show.show_id} show={show} context={context} onSave={onSave} onSkip={onSkip} showSpotifyBadge={showSpotifyBadge} />
        ))}
      </tbody>
    </table>
  );

  if (hideTitleBar) return tableContent;

  return (
    <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
      <div className={`flex items-center gap-3 px-4 py-3 border-b border-border ${highlightHeader ? 'bg-primary/5' : ''}`}>
        <h2 className="font-semibold text-card-foreground flex items-center gap-2 min-w-0">
          {highlightHeader && <SpotifyHeaderIcon />}
          <span className="truncate">{title}</span>
          <span className="text-muted-foreground font-normal shrink-0">({shows.length})</span>
        </h2>
        {showBulk && onSaveAll && onSkipAll && shows.length > 1 && (
          <div className="flex items-center gap-3 ml-auto shrink-0">
            <button onClick={onSaveAll} className="text-xs text-muted-foreground hover:text-foreground transition">Save all</button>
            <span className="text-border">·</span>
            <button onClick={onSkipAll} className="text-xs text-muted-foreground hover:text-foreground transition">Skip all</button>
          </div>
        )}
      </div>
      {tableContent}
    </div>
  );
}

function SpotifyHeaderIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="#1DB954">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
    </svg>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
function UpcomingShowsContent() {
  const router   = useRouter();
  const supabase = createClient();

  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState('');
  const [allShows, setAllShows]             = useState<Show[]>([]);
  const [sortBy, setSortBy]                 = useState<SortKey>('date');
  const [sortDir, setSortDir]               = useState<SortDir>('asc');
  const [scope, setScope]                   = useState<Scope>('spotify');
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [skippedOpen, setSkippedOpen]       = useState(false);
  const [bannerVisible, setBannerVisible]   = useState(false);
  const [swipeHintVisible, setSwipeHintVisible] = useState(false);
  const [pastNavLoading, setPastNavLoading] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('upcoming_banner_dismissed')) setBannerVisible(true);
    if (!localStorage.getItem('upcoming_swipe_hint_dismissed')) setSwipeHintVisible(true);
  }, []);

  useEffect(() => { fetchUpcomingShows(); }, [scope]);

  const fetchUpcomingShows = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/upcoming-shows?scope=${scope}`);
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to fetch');
      setAllShows((await res.json()).data.shows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load upcoming shows');
    } finally { setLoading(false); }
  };

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir('asc'); }
  };

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped' | 'pending') => {
    try {
      const res = await fetch('/api/shows/update-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'upcoming_shows' }),
      });
      if (!res.ok) throw new Error('Failed');
      setAllShows(prev => prev.map(s => s.show_id === showId ? { ...s, status } : s));
    } catch { alert('Failed to update show. Please try again.'); }
  };

  const bulkUpdateStatus = async (showIds: number[], status: 'added' | 'skipped') => {
    try {
      const res = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: showIds, status, source: 'upcoming_shows' }),
      });
      if (!res.ok) throw new Error('Failed');
      setAllShows(prev => prev.map(s => showIds.includes(s.show_id) ? { ...s, status } : s));
    } catch { alert('Failed to update shows. Please try again.'); }
  };

  const handleSave = useCallback((show: Show) => { updateShowStatus(show.show_id, 'added'); }, []);
  const handleSkip = useCallback((show: Show) => { updateShowStatus(show.show_id, 'skipped'); }, []);

  const handlePastShowsClick = async () => {
    setPastNavLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      const { data: profile } = await supabase
        .from('user_profiles').select('first_concert_year, completed_past_run')
        .eq('user_id', user.id).single();
      if (!profile?.first_concert_year) router.push('/discover/past/setup');
      else if (profile.completed_past_run) router.push('/likely-shows');
      else router.push('/matches');
    } catch { router.push('/matches'); }
    finally { setPastNavLoading(false); }
  };

  const dismissSwipeHint = () => {
    localStorage.setItem('upcoming_swipe_hint_dismissed', 'true');
    setSwipeHintVisible(false);
  };

  const filterByCapacity = (shows: Show[]) =>
    capacityFilter === 'all' ? shows : shows.filter(s => getCapacityKey(s.capacity_category) === capacityFilter);

  const sortShows = (shows: Show[]) => [...shows].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'date')   cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (sortBy === 'artist') cmp = a.artist_name.localeCompare(b.artist_name);
    if (sortBy === 'venue')  cmp = a.venue_name.localeCompare(b.venue_name);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const process = (shows: Show[]) => sortShows(filterByCapacity(shows));

  const newShows     = process(allShows.filter(s => s.status === 'pending'));
  const savedShows   = process(allShows.filter(s => s.status === 'added'));
  const skippedShows = process(allShows.filter(s => s.status === 'skipped'));
  const allReviewed  = allShows.length > 0 && newShows.length === 0;

  const newMatchedShows   = newShows.filter(s => s.is_spotify_match);
  const newUnmatchedShows = newShows.filter(s => !s.is_spotify_match);

  const tableProps: TableSortProps = { sortBy, sortDir, onSort: handleSort };

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ── Title ── */}
          <div className="mb-5">
            <h1 className="text-4xl font-bold text-foreground mb-1">Discover</h1>
            <p className="text-muted-foreground text-sm">
              {scope === 'spotify'
                ? 'Based on your Spotify library and upcoming Vancouver shows'
                : 'All upcoming Vancouver shows — your Spotify matches are highlighted'}
            </p>
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────────
               Desktop: single row, stats right-aligned
               Mobile:  Row 1 — both toggles side by side (shortened labels)
                        Row 2 — venue buttons
                        Row 3 — stats
          ── */}
          <div className="mb-5">

            {/* Desktop: single flex row with ml-auto pushing stats right */}
            <div className="hidden md:flex items-center gap-3">

              {/* Upcoming / Past */}
              <div className="flex rounded-xl border border-border overflow-hidden">
                <button className="flex items-center gap-2.5 px-5 py-2.5 text-sm font-semibold bg-primary text-primary-foreground" aria-current="page">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Upcoming Shows
                </button>
                <button onClick={handlePastShowsClick} disabled={pastNavLoading}
                  className="flex items-center gap-2.5 px-5 py-2.5 text-sm font-semibold bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-l border-border disabled:opacity-50 transition">
                  {pastNavLoading
                    ? <div className="w-4 h-4 animate-spin rounded-full border-b-2 border-current" />
                    : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                  }
                  Past Shows
                </button>
              </div>

              <span className="text-border select-none text-lg">|</span>

              {/* My Matches / All Shows */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button onClick={() => setScope('spotify')}
                  className={`px-4 py-2.5 transition ${scope === 'spotify' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  My Matches
                </button>
                <button onClick={() => setScope('all')}
                  className={`px-4 py-2.5 transition ${scope === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                  All Shows
                </button>
              </div>

              <span className="text-border select-none text-lg">|</span>

              {/* Venue size buttons — joined pill */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-semibold">
                {CAPACITY_BUTTONS.map((btn, i) => (
                  <button key={btn.key} onClick={() => setCapacityFilter(btn.key)} title={btn.tooltip}
                    className={`px-3 py-2.5 transition ${i > 0 ? 'border-l border-border' : ''} ${
                      capacityFilter === btn.key
                        ? 'bg-primary text-primary-foreground'
                        : `bg-card ${btn.textColor} hover:bg-muted`
                    }`}>
                    {btn.label}
                  </button>
                ))}
              </div>

              {/* Stats — pushed to far right */}
              <div className="ml-auto flex items-center gap-3 text-sm text-muted-foreground/70">
                <span>New <span className="font-semibold text-primary/80 ml-0.5">{newShows.length}</span></span>
                <span className="text-border">·</span>
                <span>Saved <span className="font-semibold text-green-500/80 ml-0.5">{savedShows.length}</span></span>
                <span className="text-border">·</span>
                <span>Skipped <span className="font-semibold ml-0.5">{skippedShows.length}</span></span>
              </div>

            </div>

            {/* Mobile: stacked rows */}
            <div className="flex flex-col gap-2.5 md:hidden">

              {/* Row 1: both toggles side by side — compact sizing */}
              <div className="flex items-center gap-2">
                {/* Upcoming / Past */}
                <div className="flex flex-1 rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  <button className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 bg-primary text-primary-foreground" aria-current="page">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Upcoming
                  </button>
                  <button onClick={handlePastShowsClick} disabled={pastNavLoading}
                    className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-l border-border disabled:opacity-50 transition">
                    {pastNavLoading
                      ? <div className="w-3 h-3 animate-spin rounded-full border-b-2 border-current shrink-0" />
                      : <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    }
                    Past
                  </button>
                </div>

                {/* My Matches / All Shows */}
                <div className="flex flex-1 rounded-lg border border-border overflow-hidden text-xs font-medium">
                  <button onClick={() => setScope('spotify')}
                    className={`flex-1 px-2.5 py-1.5 transition ${scope === 'spotify' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    My Matches
                  </button>
                  <button onClick={() => setScope('all')}
                    className={`flex-1 px-2.5 py-1.5 transition ${scope === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                    All Shows
                  </button>
                </div>
              </div>

              {/* Row 2: venue pill (same width as Upcoming/Past) + stats (aligned under My Matches) */}
              <div className="flex items-center gap-2">
                {/* Venue pill — flex-1 = same width as Upcoming/Past toggle */}
                <div className="flex flex-1 rounded-lg border border-border overflow-hidden text-xs font-semibold">
                  {CAPACITY_BUTTONS.map((btn, i) => (
                    <button
                      key={btn.key}
                      onClick={() => setCapacityFilter(btn.key)}
                      title={btn.tooltip}
                      className={`flex-1 flex items-center justify-center py-1.5 transition ${
                        i > 0 ? 'border-l border-border' : ''
                      } ${
                        capacityFilter === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : `bg-card ${btn.textColor} hover:bg-muted`
                      }`}>
                      {btn.key === 'all' ? 'All' : btn.label}
                    </button>
                  ))}
                </div>
                {/* Stats — fixed width fits 3-digit counts without squeezing venue pill */}
                <div className="shrink-0 w-[168px] flex items-center justify-around text-xs text-muted-foreground/70">
                  <span>New <span className="font-semibold text-primary/80">{newShows.length}</span></span>
                  <span className="text-border">·</span>
                  <span>Saved <span className="font-semibold text-green-500/80">{savedShows.length}</span></span>
                  <span className="text-border">·</span>
                  <span>Skipped <span className="font-semibold">{skippedShows.length}</span></span>
                </div>
              </div>

            </div>

          </div>

          {/* ── Dismissible info banner ── */}
          {bannerVisible && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-4">
              <p className="text-sm text-foreground">
                💡 Your matches update automatically — come back any time to see new upcoming shows based on your Spotify library.
              </p>
              <button onClick={() => { localStorage.setItem('upcoming_banner_dismissed', 'true'); setBannerVisible(false); }}
                className="text-muted-foreground hover:text-foreground transition shrink-0 text-lg leading-none" title="Close">×</button>
            </div>
          )}

          {/* ── Dismissible swipe hint — mobile only ── */}
          {swipeHintVisible && (
            <div className="md:hidden bg-muted/50 border border-border rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <svg className="w-4 h-4 text-destructive/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span className="text-xs font-medium">Swipe left to skip</span>
                </div>
                <span className="text-muted-foreground/40">·</span>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <span className="text-xs font-medium">Swipe right to save</span>
                  <svg className="w-4 h-4 fill-primary text-primary" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                  </svg>
                </div>
              </div>
              <button onClick={dismissSwipeHint}
                className="text-muted-foreground hover:text-foreground transition shrink-0 text-lg leading-none" title="Dismiss">×</button>
            </div>
          )}

          {/* ── Loading ── */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4" />
                <p className="text-muted-foreground text-lg">
                  {scope === 'all' ? 'Loading all upcoming shows...' : 'Finding upcoming shows for you...'}
                </p>
              </div>
            </div>
          )}

          {/* ── Error ── */}
          {error && !loading && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Shows</h2>
              <p className="text-destructive/80">{error}</p>
              <button onClick={fetchUpcomingShows} className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90">Try Again</button>
            </div>
          )}

          {/* ── Tables ── */}
          {!loading && !error && (
            <>
              {allShows.length === 0 && (
                <div className="bg-card rounded-lg shadow p-12 text-center">
                  <p className="text-muted-foreground text-lg mb-2">
                    {scope === 'spotify'
                      ? 'No upcoming Vancouver shows found for artists in your Spotify library.'
                      : 'No upcoming Vancouver shows found.'}
                  </p>
                  <p className="text-muted-foreground text-sm">Check back soon — new shows are added regularly.</p>
                </div>
              )}

              {scope === 'spotify' && allShows.length > 0 && (
                <NewShowsTable
                  title="New Shows" shows={newShows} allReviewed={allReviewed}
                  onSave={handleSave} onSkip={handleSkip}
                  onSaveAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'added')}
                  onSkipAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'skipped')}
                  showSpotifyBadge={false}
                  onViewMyShows={() => router.push('/my-shows')}
                  onBrowse={() => router.push('/browse')}
                  {...tableProps}
                />
              )}

              {scope === 'all' && allShows.length > 0 && (
                <>
                  <NewShowsTable
                    title="Your Spotify Matches" shows={newMatchedShows} allReviewed={allReviewed}
                    onSave={handleSave} onSkip={handleSkip}
                    onSaveAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'added')}
                    onSkipAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'skipped')}
                    showSpotifyBadge={false} highlightHeader
                    onViewMyShows={() => router.push('/my-shows')}
                    onBrowse={() => router.push('/browse')}
                    {...tableProps}
                  />
                  {newUnmatchedShows.length > 0 && (
                    <ShowTable
                      title="All Other Shows" shows={newUnmatchedShows} context="new"
                      onSave={handleSave} onSkip={handleSkip}
                      onSaveAll={() => bulkUpdateStatus(newUnmatchedShows.map(s => s.show_id), 'added')}
                      onSkipAll={() => bulkUpdateStatus(newUnmatchedShows.map(s => s.show_id), 'skipped')}
                      showBulk showSpotifyBadge={false}
                      {...tableProps}
                    />
                  )}
                </>
              )}

              {savedShows.length > 0 && (
                <ShowTable
                  title="Saved" shows={savedShows} context="saved"
                  onSave={handleSave} onSkip={handleSkip}
                  showSpotifyBadge={scope === 'all'}
                  {...tableProps}
                />
              )}

              {skippedShows.length > 0 && (
                <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
                  <button onClick={() => setSkippedOpen(o => !o)}
                    className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition text-left">
                    <span className="font-semibold text-card-foreground">
                      Skipped <span className="text-muted-foreground font-normal ml-2">({skippedShows.length})</span>
                    </span>
                    <span className="text-muted-foreground text-sm">{skippedOpen ? '▼' : '▶'}</span>
                  </button>
                  {skippedOpen && (
                    <ShowTable
                      title="" shows={skippedShows} context="skipped"
                      onSave={handleSave} onSkip={handleSkip}
                      hideTitleBar showSpotifyBadge={scope === 'all'}
                      {...tableProps}
                    />
                  )}
                </div>
              )}

              {allShows.length > 0 && !allReviewed && (
                <div className="mt-4 flex justify-center gap-4 text-sm">
                  <button onClick={() => router.push('/my-shows')} className="text-primary hover:text-primary/80 font-medium transition">View My Shows →</button>
                  <button onClick={() => router.push('/browse')} className="text-primary hover:text-primary/80 font-medium transition">Browse All Shows →</button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

export default function UpcomingShowsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">Loading...</p>
        </div>
      </div>
    }>
      <UpcomingShowsContent />
    </Suspense>
  );
}
