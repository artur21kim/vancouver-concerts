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

type SortKey = 'date' | 'artist';
type Scope = 'spotify' | 'all';
type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';

const CAPACITY_BUTTONS: {
  key: CapacityFilter;
  label: string;
  tooltip: string;
  textColor: string;
  badgeBg: string;
  badgeText: string;
}[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        textColor: 'text-muted-foreground',                          badgeBg: 'bg-gray-100 dark:bg-gray-800',        badgeText: 'text-gray-600 dark:text-gray-400'         },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     textColor: 'text-purple-400 dark:text-purple-300',           badgeBg: 'bg-purple-100 dark:bg-purple-900/30', badgeText: 'text-purple-700 dark:text-purple-300'     },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', textColor: 'text-[#3A8FBD]',                                 badgeBg: 'bg-blue-100 dark:bg-blue-900/30',     badgeText: 'text-[#3A8FBD]'                           },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  textColor: 'text-orange-600 dark:text-orange-400',           badgeBg: 'bg-orange-100 dark:bg-orange-900/30', badgeText: 'text-orange-700 dark:text-orange-400'     },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    textColor: 'text-rose-600 dark:text-rose-400',               badgeBg: 'bg-rose-100 dark:bg-rose-900/30',     badgeText: 'text-rose-700 dark:text-rose-400'         },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  textColor: 'text-gray-400 dark:text-gray-500',               badgeBg: 'bg-gray-100 dark:bg-gray-800',        badgeText: 'text-gray-500'                            },
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
  return CAPACITY_BUTTONS.find(b => b.key === key) || CAPACITY_BUTTONS[CAPACITY_BUTTONS.length - 1];
}

