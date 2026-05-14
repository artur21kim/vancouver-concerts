'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type Show = {
  show_id: number;
  date: string;
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string | null;
  venue_id: number;
  venue_name: string;
  capacity_category: string | null;
  status: 'pending' | 'added' | 'skipped';
  match_score: number;
  spotify_song_count: number;
  vancouver_show_count: number;
};

type GroupedShows = {
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string | null;
  show_count: number;
  match_score: number;
  spotify_song_count: number;
  vancouver_show_count: number;
  shows: Show[];
};

type CapacityKey = 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';

function getVancouverYesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// ── Capacity helpers ──────────────────────────────────────────────────────────
function getCapacityKey(category: string | null): CapacityKey {
  if (!category) return 'unknown';
  const c = category.toLowerCase();
  if (c.includes('x-large') || c.includes('xlarge')) return 'xlarge';
  if (c.includes('large'))  return 'large';
  if (c.includes('medium')) return 'medium';
  if (c.includes('small'))  return 'small';
  return 'unknown';
}

const CAPACITY_META: Record<CapacityKey, { label: string; textColor: string }> = {
  small:   { label: 'S',  textColor: 'text-purple-400 dark:text-purple-300' },
  medium:  { label: 'M',  textColor: 'text-[#3A8FBD]' },
  large:   { label: 'L',  textColor: 'text-orange-600 dark:text-orange-400' },
  xlarge:  { label: 'XL', textColor: 'text-rose-600 dark:text-rose-400' },
  unknown: { label: '?',  textColor: 'text-gray-400 dark:text-gray-500' },
};

function CapacityBadge({ category }: { category: string | null }) {
  const key = getCapacityKey(category);
  if (key === 'unknown') return null;
  const { label, textColor } = CAPACITY_META[key];
  return (
    <span className={`text-[10px] font-bold flex-shrink-0 ${textColor}`}>
      {label}
    </span>
  );
}

// ── Spotify icon SVG ──────────────────────────────────────────────────────────
function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

// ── Dual range slider ─────────────────────────────────────────────────────────
function DualRangeSlider({ min, max, value, onChange }: {
  min: number; max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'left' | 'right' | null>(null);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const valueFromX = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (max - min) + min);
  }, [min, max]);

  const onPointerDown = (handle: 'left' | 'right') => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = handle;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !trackRef.current) return;
    const v = valueFromX(e.clientX);
    if (dragging.current === 'left') onChange([Math.min(v, value[1]), value[1]]);
    else onChange([value[0], Math.max(v, value[0])]);
  };
  const onPointerUp = () => { dragging.current = null; };
  const onTrackClick = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const v = valueFromX(e.clientX);
    if (Math.abs(v - value[0]) <= Math.abs(v - value[1])) onChange([Math.min(v, value[1]), value[1]]);
    else onChange([value[0], Math.max(v, value[0])]);
  };

  return (
    <div className="relative h-6 flex items-center select-none"
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div ref={trackRef} className="absolute w-full h-1.5 bg-muted rounded-full cursor-pointer" onClick={onTrackClick}>
        <div className="absolute h-1.5 bg-primary rounded-full pointer-events-none"
          style={{ left: `${pct(value[0])}%`, right: `${100 - pct(value[1])}%` }} />
      </div>
      <div className="absolute w-4 h-4 rounded-full bg-primary border-2 border-background shadow-md cursor-grab active:cursor-grabbing touch-none z-20"
        style={{ left: `calc(${pct(value[0])}% - 8px)` }} onPointerDown={onPointerDown('left')} />
      <div className="absolute w-4 h-4 rounded-full bg-primary border-2 border-background shadow-md cursor-grab active:cursor-grabbing touch-none z-20"
        style={{ left: `calc(${pct(value[1])}% - 8px)` }} onPointerDown={onPointerDown('right')} />
    </div>
  );
}

// ── Swipe constants ───────────────────────────────────────────────────────────
const SWIPE_THRESHOLD = 72;
const SWIPE_MAX = 110;