function formatCapacityTooltip(category: string | null, capacity: number | null): string {
  const labels: Record<CapacityFilter, string> = {
    small:   'Small',
    medium:  'Medium',
    large:   'Large',
    xlarge:  'X-Large',
    unknown: 'Unknown capacity',
    all:     '',
  };
  const key = getCapacityKey(category);
  const label = labels[key];
  if (capacity) return `${label} · ${capacity.toLocaleString()}`;
  return label;
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ─── Swipeable row ────────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 72; // px to trigger action
const SWIPE_MAX = 120;       // max visual travel

function SwipeableRow({
  show,
  onHeart,
  onSkip,
  showSpotifyBadge,
}: {
  show: Show;
  onHeart: (show: Show) => void;
  onSkip: (show: Show) => void;
  showSpotifyBadge: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const axisLocked = useRef<'h' | 'v' | null>(null);

  const capBtn = getCapacityButton(show.capacity_category);
  const capTooltip = formatCapacityTooltip(show.capacity_category, show.capacity);

  const springBack = useCallback(() => {
    setAnimating(true);
    setOffset(0);
    setTimeout(() => setAnimating(false), 300);
  }, []);

  const commit = useCallback((direction: 'right' | 'left') => {
    setAnimating(true);
    // Briefly overshoot then snap back
    setOffset(direction === 'right' ? SWIPE_MAX : -SWIPE_MAX);
    setTimeout(() => {
      if (direction === 'right') onHeart(show);
      else onSkip(show);
      setOffset(0);
      setAnimating(false);
    }, 220);
  }, [show, onHeart, onSkip]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    axisLocked.current = null;
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

    // Horizontal swipe — prevent page scroll
    e.preventDefault();
    const clamped = Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx));
    setOffset(clamped);
  };

  const onTouchEnd = () => {
    if (axisLocked.current !== 'h') {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    if (offset >= SWIPE_THRESHOLD) commit('right');
    else if (offset <= -SWIPE_THRESHOLD) commit('left');
    else springBack();
    touchStartX.current = null;
    touchStartY.current = null;
    axisLocked.current = null;
  };

  // Colours
  const bgSave   = `rgba(34,197,94,${Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1) * 0.25})`;
  const bgSkip   = `rgba(239,68,68,${Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1) * 0.25})`;
  const rowBg    = offset > 0 ? bgSave : offset < 0 ? bgSkip : undefined;
  const progress = Math.min(Math.abs(offset) / SWIPE_THRESHOLD, 1);

  const spotifyIcon = show.spotify_artist_id ? (
    <a
      href={`https://open.spotify.com/artist/${show.spotify_artist_id}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Spotify"
      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center shrink-0"
    >
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 24 24"
        fill={show.is_spotify_match ? '#1DB954' : 'currentColor'}
        style={show.is_spotify_match ? {} : { color: 'var(--muted-foreground)', opacity: 0.4 }}
      >
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    </a>
  ) : null;

  const ticketIcon = show.ticketmaster_url ? (
    <a
      href={show.ticketmaster_url}
      target="_blank"
      rel="noopener noreferrer"
      title="Buy tickets on Ticketmaster"
      className="hover:opacity-70 transition-opacity inline-flex items-center justify-center"
      onClick={e => e.stopPropagation()}
    >
      <img src="https://www.ticketmaster.ca/favicon.ico" alt="Ticketmaster" className="w-4 h-4" />
    </a>
  ) : <span className="text-muted-foreground text-xs">—</span>;

  return (
    <tr
      className={`relative select-none ${showSpotifyBadge && show.is_spotify_match ? 'bg-primary/5' : ''}`}
      style={{ backgroundColor: rowBg }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Swipe hint icons (mobile only, revealed behind the sliding content) */}
      {/* Left peek — save icon */}
      <td className="md:hidden absolute left-2 top-0 bottom-0 items-center justify-start pointer-events-none hidden-desktop"
          aria-hidden="true"
          style={{ display: 'flex', opacity: offset > 8 ? progress : 0 }}>
        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 24 24">
          <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
        </svg>
      </td>
      {/* Right peek — skip icon */}
      <td className="md:hidden absolute right-10 top-0 bottom-0 items-center justify-end pointer-events-none"
          aria-hidden="true"
          style={{ display: 'flex', opacity: offset < -8 ? progress : 0 }}>
        <svg className="w-4 h-4 text-destructive" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </td>

      {/* ── Desktop cells ── */}
      {/* actions */}
      <td className="hidden md:table-cell px-4 py-4 w-20">
        <div className="flex items-center gap-3">
          <button onClick={() => onHeart(show)} title={show.status === 'added' ? 'Remove from saved' : 'Save show'} className="focus:outline-none">
            <svg className={`w-5 h-5 transition-colors ${show.status === 'added' ? 'fill-destructive text-destructive' : 'fill-none text-muted-foreground hover:text-destructive'}`} stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
          </button>
          <button onClick={() => onSkip(show)} title={show.status === 'skipped' ? 'Unskip show' : 'Skip show'} className="focus:outline-none">
            <svg className={`w-4 h-4 transition-colors ${show.status === 'skipped' ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`} stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </td>
      {/* date */}
      <td className="hidden md:table-cell px-4 py-4 text-sm text-foreground">{formatDate(show.date)}</td>
      {/* artist/venue */}
      <td className="hidden md:table-cell px-4 py-4">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-sm font-medium truncate ${show.is_spotify_match ? 'text-primary' : 'text-foreground'}`}>{show.artist_name}</span>
          {show.spotify_artist_id ? (
            <a href={`https://open.spotify.com/artist/${show.spotify_artist_id}`} target="_blank" rel="noopener noreferrer" title="Open in Spotify" className="hover:opacity-70 transition-opacity inline-flex items-center justify-center shrink-0">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill={show.is_spotify_match ? '#1DB954' : 'currentColor'} style={show.is_spotify_match ? {} : { color: 'var(--muted-foreground)', opacity: 0.4 }}>
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
              </svg>
            </a>
          ) : null}
          {showSpotifyBadge && show.is_spotify_match && (
            <span className="text-xs text-green-500 font-medium shrink-0">● match</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-muted-foreground truncate">{show.venue_name}</span>
          {show.capacity_category && (
            <span title={capTooltip} className={`shrink-0 text-[10px] font-semibold ${capBtn.textColor}`}>{capBtn.label}</span>
          )}
        </div>
      </td>
      {/* tickets */}
      <td className="hidden md:table-cell px-4 py-4 text-center align-middle">{ticketIcon}</td>

      {/* ── Mobile cells (swipeable, no buttons) ── */}
      {/* date */}
      <td
        className="md:hidden px-2 py-3 align-top whitespace-nowrap"
        style={{ transform: `translateX(${offset}px)`, transition: animating ? 'transform 0.25s ease' : 'none' }}
      >
        <span className="text-[10px] text-foreground">{formatDate(show.date)}</span>
      </td>
      {/* artist/venue */}
      <td
        className="md:hidden px-1 py-3 min-w-0"
        style={{ transform: `translateX(${offset}px)`, transition: animating ? 'transform 0.25s ease' : 'none' }}
      >
        <div className="flex items-center gap-1 mb-0.5">
          <span className={`text-[11px] font-medium truncate ${show.is_spotify_match ? 'text-primary' : 'text-foreground'}`}>{show.artist_name}</span>
          {spotifyIcon}
          {showSpotifyBadge && show.is_spotify_match && (
            <span className="text-[10px] text-green-500 font-medium shrink-0">● match</span>
          )}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-muted-foreground truncate">{show.venue_name}</span>
          {show.capacity_category && (
            <span title={capTooltip} className={`shrink-0 text-[9px] font-semibold ${capBtn.textColor}`}>{capBtn.label}</span>
          )}
        </div>
      </td>
      {/* tickets */}
      <td
        className="md:hidden py-3 pr-3 w-10 align-middle"
        style={{ transform: `translateX(${offset}px)`, transition: animating ? 'transform 0.25s ease' : 'none' }}
      >
        <div className="flex items-center justify-center">{ticketIcon}</div>
      </td>
    </tr>
  );
}

// ─── Swipe hint footer row ────────────────────────────────────────────────────
function SwipeHintRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="md:hidden px-3 py-2.5 border-t border-border/50">
        <p className="text-[10px] text-muted-foreground text-center tracking-wide">
          ← skip &nbsp;·&nbsp; swipe to review &nbsp;·&nbsp; save →
        </p>
      </td>
    </tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function UpcomingShowsContent() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [scope, setScope] = useState<Scope>('spotify');
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [pastNavLoading, setPastNavLoading] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('upcoming_banner_dismissed');
    if (!dismissed) setBannerVisible(true);
  }, []);

  useEffect(() => { fetchUpcomingShows(); }, [scope]);

  const fetchUpcomingShows = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/upcoming-shows?scope=${scope}`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch upcoming shows');
      }
      const result = await response.json();
      setAllShows(result.data.shows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load upcoming shows');
    } finally {
      setLoading(false);
    }
  };

  const dismissBanner = () => {
    localStorage.setItem('upcoming_banner_dismissed', 'true');
    setBannerVisible(false);
  };

  const handlePastShowsClick = async () => {
    setPastNavLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/'); return; }
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('first_concert_year, completed_past_run')
        .eq('user_id', user.id)
        .single();
      if (!profile?.first_concert_year) router.push('/discover/past/setup');
      else if (profile.completed_past_run) router.push('/likely-shows');
      else router.push('/matches');
    } catch { router.push('/matches'); }
    finally { setPastNavLoading(false); }
  };

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped' | 'pending') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'upcoming_shows' }),
      });
      if (!response.ok) throw new Error('Failed to update show status');
      setAllShows(prev => prev.map(s => s.show_id === showId ? { ...s, status } : s));
    } catch { alert('Failed to update show. Please try again.'); }
  };

  const bulkUpdateStatus = async (showIds: number[], status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: showIds, status, source: 'upcoming_shows' }),
      });
      if (!response.ok) throw new Error('Failed to bulk update shows');
      setAllShows(prev => prev.map(s => showIds.includes(s.show_id) ? { ...s, status } : s));
    } catch { alert('Failed to update shows. Please try again.'); }
  };

  const handleHeart = useCallback((show: Show) => {
    updateShowStatus(show.show_id, show.status === 'added' ? 'pending' : 'added');
  }, []);

  const handleSkip = useCallback((show: Show) => {
    updateShowStatus(show.show_id, show.status === 'skipped' ? 'pending' : 'skipped');
  }, []);

  const filterByCapacity = (shows: Show[]) => {
    if (capacityFilter === 'all') return shows;
    return shows.filter(s => getCapacityKey(s.capacity_category) === capacityFilter);
  };

  const sortShows = (shows: Show[]) => [...shows].sort((a, b) => {
    if (sortBy === 'date')   return new Date(a.date).getTime() - new Date(b.date).getTime();
    if (sortBy === 'artist') return a.artist_name.localeCompare(b.artist_name);
    return 0;
  });

  const processShows = (shows: Show[]) => sortShows(filterByCapacity(shows));

  const newShows     = processShows(allShows.filter(s => s.status === 'pending'));
  const savedShows   = processShows(allShows.filter(s => s.status === 'added'));
  const skippedShows = processShows(allShows.filter(s => s.status === 'skipped'));
  const allReviewed  = allShows.length > 0 && newShows.length === 0;

  const newMatchedShows   = newShows.filter(s => s.is_spotify_match);
  const newUnmatchedShows = newShows.filter(s => !s.is_spotify_match);

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <div className="mb-8">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h1 className="text-4xl font-bold text-foreground mb-1">Discover</h1>
                <p className="text-muted-foreground text-sm">
                  {scope === 'spotify'
                    ? 'Based on your Spotify library and upcoming Vancouver shows'
                    : 'All upcoming Vancouver shows — your Spotify matches are highlighted'}
                </p>
              </div>
            </div>

            {/* View switcher */}
            <div className="flex rounded-xl border border-border overflow-hidden w-fit">
              <button className="flex items-center gap-2.5 px-6 py-3 text-sm font-semibold transition bg-primary text-primary-foreground" aria-current="page">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Upcoming Shows
              </button>
              <button onClick={handlePastShowsClick} disabled={pastNavLoading} className="flex items-center gap-2.5 px-6 py-3 text-sm font-semibold transition bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-l border-border disabled:opacity-50">
                {pastNavLoading
                  ? <div className="w-4 h-4 animate-spin rounded-full border-b-2 border-current" />
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                }
                Past Shows
              </button>
            </div>

            {/* Venue size filter */}
            <div className="flex items-center gap-2 mt-4">
              <span className="text-sm text-muted-foreground">Venue:</span>
              <div className="flex items-center gap-1">
                {CAPACITY_BUTTONS.map(btn => (
                  <button key={btn.key} onClick={() => setCapacityFilter(btn.key)} title={btn.tooltip}
                    className={`px-2.5 py-1 rounded text-xs font-semibold transition border ${
                      capacityFilter === btn.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : `bg-card border-border ${btn.textColor} hover:border-foreground/30`
                    }`}>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Dismissible banner */}
          {bannerVisible && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3 mb-6 flex items-start justify-between gap-4">
              <p className="text-sm text-foreground">
                💡 Your matches update automatically — come back any time to see new upcoming shows based on your Spotify library. Your saved and skipped choices are remembered.
              </p>
              <button onClick={dismissBanner} className="text-muted-foreground hover:text-foreground transition shrink-0 text-lg leading-none" title="Close">×</button>
            </div>
          )}

          {/* Stats + controls */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex gap-4">
              <StatPill label="New"     value={newShows.length}     color="default" />
              <StatPill label="Saved"   value={savedShows.length}   color="green"   />
              <StatPill label="Skipped" value={skippedShows.length} color="muted"   />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Scope toggle */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button onClick={() => setScope('spotify')} className={`px-3 py-1.5 transition ${scope === 'spotify' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>My Matches</button>
                <button onClick={() => setScope('all')} className={`px-3 py-1.5 transition ${scope === 'all' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>All Shows</button>
              </div>
              {/* Sort */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sort by</span>
                <div className="flex rounded-lg border border-border overflow-hidden font-medium">
                  {(['date', 'artist'] as SortKey[]).map(key => (
                    <button key={key} onClick={() => setSortBy(key)} className={`px-3 py-1.5 transition ${sortBy === key ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}>
                      {key === 'date' ? 'Date' : 'Artist'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-24">
              <div className="text-center">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
                <p className="text-muted-foreground text-lg">
                  {scope === 'all' ? 'Loading all upcoming shows...' : 'Finding upcoming shows for you...'}
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Shows</h2>
              <p className="text-destructive/80">{error}</p>
              <button onClick={fetchUpcomingShows} className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90">Try Again</button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* No shows at all */}
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

              {/* ── Spotify scope ── */}
              {scope === 'spotify' && allShows.length > 0 && (
                <NewShowsTable
                  title="New Shows"
                  shows={newShows}
                  allReviewed={allReviewed}
                  onHeart={handleHeart}
                  onSkip={handleSkip}
                  onSaveAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'added')}
                  onSkipAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'skipped')}
                  showSpotifyBadge={false}
                  onViewMyShows={() => router.push('/my-shows')}
                  onBrowse={() => router.push('/browse')}
                />
              )}

              {/* ── All Shows scope ── */}
              {scope === 'all' && allShows.length > 0 && (
                <>
                  {/* Matched */}
                  <NewShowsTable
                    title="Your Spotify Matches"
                    shows={newMatchedShows}
                    allReviewed={allReviewed}
                    onHeart={handleHeart}
                    onSkip={handleSkip}
                    onSaveAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'added')}
                    onSkipAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'skipped')}
                    showSpotifyBadge={false}
                    highlightHeader
                    onViewMyShows={() => router.push('/my-shows')}
                    onBrowse={() => router.push('/browse')}
                  />
                  {/* Other */}
                  {newUnmatchedShows.length > 0 && (
                    <ShowTable
                      title="All Other Shows"
                      shows={newUnmatchedShows}
                      onHeart={handleHeart}
                      onSkip={handleSkip}
                      onSaveAll={() => bulkUpdateStatus(newUnmatchedShows.map(s => s.show_id), 'added')}
                      onSkipAll={() => bulkUpdateStatus(newUnmatchedShows.map(s => s.show_id), 'skipped')}
                      showBulk
                      showSpotifyBadge={false}
                    />
                  )}
                </>
              )}

              {/* Saved */}
              {savedShows.length > 0 && (
                <ShowTable
                  title="Saved"
                  shows={savedShows}
                  onHeart={handleHeart}
                  onSkip={handleSkip}
                  showSpotifyBadge={scope === 'all'}
                />
              )}

              {/* Skipped */}
              {skippedShows.length > 0 && (
                <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
                  <button onClick={() => setSkippedOpen(o => !o)} className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition text-left">
                    <span className="font-semibold text-card-foreground">
                      Skipped <span className="text-muted-foreground font-normal ml-2">({skippedShows.length})</span>
                    </span>
                    <span className="text-muted-foreground font-mono text-sm">{skippedOpen ? '▼' : '▶'}</span>
                  </button>
                  {skippedOpen && (
                    <ShowTable
                      title=""
                      shows={skippedShows}
                      onHeart={handleHeart}
                      onSkip={handleSkip}
                      hideTitleBar
                      showSpotifyBadge={scope === 'all'}
                    />
                  )}
                </div>
              )}

              {/* Bottom nav links */}
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