// ── SwipeableShowRow ──────────────────────────────────────────────────────────
function SwipeableShowRow({
  show,
  onAdd,
  onSkip,
  children,
}: {
  show: Show;
  onAdd: () => void;
  onSkip: () => void;
  children: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const axisLocked = useRef<'h' | 'v' | null>(null);
  const isDragging = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    axisLocked.current = null;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!axisLocked.current) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
        axisLocked.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (axisLocked.current === 'h') {
      e.preventDefault();
      setDragX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
    }
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    if (axisLocked.current === 'h') {
      if (dragX >= SWIPE_THRESHOLD) onAdd();
      else if (dragX <= -SWIPE_THRESHOLD) onSkip();
    }
    setDragX(0);
    axisLocked.current = null;
  };

  const isAdded   = show.status === 'added';
  const isSkipped = show.status === 'skipped';
  const swipeProgress = Math.abs(dragX) / SWIPE_THRESHOLD;
  const borderClass = isAdded ? 'border-l-green-500' : isSkipped ? 'border-l-destructive' : 'border-l-transparent';
  const bgClass     = isAdded ? 'bg-green-500/5'     : isSkipped ? 'bg-destructive/5'      : 'hover:bg-muted/20';

  return (
    <div
      className={`relative overflow-hidden border-t border-border/40 border-l-2 transition-colors ${borderClass} ${bgClass}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {dragX > 10 && (
        <div className="absolute inset-0 bg-green-500 pointer-events-none md:hidden"
          style={{ opacity: Math.min(swipeProgress * 0.18, 0.18) }} />
      )}
      {dragX < -10 && (
        <div className="absolute inset-0 bg-destructive pointer-events-none md:hidden"
          style={{ opacity: Math.min(swipeProgress * 0.18, 0.18) }} />
      )}
      <div style={{ transform: `translateX(${dragX}px)`, transition: dragX === 0 ? 'transform 0.2s ease' : 'none' }}>
        {children}
      </div>
    </div>
  );
}

// ── SwipeableGroupHeader ──────────────────────────────────────────────────────
function SwipeableGroupHeader({
  canSwipe,
  onSwipeAdd,
  onSwipeSkip,
  children,
}: {
  canSwipe: boolean;
  onSwipeAdd: () => void;
  onSwipeSkip: () => void;
  children: React.ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const axisLocked = useRef<'h' | 'v' | null>(null);
  const isDragging = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!canSwipe) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    axisLocked.current = null;
    isDragging.current = true;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || !canSwipe) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!axisLocked.current) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6)
        axisLocked.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }
    if (axisLocked.current === 'h') {
      e.preventDefault();
      setDragX(Math.max(-SWIPE_MAX, Math.min(SWIPE_MAX, dx)));
    }
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
    if (canSwipe && axisLocked.current === 'h') {
      if (dragX >= SWIPE_THRESHOLD) onSwipeAdd();
      else if (dragX <= -SWIPE_THRESHOLD) onSwipeSkip();
    }
    setDragX(0);
    axisLocked.current = null;
  };

  const swipeProgress = Math.abs(dragX) / SWIPE_THRESHOLD;

  return (
    <div
      className="relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {canSwipe && dragX > 10 && (
        <div className="absolute inset-0 bg-green-500 pointer-events-none md:hidden"
          style={{ opacity: Math.min(swipeProgress * 0.15, 0.15) }} />
      )}
      {canSwipe && dragX < -10 && (
        <div className="absolute inset-0 bg-destructive pointer-events-none md:hidden"
          style={{ opacity: Math.min(swipeProgress * 0.15, 0.15) }} />
      )}
      <div style={{ transform: `translateX(${dragX}px)`, transition: dragX === 0 ? 'transform 0.2s ease' : 'none' }}>
        {children}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LikelyShowsPage() {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const yesterdayVancouver = getVancouverYesterday();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [lessLikelyShows, setLessLikelyShows] = useState<Show[]>([]);
  const [stretchShows, setStretchShows] = useState<Show[]>([]);
  const [lessLikelyOpen, setLessLikelyOpen] = useState(false);
  const [stretchOpen, setStretchOpen] = useState(false);
  const [groupedShows, setGroupedShows] = useState<GroupedShows[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [expandedLessLikelyGroups, setExpandedLessLikelyGroups] = useState<Set<number>>(new Set());
  const [yearRange, setYearRange] = useState<[number, number]>([2008, currentYear]);
  const [sortBy, setSortBy] = useState<'relevance' | 'artist' | 'count' | 'year' | 'reviewed'>('relevance');
  const [lessLikelyFilter, setLessLikelyFilter] = useState<'all' | 'unreviewed'>('all');

  useEffect(() => { fetchLikelyShows(); }, []);
  useEffect(() => { applyFiltersAndSort(); }, [allShows, yearRange, sortBy]);

  const fetchLikelyShows = async () => {
    try {
      const response = await fetch('/api/likely-shows');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch shows');
      }
      const result = await response.json();
      const shows = result.data.shows.map((show: any) => ({ ...show, status: 'pending' as const }));
      const less = (result.data.less_likely_shows || []).map((show: any) => ({ ...show, status: 'pending' as const }));
      const stretch = (result.data.stretch_shows || []).map((show: any) => ({ ...show, status: 'pending' as const }));
      setAllShows(shows);
      setLessLikelyShows(less);
      setStretchShows(stretch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shows');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    const withinRange = allShows.filter(show => {
      const year = parseInt(show.date.split('-')[0]);
      return year >= yearRange[0] && year <= yearRange[1] && show.date <= yesterdayVancouver;
    });

    if (sortBy === 'reviewed') {
      const grouped = withinRange.reduce((acc, show) => {
        const existing = acc.find(g => g.artist_id === show.artist_id);
        if (existing) { existing.shows.push(show); existing.show_count++; }
        else acc.push({
          artist_id: show.artist_id,
          artist_name: show.artist_name,
          spotify_artist_id: show.spotify_artist_id,
          show_count: 1,
          match_score: show.match_score,
          spotify_song_count: show.spotify_song_count,
          vancouver_show_count: show.vancouver_show_count,
          shows: [show],
        });
        return acc;
      }, [] as GroupedShows[]);

      const reviewedGroups = grouped.filter(g => g.shows.some(s => s.status !== 'pending'));
      reviewedGroups.sort((a, b) => a.artist_name.localeCompare(b.artist_name));
      reviewedGroups.forEach(g => g.shows.sort((a, b) => b.date.localeCompare(a.date)));
      setGroupedShows(reviewedGroups);
      return;
    }

    if (sortBy === 'year') {
      const yearGroups = withinRange.reduce((acc, show) => {
        const year = parseInt(show.date.split('-')[0]);
        const existing = acc.find(g => g.artist_id === year);
        if (existing) { existing.shows.push(show); existing.show_count++; }
        else acc.push({
          artist_id: year, artist_name: year.toString(),
          spotify_artist_id: null, show_count: 1,
          match_score: 0, spotify_song_count: 0, vancouver_show_count: 0,
          shows: [show],
        });
        return acc;
      }, [] as GroupedShows[]);
      yearGroups.sort((a, b) => b.artist_id - a.artist_id);
      yearGroups.forEach(g => g.shows.sort((a, b) => b.date.localeCompare(a.date)));
      setGroupedShows(yearGroups);
      return;
    }

    const pendingShows = withinRange.filter(s => s.status === 'pending');
    const grouped = pendingShows.reduce((acc, show) => {
      const existing = acc.find(g => g.artist_id === show.artist_id);
      if (existing) { existing.shows.push(show); existing.show_count++; }
      else acc.push({
        artist_id: show.artist_id,
        artist_name: show.artist_name,
        spotify_artist_id: show.spotify_artist_id,
        show_count: 1,
        match_score: show.match_score,
        spotify_song_count: show.spotify_song_count,
        vancouver_show_count: show.vancouver_show_count,
        shows: [show],
      });
      return acc;
    }, [] as GroupedShows[]);

    if (sortBy === 'relevance') grouped.sort((a, b) => b.match_score - a.match_score);
    else if (sortBy === 'artist') grouped.sort((a, b) => a.artist_name.localeCompare(b.artist_name));
    else if (sortBy === 'count') grouped.sort((a, b) => b.show_count - a.show_count);
    grouped.forEach(g => g.shows.sort((a, b) => b.date.localeCompare(a.date)));
    setGroupedShows(grouped);
  };

  const autoCollapseIfComplete = (groupId: number, updatedShows: Show[]) => {
    const groupShows = sortBy === 'year'
      ? updatedShows.filter(s => parseInt(s.date.split('-')[0]) === groupId)
      : updatedShows.filter(s => s.artist_id === groupId);
    if (groupShows.every(s => s.status !== 'pending')) {
      setExpandedGroups(prev => { const n = new Set(prev); n.delete(groupId); return n; });
    }
  };

  const autoCollapseLessLikelyIfComplete = (artistId: number, updatedShows: Show[]) => {
    const groupShows = updatedShows.filter(s => s.artist_id === artistId);
    if (groupShows.every(s => s.status !== 'pending')) {
      setExpandedLessLikelyGroups(prev => { const n = new Set(prev); n.delete(artistId); return n; });
    }
  };

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      const updated = allShows.map(s => s.show_id === showId ? { ...s, status } : s);
      setAllShows(updated);
      return updated;
    } catch { alert('Failed to update show. Please try again.'); return allShows; }
  };

  const updateLessLikelyShowStatus = async (showId: number, status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      const updated = lessLikelyShows.map(s => s.show_id === showId ? { ...s, status } : s);
      setLessLikelyShows(updated);
      return updated;
    } catch { alert('Failed to update show. Please try again.'); return lessLikelyShows; }
  };

  const handleAddShow = async (showId: number) => {
    const updated = await updateShowStatus(showId, 'added');
    const show = updated.find(s => s.show_id === showId);
    if (show) {
      const groupId = sortBy === 'year' ? parseInt(show.date.split('-')[0]) : show.artist_id;
      setTimeout(() => autoCollapseIfComplete(groupId, updated), 100);
    }
  };

  const handleSkipShow = async (showId: number) => {
    const updated = await updateShowStatus(showId, 'skipped');
    const show = updated.find(s => s.show_id === showId);
    if (show) {
      const groupId = sortBy === 'year' ? parseInt(show.date.split('-')[0]) : show.artist_id;
      setTimeout(() => autoCollapseIfComplete(groupId, updated), 100);
    }
  };

  const handleLessLikelyAddShow = async (showId: number) => {
    const updated = await updateLessLikelyShowStatus(showId, 'added');
    const show = updated.find(s => s.show_id === showId);
    if (show) setTimeout(() => autoCollapseLessLikelyIfComplete(show.artist_id, updated), 100);
  };

  const handleLessLikelySkipShow = async (showId: number) => {
    const updated = await updateLessLikelyShowStatus(showId, 'skipped');
    const show = updated.find(s => s.show_id === showId);
    if (show) setTimeout(() => autoCollapseLessLikelyIfComplete(show.artist_id, updated), 100);
  };

  const handleBulkAction = async (groupId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const groupShows = (sortBy === 'year'
      ? allShows.filter(s => parseInt(s.date.split('-')[0]) === groupId)
      : allShows.filter(s => s.artist_id === groupId)
    ).filter(s => s.status === 'pending');
    if (!groupShows.length) return;
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      const updated = allShows.map(s => groupShows.some(g => g.show_id === s.show_id) ? { ...s, status } : s);
      setAllShows(updated);
      setTimeout(() => autoCollapseIfComplete(groupId, updated), 100);
    } catch { alert('Failed to update shows. Please try again.'); }
  };

  const handleLessLikelyBulkAction = async (artistId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const groupShows = lessLikelyShows.filter(s => s.artist_id === artistId && s.status === 'pending');
    if (!groupShows.length) return;
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      const updated = lessLikelyShows.map(s => groupShows.some(g => g.show_id === s.show_id) ? { ...s, status } : s);
      setLessLikelyShows(updated);
      setTimeout(() => autoCollapseLessLikelyIfComplete(artistId, updated), 100);
    } catch { alert('Failed to update shows. Please try again.'); }
  };

  const handleLessLikelyClearAll = async (artistId: number) => {
    if (!confirm('Clear all reviews for this group?')) return;
    const groupShows = lessLikelyShows.filter(s => s.artist_id === artistId);
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status: 'pending', source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      setLessLikelyShows(prev => prev.map(s => groupShows.some(g => g.show_id === s.show_id) ? { ...s, status: 'pending' as const } : s));
    } catch { alert('Failed to clear reviews. Please try again.'); }
  };

  const handleRestAction = async (groupId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const pending = (sortBy === 'year'
      ? allShows.filter(s => parseInt(s.date.split('-')[0]) === groupId)
      : allShows.filter(s => s.artist_id === groupId)
    ).filter(s => s.status === 'pending');
    if (!pending.length) return;
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: pending.map(s => s.show_id), status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      const updated = allShows.map(s => pending.some(p => p.show_id === s.show_id) ? { ...s, status } : s);
      setAllShows(updated);
      setTimeout(() => autoCollapseIfComplete(groupId, updated), 100);
    } catch { alert('Failed to update shows. Please try again.'); }
  };

  const handleClearAll = async (groupId: number) => {
    if (!confirm('Clear all reviews for this group?')) return;
    const groupShows = sortBy === 'year'
      ? allShows.filter(s => parseInt(s.date.split('-')[0]) === groupId)
      : allShows.filter(s => s.artist_id === groupId);
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status: 'pending', source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed');
      setAllShows(allShows.map(s => groupShows.some(g => g.show_id === s.show_id) ? { ...s, status: 'pending' as const } : s));
    } catch { alert('Failed to clear reviews. Please try again.'); }
  };

  const toggleGroup = (id: number) => {
    setExpandedGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const toggleLessLikelyGroup = (id: number) => {
    setExpandedLessLikelyGroups(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalShows           = allShows.length;
  const addedCount           = allShows.filter(s => s.status === 'added').length;
  const skippedCount         = allShows.filter(s => s.status === 'skipped').length;
  const pendingCount         = allShows.filter(s => s.status === 'pending').length;
  const totalArtists         = new Set(allShows.map(s => s.artist_id)).size;
  const uniqueArtistCount    = new Set(groupedShows.map(g => g.artist_id)).size;

  const lessLikelyPending  = lessLikelyShows.filter(s => s.status === 'pending').length;
  const lessLikelyAdded    = lessLikelyShows.filter(s => s.status === 'added').length;
  const lessLikelySkipped  = lessLikelyShows.filter(s => s.status === 'skipped').length;
  const stretchPending     = stretchShows.filter(s => s.status === 'pending').length;

  const showTipBanner = sortBy !== 'reviewed' && sortBy !== 'year' && (addedCount + skippedCount) > 0;

  useEffect(() => {
    if (lessLikelyAdded + lessLikelySkipped > 0 && lessLikelyFilter === 'all') {
      setLessLikelyFilter('unreviewed');
    }
  }, [lessLikelyAdded, lessLikelySkipped]);

  if (loading) return (
    <>
      <Navigation />
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-muted-foreground text-lg">Loading likely shows...</p>
        </div>
      </div>
    </>
  );

  if (error) return (
    <>
      <Navigation />
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
            <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Shows</h2>
            <p className="text-destructive/80">{error}</p>
          </div>
        </div>
      </div>
    </>
  );

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-6 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ── Sticky header ── */}
          <div className="sticky top-16 bg-background pt-3 pb-2 z-30">

            <div className="hidden md:flex items-start justify-between gap-3 mb-3">
              <div>
                <h1 className="text-4xl font-bold text-foreground mb-0.5">Likely Shows You Attended</h1>
                <p className="text-muted-foreground text-sm">Based on confirmed venues and your Spotify library</p>
              </div>
              <button
                onClick={() => router.push('/review-summary')}
                className="flex-shrink-0 px-5 py-2.5 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition text-sm whitespace-nowrap"
              >
                Done Reviewing →
              </button>
            </div>

            <div className="md:hidden mb-3">
              <h1 className="text-2xl font-bold text-foreground mb-0.5">Likely Shows You Attended</h1>
              <p className="text-muted-foreground text-sm mb-2">Based on confirmed venues and your Spotify library</p>
              <div className="flex justify-start">
                <button
                  onClick={() => router.push('/review-summary')}
                  className="px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition text-sm"
                >
                  Done Reviewing
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 mb-3 text-xs text-muted-foreground/70 flex-wrap">
              <span>
                <span className="font-semibold text-foreground">{pendingCount}</span>
                {' '}pending
              </span>
              <span className="text-border select-none">·</span>
              <span>
                <span className="font-semibold text-foreground">{totalArtists}</span>
                {' '}artists
              </span>
              <span className="text-border select-none">·</span>
              <span>added <span className="font-semibold text-green-500/80">{addedCount}</span></span>
              <span className="text-border select-none">·</span>
              <span>skipped <span className="font-semibold text-destructive/80">{skippedCount}</span></span>
            </div>

            <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3 mb-3">
              {sortBy !== 'reviewed' && (
                <div className="flex items-center gap-2.5 flex-1">
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0 tabular-nums">
                    {yearRange[0]} – {yearRange[1]}
                  </span>
                  <div className="flex-1">
                    <DualRangeSlider min={2008} max={currentYear} value={yearRange} onChange={setYearRange} />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 md:gap-3">
                {sortBy !== 'reviewed' && <span className="hidden md:inline text-border select-none text-lg">|</span>}
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="flex-1 md:flex-none px-2.5 py-1.5 border border-border rounded-lg bg-background text-foreground text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="relevance">Match Score</option>
                  <option value="count">Show Count</option>
                  <option value="artist">Artist Name</option>
                  <option value="year">By Year</option>
                  <option value="reviewed">Reviewed</option>
                </select>
                {sortBy !== 'reviewed' && (
                  <button
                    onClick={() => setYearRange([2008, currentYear])}
                    className="text-xs border border-red-500/40 text-red-400 rounded px-2 py-1 hover:bg-red-500/10 hover:border-red-500 transition flex-shrink-0"
                  >
                    Reset
                  </button>
                )}
              </div>
            </div>

            {showTipBanner && (
              <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-muted/40 border border-border/50">
                <span className="text-muted-foreground/60 text-xs flex-shrink-0">💡</span>
                <p className="text-xs text-muted-foreground/70">
                  Changes can be reverted in{' '}
                  <button
                    onClick={() => setSortBy('reviewed')}
                    className="text-primary underline underline-offset-2 hover:text-primary/80 transition"
                  >
                    Reviewed
                  </button>
                  .
                </p>
              </div>
            )}
          </div>

          {/* ── Main groups ── */}
          <div className="bg-card rounded-lg shadow overflow-hidden">
            {groupedShows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {sortBy === 'reviewed'
                  ? 'No artists reviewed yet.'
                  : 'No shows match your current filters.'}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {groupedShows.map((group, index) => {
                  const isExpanded = expandedGroups.has(group.artist_id);
                  const relevantShows = group.shows;
                  const gAdded   = relevantShows.filter(s => s.status === 'added').length;
                  const gSkipped = relevantShows.filter(s => s.status === 'skipped').length;
                  const gPending = relevantShows.filter(s => s.status === 'pending').length;
                  const allReviewed = gPending === 0;
                  const allAdded    = allReviewed && gAdded === relevantShows.length;
                  const allSkipped  = allReviewed && gSkipped === relevantShows.length;
                  const rank = (sortBy !== 'year' && sortBy !== 'reviewed') ? index + 1 : null;
                  const headerCanSwipe = sortBy !== 'reviewed' && gPending === group.show_count;
                  const spotifyUrl = group.spotify_artist_id
                    ? `https://open.spotify.com/artist/${group.spotify_artist_id}`
                    : null;

                  return (
                    <div key={group.artist_id}>
                      <SwipeableGroupHeader
                        canSwipe={headerCanSwipe}
                        onSwipeAdd={() => handleBulkAction(group.artist_id, 'add')}
                        onSwipeSkip={() => handleBulkAction(group.artist_id, 'skip')}
                      >
                        <div
                          className="group/row flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => toggleGroup(group.artist_id)}
                        >
                          <div className="flex items-center gap-1 w-10 flex-shrink-0 justify-center">
                            {rank !== null && (
                              <span className="text-base font-bold text-primary tabular-nums leading-none">
                                #{rank}
                              </span>
                            )}
                            <span className="text-muted-foreground text-[10px] leading-none">
                              {isExpanded ? '▲' : '▼'}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-foreground truncate">
                                {group.artist_name}
                              </span>
                              {sortBy === 'year' ? (
                                <span className="text-muted-foreground text-sm whitespace-nowrap flex-shrink-0">
                                  ({group.show_count} shows · {uniqueArtistCount} artists)
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-sm whitespace-nowrap flex-shrink-0">
                                  <span className="group-hover/row:text-primary transition-colors">
                                    {group.show_count} {group.show_count === 1 ? 'show' : 'shows'}
                                  </span>
                                  {group.spotify_song_count > 0 && (
                                    <>
                                      <span className="mx-1.5 text-muted-foreground/40">&</span>
                                      {spotifyUrl ? (
                                        <a
                                          href={spotifyUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={e => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 hover:text-[#1DB954] transition-colors group/spotify"
                                        >
                                          <SpotifyIcon className="w-3 h-3 text-[#1DB954] inline" />
                                          <span className="group-hover/spotify:text-[#1DB954]">
                                            {group.spotify_song_count} {group.spotify_song_count === 1 ? 'song' : 'songs'}
                                          </span>
                                        </a>
                                      ) : (
                                        <span className="inline-flex items-center gap-1">
                                          <SpotifyIcon className="w-3 h-3 text-[#1DB954] inline" />
                                          {group.spotify_song_count} {group.spotify_song_count === 1 ? 'song' : 'songs'}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </span>
                              )}
                            </div>

                            {sortBy !== 'year' && sortBy !== 'reviewed' && group.match_score > 0 && (
                              <div className="flex items-center gap-2 mt-1">
                                <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden flex-shrink-0">
                                  <div className="h-full bg-primary rounded-full"
                                    style={{ width: `${Math.min(group.match_score, 100)}%` }} />
                                </div>
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {group.match_score.toFixed(1)}%
                                </span>
                              </div>
                            )}
                          </div>

                          {allReviewed && (
                            <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                              allAdded   ? 'bg-green-500/15 text-green-500' :
                              allSkipped ? 'bg-destructive/15 text-destructive' :
                                           'bg-primary/15 text-primary'
                            }`}>
                              {allAdded ? '✓ All added' : allSkipped ? '✗ All skipped' : `${gAdded + gSkipped} reviewed`}
                            </span>
                          )}

                          <div className="hidden md:flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            {gPending > 0 && (
                              (gAdded > 0 || gSkipped > 0) ? (
                                <>
                                  <button onClick={() => handleRestAction(group.artist_id, 'add')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-700/80 text-white hover:bg-green-700 transition">
                                    Add Rest
                                  </button>
                                  <button onClick={() => handleRestAction(group.artist_id, 'skip')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-700/80 text-white hover:bg-red-700 transition">
                                    Skip Rest
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button onClick={() => handleBulkAction(group.artist_id, 'add')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-700/80 text-white hover:bg-green-700 transition">
                                    Add All
                                  </button>
                                  <button onClick={() => handleBulkAction(group.artist_id, 'skip')}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-700/80 text-white hover:bg-red-700 transition">
                                    Skip All
                                  </button>
                                </>
                              )
                            )}
                            {allReviewed && (
                              <button onClick={() => handleClearAll(group.artist_id)}
                                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition">
                                Clear
                              </button>
                            )}
                          </div>

                          <div className="flex md:hidden gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                            {gPending > 0 && (gAdded > 0 || gSkipped > 0) && (
                              <>
                                <button onClick={() => handleRestAction(group.artist_id, 'add')}
                                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-green-700/80 text-white hover:bg-green-700 transition">
                                  +Rest
                                </button>
                                <button onClick={() => handleRestAction(group.artist_id, 'skip')}
                                  className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-red-700/80 text-white hover:bg-red-700 transition">
                                  −Rest
                                </button>
                              </>
                            )}
                            {allReviewed && (
                              <button onClick={() => handleClearAll(group.artist_id)}
                                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:border-foreground/40 transition">
                                Clear
                              </button>
                            )}
                          </div>

                        </div>
                      </SwipeableGroupHeader>

                      {isExpanded && (
                        <div className="border-t border-border bg-background/50">
                          <div className={`hidden md:grid px-5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 ${
                            sortBy === 'year' ? 'grid-cols-[48px_120px_1fr_1fr]' : 'grid-cols-[48px_120px_1fr]'
                          }`}>
                            <span>Actions</span>
                            <span>Date</span>
                            {sortBy === 'year' && <span>Artist</span>}
                            <span>Venue</span>
                          </div>

                          <div className="md:hidden flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">
                            <span>{sortBy === 'year' ? 'Date · Artist · Venue' : 'Date · Venue'}</span>
                            <span className="normal-case font-normal text-muted-foreground/40">swipe ↔</span>
                          </div>

                          {group.shows.map(show => {
                            const isAdded   = show.status === 'added';
                            const isSkipped = show.status === 'skipped';

                            return (
                              <SwipeableShowRow
                                key={show.show_id}
                                show={show}
                                onAdd={() => handleAddShow(show.show_id)}
                                onSkip={() => handleSkipShow(show.show_id)}
                              >
                                <div className={`hidden md:grid px-5 py-3 items-center ${
                                  sortBy === 'year' ? 'grid-cols-[48px_120px_1fr_1fr]' : 'grid-cols-[48px_120px_1fr]'
                                }`}>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => handleAddShow(show.show_id)} title="Add to My Shows" className="focus:outline-none">
                                      <svg className={`w-5 h-5 transition-colors ${isAdded ? 'fill-primary text-primary' : 'fill-none text-muted-foreground hover:text-primary'}`}
                                        stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                      </svg>
                                    </button>
                                    <button onClick={() => handleSkipShow(show.show_id)} title="Skip this show" className="focus:outline-none">
                                      <svg className={`w-4 h-4 transition-colors ${isSkipped ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}`}
                                        stroke="currentColor" strokeWidth="2.5" fill="none" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </div>
                                  <span className="text-sm text-foreground whitespace-nowrap">
                                    {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                  </span>
                                  {sortBy === 'year' && (
                                    <span className="text-sm text-foreground truncate pr-3">{show.artist_name}</span>
                                  )}
                                  <div className="flex items-center gap-1.5 min-w-0 pr-3">
                                    <span className="text-sm text-muted-foreground truncate">{show.venue_name}</span>
                                    <CapacityBadge category={show.capacity_category} />
                                  </div>
                                </div>

                                <div className="md:hidden px-4 py-2.5">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                      isAdded ? 'bg-green-500' : isSkipped ? 'bg-destructive' : 'bg-muted-foreground/30'
                                    }`} />
                                    <span className="text-xs text-muted-foreground/70 flex-shrink-0 tabular-nums">
                                      {(() => {
                                        const [y, m, d] = show.date.split('-');
                                        return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                                      })()}
                                    </span>
                                    {sortBy === 'year' && (
                                      <span className="text-xs text-foreground truncate">{show.artist_name}</span>
                                    )}
                                    <span className="text-xs text-muted-foreground truncate ml-auto">{show.venue_name}</span>
                                    <CapacityBadge category={show.capacity_category} />
                                  </div>
                                </div>
                              </SwipeableShowRow>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Less Likely Shows ── */}
          {lessLikelyShows.length > 0 && (
            <div className="mt-4 bg-card rounded-lg shadow overflow-hidden">
              <button
                onClick={() => setLessLikelyOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition text-left"
              >
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="font-semibold text-card-foreground text-sm">Less Likely Shows</span>
                  <span className="text-muted-foreground text-sm font-normal">({lessLikelyShows.length})</span>
                  {lessLikelyPending > 0 && (
                    <span className="text-xs text-muted-foreground/60">· {lessLikelyPending} pending</span>
                  )}
                  {lessLikelyAdded > 0 && (
                    <span className="text-xs font-medium text-green-500/80">· {lessLikelyAdded} added</span>
                  )}
                  {lessLikelySkipped > 0 && (
                    <span className="text-xs font-medium text-destructive/70">· {lessLikelySkipped} skipped</span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0" onClick={e => e.stopPropagation()}>
                  <div className="flex rounded-md border border-border overflow-hidden text-xs">
                    <button
                      onClick={() => setLessLikelyFilter('unreviewed')}
                      className={`px-2.5 py-1 transition ${lessLikelyFilter === 'unreviewed' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
                    >
                      Unreviewed
                    </button>
                    <button
                      onClick={() => setLessLikelyFilter('all')}
                      className={`px-2.5 py-1 border-l border-border transition ${lessLikelyFilter === 'all' ? 'bg-primary text-primary-foreground font-medium' : 'text-muted-foreground hover:bg-muted/50'}`}
                    >
                      All
                    </button>
                  </div>
                  <span className="text-muted-foreground text-sm">{lessLikelyOpen ? '▼' : '▶'}</span>
                </div>
              </button>

              {lessLikelyOpen && (
                <>
                  <div className="px-4 py-2 border-y border-amber-500/20 bg-amber-500/5">
                    <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 flex-wrap">
                      Shows with match score <span className="text-primary font-medium">below 10%</span> or 1–2
                      <SpotifyIcon className="w-3 h-3 inline-block flex-shrink-0 text-[#1DB954]" />
                      songs
                    </p>
                  </div>

                  {/* Mobile swipe hint */}
                  <div className="md:hidden flex items-center justify-center gap-4 bg-muted/30 border-b border-border px-4 py-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <svg className="w-3.5 h-3.5 text-destructive/80" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      <span className="text-xs">Swipe left to skip</span>
                    </div>
                    <span className="text-muted-foreground/40">·</span>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="text-xs">Swipe right to add</span>
                      <svg className="w-3.5 h-3.5 fill-primary text-primary" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                      </svg>
                    </div>
                  </div>

                  <div className="divide-y divide-border">
                    {(() => {
                      // Group less likely shows by artist
                      const grouped = lessLikelyShows.reduce((acc, show) => {
                        const existing = acc.find(g => g.artist_id === show.artist_id);
                        if (existing) { existing.shows.push(show); existing.show_count++; }
                        else acc.push({
                          artist_id: show.artist_id,
                          artist_name: show.artist_name,
                          spotify_artist_id: show.spotify_artist_id,
                          show_count: 1,
                          match_score: show.match_score,
                          spotify_song_count: show.spotify_song_count,
                          vancouver_show_count: show.vancouver_show_count,
                          shows: [show],
                        });
                        return acc;
                      }, [] as GroupedShows[]);

                      grouped.forEach(g => g.shows.sort((a, b) => b.date.localeCompare(a.date)));

                      // Unreviewed groups first, then reviewed — within each sort by match score
                      grouped.sort((a, b) => {
                        const aReviewed = a.shows.every(s => s.status !== 'pending');
                        const bReviewed = b.shows.every(s => s.status !== 'pending');
                        if (aReviewed !== bReviewed) return aReviewed ? 1 : -1;
                        return b.match_score - a.match_score;
                      });

                      // Apply unreviewed filter
                      const visible = lessLikelyFilter === 'unreviewed'
                        ? grouped.filter(g => g.shows.some(s => s.status === 'pending'))
                        : grouped;

                      return visible.map((group, index) => {
                        const gPending = group.shows.filter(s => s.status === 'pending').length;
                        const gAdded   = group.shows.filter(s => s.status === 'added').length;
                        const gSkipped = group.shows.filter(s => s.status === 'skipped').length;
                        const allReviewed = gPending === 0;
                        const isExpanded = !allReviewed && expandedLessLikelyGroups.has(group.artist_id);
                        const headerCanSwipe = gPending === group.show_count;
                        const spotifyUrl = group.spotify_artist_id
                          ? `https://open.spotify.com/artist/${group.spotify_artist_id}`
                          : null;

                        return (
                          <div key={group.artist_id}>
                            {/* Less Likely group header — same pattern as main list */}
                            <SwipeableGroupHeader
                              canSwipe={headerCanSwipe}
                              onSwipeAdd={() => handleLessLikelyBulkAction(group.artist_id, 'add')}
                              onSwipeSkip={() => handleLessLikelyBulkAction(group.artist_id, 'skip')}
                            >
                              <div
                                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => !allReviewed && toggleLessLikelyGroup(group.artist_id)}
                              >
                                {/* Amber rank number */}
                                <div className="flex items-center gap-1 w-10 flex-shrink-0 justify-center">
                                  <span className="text-sm font-bold text-amber-500 tabular-nums leading-none">
                                    #{index + 1}
                                  </span>
                                  {!allReviewed && (
                                    <span className="text-muted-foreground text-[10px] leading-none">
                                      {isExpanded ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>

                                {/* Name + metadata */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-semibold text-foreground truncate text-sm">{group.artist_name}</span>
                                    <span className="text-muted-foreground text-xs whitespace-nowrap flex-shrink-0">
                                      {group.show_count} {group.show_count === 1 ? 'show' : 'shows'}
                                      {group.spotify_song_count > 0 && (
                                        <>
                                          <span className="mx-1 text-muted-foreground/40">&</span>
                                          {spotifyUrl ? (
                                            <a
                                              href={spotifyUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={e => e.stopPropagation()}
                                              className="inline-flex items-center gap-0.5 hover:text-[#1DB954] transition-colors"
                                            >
                                              <SpotifyIcon className="w-2.5 h-2.5 text-[#1DB954] inline" />
                                              {group.spotify_song_count} songs
                                            </a>
                                          ) : (
                                            <span className="inline-flex items-center gap-0.5">
                                              <SpotifyIcon className="w-2.5 h-2.5 text-[#1DB954] inline" />
                                              {group.spotify_song_count} songs
                                            </span>
                                          )}
                                        </>
                                      )}
                                    </span>
                                  </div>
                                  {/* Amber score bar */}
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                                      <div className="h-full bg-amber-500/60 rounded-full" style={{ width: `${Math.min(group.match_score, 100)}%` }} />
                                    </div>
                                    <span className="text-xs text-muted-foreground tabular-nums">{group.match_score.toFixed(1)}%</span>
                                  </div>
                                </div>

                                {/* Reviewed badge */}
                                {allReviewed && (
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${
                                    gAdded > 0 && gSkipped === 0 ? 'bg-green-500/15 text-green-500' :
                                    gSkipped > 0 && gAdded === 0 ? 'bg-destructive/15 text-destructive' :
                                    'bg-primary/15 text-primary'
                                  }`}>
                                    {gAdded > 0 && gSkipped === 0 ? '✓ Added' : gSkipped > 0 && gAdded === 0 ? '✗ Skipped' : `${gAdded + gSkipped} reviewed`}
                                  </span>
                                )}

                                {/* Desktop bulk buttons */}
                                <div className="hidden md:flex gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}>
                                  {gPending > 0 && (
                                    <>
                                      <button
                                        onClick={() => handleLessLikelyBulkAction(group.artist_id, 'add')}
                                        className="px-2 py-1 text-xs font-semibold rounded bg-green-700/80 text-white hover:bg-green-700 transition"
                                      >
                                        {gAdded > 0 || gSkipped > 0 ? '+Rest' : 'Add All'}
                                      </button>
                                      <button
                                        onClick={() => handleLessLikelyBulkAction(group.artist_id, 'skip')}
                                        className="px-2 py-1 text-xs font-semibold rounded bg-red-700/80 text-white hover:bg-red-700 transition"
                                      >
                                        {gAdded > 0 || gSkipped > 0 ? '−Rest' : 'Skip All'}
                                      </button>
                                    </>
                                  )}
                                  {allReviewed && (
                                    <button
                                      onClick={() => handleLessLikelyClearAll(group.artist_id)}
                                      className="px-2 py-1 text-xs font-medium rounded border border-border text-muted-foreground hover:text-foreground transition"
                                    >
                                      Clear
                                    </button>
                                  )}
                                </div>

                                {/* Mobile clear button (only when reviewed) */}
                                {allReviewed && (
                                  <div className="flex md:hidden flex-shrink-0" onClick={e => e.stopPropagation()}>
                                    <button
                                      onClick={() => handleLessLikelyClearAll(group.artist_id)}
                                      className="px-2 py-1 text-xs font-medium rounded border border-border text-muted-foreground hover:text-foreground transition"
                                    >
                                      Clear
                                    </button>
                                  </div>
                                )}
                              </div>
                            </SwipeableGroupHeader>

                            {/* Expanded show rows — only pending shows visible, disappear on review */}
                            {isExpanded && (
                              <div className="border-t border-border bg-background/50">
                                <div className="md:hidden flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">
                                  <span>Date · Venue</span>
                                  <span className="normal-case font-normal text-muted-foreground/40">swipe ↔</span>
                                </div>
                                <div className="hidden md:grid px-5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 grid-cols-[48px_120px_1fr]">
                                  <span>Actions</span>
                                  <span>Date</span>
                                  <span>Venue</span>
                                </div>

                                {group.shows
                                  .filter(show => show.status === 'pending')
                                  .map(show => (
                                    <SwipeableShowRow
                                      key={show.show_id}
                                      show={show}
                                      onAdd={() => handleLessLikelyAddShow(show.show_id)}
                                      onSkip={() => handleLessLikelySkipShow(show.show_id)}
                                    >
                                      {/* Desktop row */}
                                      <div className="hidden md:grid px-5 py-3 items-center grid-cols-[48px_120px_1fr]">
                                        <div className="flex items-center gap-2">
                                          <button onClick={() => handleLessLikelyAddShow(show.show_id)} className="focus:outline-none">
                                            <svg className="w-5 h-5 fill-none text-muted-foreground hover:text-primary transition-colors"
                                              stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                            </svg>
                                          </button>
                                          <button onClick={() => handleLessLikelySkipShow(show.show_id)} className="focus:outline-none">
                                            <svg className="w-4 h-4 text-muted-foreground hover:text-destructive transition-colors"
                                              stroke="currentColor" strokeWidth="2.5" fill="none" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                            </svg>
                                          </button>
                                        </div>
                                        <span className="text-sm text-foreground whitespace-nowrap">
                                          {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                        </span>
                                        <div className="flex items-center gap-1.5 min-w-0 pr-3">
                                          <span className="text-sm text-muted-foreground truncate">{show.venue_name}</span>
                                          <CapacityBadge category={show.capacity_category} />
                                        </div>
                                      </div>

                                      {/* Mobile row */}
                                      <div className="md:hidden px-4 py-2.5">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <span className="text-xs text-muted-foreground/70 flex-shrink-0 tabular-nums">
                                            {(() => { const [y, m, d] = show.date.split('-'); return new Date(+y, +m - 1, +d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); })()}
                                          </span>
                                          <span className="text-xs text-muted-foreground truncate ml-auto">{show.venue_name}</span>
                                          <CapacityBadge category={show.capacity_category} />
                                        </div>
                                      </div>
                                    </SwipeableShowRow>
                                  ))}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Stretch Shows ── */}
          {stretchShows.length > 0 && (
            <div className="mt-4 bg-card rounded-lg shadow overflow-hidden">
              <button
                onClick={() => setStretchOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-card-foreground text-sm">All Other Matches</span>
                  <span className="text-muted-foreground text-sm font-normal">({stretchShows.length})</span>
                </div>
                <span className="text-muted-foreground text-sm ml-3">{stretchOpen ? '▼' : '▶'}</span>
              </button>
              {stretchOpen && (
                <div className="px-4 py-3 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    These artists matched your Spotify library but have a very low match score (&lt;1%). They are unlikely to be shows you attended but may be useful for users with longer concert histories.
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stretchShows.length} shows across {new Set(stretchShows.map(s => s.artist_id)).size} artists — go to <button onClick={() => router.push('/my-shows')} className="text-primary underline">My Shows</button> to manually add any you know you attended.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Bottom CTA ── */}
          <div className="mt-6 bg-card rounded-lg shadow p-5 text-center">
            <p className="text-muted-foreground mb-3">
              {pendingCount === 0
                ? 'All shows reviewed! View your results.'
                : `${pendingCount} shows still pending review. Your progress is saved automatically.`}
            </p>
            <button
              onClick={() => router.push('/review-summary')}
              className="px-8 py-4 bg-primary text-primary-foreground font-semibold text-lg rounded-lg hover:bg-primary/90 transition"
            >
              Done Reviewing →
            </button>
          </div>

        </div>
      </main>
    </>
  );
}