// ─── NewShowsTable — always rendered, carries swipe hint + "all set" state ───
function NewShowsTable({
  title,
  shows,
  allReviewed,
  onHeart,
  onSkip,
  onSaveAll,
  onSkipAll,
  showSpotifyBadge,
  highlightHeader = false,
  onViewMyShows,
  onBrowse,
}: {
  title: string;
  shows: Show[];
  allReviewed: boolean;
  onHeart: (show: Show) => void;
  onSkip: (show: Show) => void;
  onSaveAll: () => void;
  onSkipAll: () => void;
  showSpotifyBadge: boolean;
  highlightHeader?: boolean;
  onViewMyShows: () => void;
  onBrowse: () => void;
}) {
  return (
    <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
      {/* Header */}
      <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${highlightHeader ? 'bg-primary/5' : ''}`}>
        <h2 className="font-semibold text-card-foreground flex items-center gap-2">
          {highlightHeader && (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1DB954">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
          )}
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

      {/* Table */}
      <table className="w-full">
        <thead className="bg-muted">
          <tr>
            {/* Desktop */}
            <th className="hidden md:table-cell px-4 py-3 w-20"></th>
            <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase w-36">Date</th>
            <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist / Venue</th>
            <th className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase w-24">Tickets</th>
            {/* Mobile */}
            <th className="md:hidden px-2 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">Date</th>
            <th className="md:hidden px-1 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist / Venue</th>
            <th className="md:hidden px-1 py-3 text-center text-xs font-medium text-muted-foreground uppercase w-10">Tix</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shows.map(show => (
            <SwipeableRow
              key={show.show_id}
              show={show}
              onHeart={onHeart}
              onSkip={onSkip}
              showSpotifyBadge={showSpotifyBadge}
            />
          ))}

          {/* Swipe hint — always visible on mobile */}
          <SwipeHintRow colSpan={3} />

          {/* "You're all set" — only when all reviewed */}
          {allReviewed && (
            <tr>
              <td colSpan={4} className="px-4 py-4">
                <p className="text-foreground font-semibold text-sm mb-1">You're all set!</p>
                <p className="text-muted-foreground text-xs mb-3">
                  Saved shows will appear in My Shows. Check back soon for new upcoming shows.
                </p>
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

// ─── Generic ShowTable (saved / skipped / all other shows) ────────────────────
function ShowTable({
  title,
  shows,
  onHeart,
  onSkip,
  onSaveAll,
  onSkipAll,
  showBulk = false,
  hideTitleBar = false,
  showSpotifyBadge = false,
  highlightHeader = false,
}: {
  title: string;
  shows: Show[];
  onHeart: (show: Show) => void;
  onSkip: (show: Show) => void;
  onSaveAll?: () => void;
  onSkipAll?: () => void;
  showBulk?: boolean;
  hideTitleBar?: boolean;
  showSpotifyBadge?: boolean;
  highlightHeader?: boolean;
}) {
  const tableContent = (
    <table className="w-full">
      <thead className="bg-muted">
        <tr>
          <th className="hidden md:table-cell px-4 py-3 w-20"></th>
          <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase w-36">Date</th>
          <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist / Venue</th>
          <th className="hidden md:table-cell px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase w-24">Tickets</th>
          <th className="md:hidden px-2 py-3 text-left text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">Date</th>
          <th className="md:hidden px-1 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist / Venue</th>
          <th className="md:hidden px-1 py-3 text-center text-xs font-medium text-muted-foreground uppercase w-10">Tix</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {shows.map(show => (
          <SwipeableRow
            key={show.show_id}
            show={show}
            onHeart={onHeart}
            onSkip={onSkip}
            showSpotifyBadge={showSpotifyBadge}
          />
        ))}
        <SwipeHintRow colSpan={3} />
      </tbody>
    </table>
  );

  if (hideTitleBar) return tableContent;

  return (
    <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
      <div className={`flex items-center justify-between px-6 py-4 border-b border-border ${highlightHeader ? 'bg-primary/5' : ''}`}>
        <h2 className="font-semibold text-card-foreground flex items-center gap-2">
          {highlightHeader && (
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1DB954">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
            </svg>
          )}
          {title}
          <span className="text-muted-foreground font-normal ml-1">({shows.length})</span>
        </h2>
        {showBulk && onSaveAll && onSkipAll && shows.length > 1 && (
          <div className="flex gap-2">
            <button onClick={onSaveAll} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition">Save All</button>
            <button onClick={onSkipAll} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition">Skip All</button>
          </div>
        )}
      </div>
      {tableContent}
    </div>
  );
}

function StatPill({ label, value, color }: { label: string; value: number; color: 'default' | 'green' | 'muted' }) {
  const colorClass = color === 'green' ? 'text-green-500' : color === 'muted' ? 'text-muted-foreground' : 'text-primary';
  return (
    <div className="bg-card rounded-lg shadow px-4 py-2 flex items-center gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-lg font-bold ${colorClass}`}>{value}</span>
    </div>
  );
}

export default function UpcomingShowsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground text-lg">Loading...</p>
        </div>
      </div>
    }>
      <UpcomingShowsContent />
    </Suspense>
  );
}
