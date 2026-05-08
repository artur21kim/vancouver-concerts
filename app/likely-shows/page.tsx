'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type Show = {
  show_id: number;
  date: string;
  artist_id: number;
  artist_name: string;
  venue_id: number;
  venue_name: string;
  status: 'pending' | 'added' | 'skipped';
  match_score: number;
  spotify_song_count: number;
  vancouver_show_count: number;
};

type GroupedShows = {
  artist_id: number;
  artist_name: string;
  show_count: number;
  match_score: number;
  shows: Show[];
};

function getVancouverYesterday(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
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
    <div className="relative h-8 flex items-center select-none"
      onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <div ref={trackRef} className="absolute w-full h-2 bg-muted rounded-full cursor-pointer" onClick={onTrackClick}>
        <div className="absolute h-2 bg-primary rounded-full pointer-events-none"
          style={{ left: `${pct(value[0])}%`, right: `${100 - pct(value[1])}%` }} />
      </div>
      <div className="absolute w-5 h-5 rounded-full bg-primary border-2 border-background shadow-md cursor-grab active:cursor-grabbing touch-none z-20"
        style={{ left: `calc(${pct(value[0])}% - 10px)` }} onPointerDown={onPointerDown('left')} />
      <div className="absolute w-5 h-5 rounded-full bg-primary border-2 border-background shadow-md cursor-grab active:cursor-grabbing touch-none z-20"
        style={{ left: `calc(${pct(value[1])}% - 10px)` }} onPointerDown={onPointerDown('right')} />
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
  const [groupedShows, setGroupedShows] = useState<GroupedShows[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [yearRange, setYearRange] = useState<[number, number]>([2008, currentYear]);
  const [sortBy, setSortBy] = useState<'relevance' | 'artist' | 'count' | 'year'>('relevance');

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
      setAllShows(shows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shows');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    // Filter: year range + no future shows
    const filtered = allShows.filter(show => {
      const year = parseInt(show.date.split('-')[0]);
      return year >= yearRange[0] && year <= yearRange[1] && show.date <= yesterdayVancouver;
    });

    if (sortBy === 'year') {
      const yearGroups = filtered.reduce((acc, show) => {
        const year = parseInt(show.date.split('-')[0]);
        const existing = acc.find(g => g.artist_id === year);
        if (existing) { existing.shows.push(show); existing.show_count++; }
        else acc.push({ artist_id: year, artist_name: year.toString(), show_count: 1, match_score: 0, shows: [show] });
        return acc;
      }, [] as GroupedShows[]);
      yearGroups.sort((a, b) => b.artist_id - a.artist_id);
      yearGroups.forEach(g => g.shows.sort((a, b) => b.date.localeCompare(a.date)));
      setGroupedShows(yearGroups);
      return;
    }

    const grouped = filtered.reduce((acc, show) => {
      const existing = acc.find(g => g.artist_id === show.artist_id);
      if (existing) { existing.shows.push(show); existing.show_count++; }
      else acc.push({ artist_id: show.artist_id, artist_name: show.artist_name, show_count: 1, match_score: show.match_score, shows: [show] });
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

  const handleBulkAction = async (groupId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const groupShows = sortBy === 'year'
      ? allShows.filter(s => parseInt(s.date.split('-')[0]) === groupId)
      : allShows.filter(s => s.artist_id === groupId);
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

  // ── Derived stats ─────────────────────────────────────────────────────────
  const totalShows        = allShows.length;
  const addedCount        = allShows.filter(s => s.status === 'added').length;
  const skippedCount      = allShows.filter(s => s.status === 'skipped').length;
  const pendingCount      = allShows.filter(s => s.status === 'pending').length;
  const reviewedShowsCount = addedCount + skippedCount;
  const totalArtists      = new Set(allShows.map(s => s.artist_id)).size;
  const reviewedArtistsCount = new Set(allShows.filter(s => s.status !== 'pending').map(s => s.artist_id)).size;

  // ── Loading / error ───────────────────────────────────────────────────────
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
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* ── Header ── */}
          <div className="mb-6 flex items-start justify-between sticky top-16 bg-background py-4 z-10">
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-1">Likely Shows You Attended</h1>
              <p className="text-muted-foreground text-sm">Based on confirmed venues and your Spotify library</p>
            </div>
            <button
              onClick={() => router.push('/review-summary')}
              className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition whitespace-nowrap ml-4 flex-shrink-0"
            >
              Done Reviewing →
            </button>
          </div>

          {/* ── Stats ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard label="Shows Reviewed"   value={`${reviewedShowsCount} / ${totalShows}`} />
            <StatCard label="Artists Reviewed" value={`${reviewedArtistsCount} / ${totalArtists}`} />
            <StatCard label="Added"            value={addedCount.toLocaleString()} color="green" />
            <StatCard label="Skipped"          value={skippedCount.toLocaleString()} color="red" />
          </div>

          {/* ── Filters ── */}
          <div className="bg-card rounded-lg shadow p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-card-foreground">Filters & Sort</h2>
              <button
                onClick={() => setYearRange([2008, currentYear])}
                className="text-sm text-primary hover:text-primary/80 font-medium"
              >
                Clear All
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Year Range: {yearRange[0]} – {yearRange[1]}
                </label>
                <DualRangeSlider min={2008} max={currentYear} value={yearRange} onChange={setYearRange} />
              </div>
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Sort By</label>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as typeof sortBy)}
                  className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-primary bg-background text-foreground text-sm"
                >
                  <option value="relevance">Match Score (Recommended)</option>
                  <option value="count">Show Count (Most to Least)</option>
                  <option value="artist">Artist Name (A–Z)</option>
                  <option value="year">Year (Newest First)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Groups ── */}
          <div className="bg-card rounded-lg shadow overflow-hidden">
            {groupedShows.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground text-lg">No shows found matching your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {groupedShows.map(group => {
                  const isExpanded  = expandedGroups.has(group.artist_id);
                  const gAdded      = group.shows.filter(s => s.status === 'added').length;
                  const gSkipped    = group.shows.filter(s => s.status === 'skipped').length;
                  const gPending    = group.shows.filter(s => s.status === 'pending').length;
                  const allAdded    = gAdded === group.show_count;
                  const allSkipped  = gSkipped === group.show_count;
                  const allReviewed = gPending === 0;
                  const uniqueArtistCount = sortBy === 'year'
                    ? new Set(group.shows.map(s => s.artist_id)).size : null;

                  return (
                    <div key={group.artist_id}>

                      {/* ── Group header — entire row toggles expand ── */}
                      <div
                        className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => toggleGroup(group.artist_id)}
                      >
                        {/* Chevron */}
                        <span className="text-muted-foreground text-[10px] w-3 flex-shrink-0 mt-0.5">
                          {isExpanded ? '▼' : '▶'}
                        </span>

                        {/* Name + meta */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">{group.artist_name}</span>
                            <span className="text-muted-foreground text-sm">
                              {sortBy === 'year'
                                ? `(${group.show_count} shows · ${uniqueArtistCount} artists)`
                                : `(${group.show_count} shows)`}
                            </span>
                          </div>
                          {/* Match score bar */}
                          {sortBy !== 'year' && group.match_score > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary rounded-full"
                                  style={{ width: `${Math.min(group.match_score, 100)}%` }} />
                              </div>
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {group.match_score.toFixed(1)}%
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Review status badge */}
                        {allReviewed && (
                          <span className={`text-xs font-medium px-2.5 py-1 rounded-full flex-shrink-0 ${
                            allAdded   ? 'bg-green-500/15 text-green-500' :
                            allSkipped ? 'bg-destructive/15 text-destructive' :
                                         'bg-muted text-muted-foreground'
                          }`}>
                            {allAdded ? '✓ All added' : allSkipped ? '✗ All skipped' : `${gAdded + gSkipped} reviewed`}
                          </span>
                        )}

                        {/* Action buttons — stop propagation so they don't toggle row */}
                        <div className="flex gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          {gPending > 0 && (
                            (gAdded > 0 || gSkipped > 0) ? (
                              <>
                                <button onClick={() => handleRestAction(group.artist_id, 'add')}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition">
                                  Add Rest
                                </button>
                                <button onClick={() => handleRestAction(group.artist_id, 'skip')}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive text-white hover:bg-destructive/90 transition">
                                  Skip Rest
                                </button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => handleBulkAction(group.artist_id, 'add')}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-green-600 text-white hover:bg-green-700 transition">
                                  Add All
                                </button>
                                <button onClick={() => handleBulkAction(group.artist_id, 'skip')}
                                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-destructive text-white hover:bg-destructive/90 transition">
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
                      </div>

                      {/* ── Expanded show rows ── */}
                      {isExpanded && (
                        <div className="border-t border-border bg-background/50">
                          {/* Column headers */}
                          <div className={`grid px-5 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 ${
                            sortBy === 'year'
                              ? 'grid-cols-[120px_1fr_1fr_90px_64px]'
                              : 'grid-cols-[120px_1fr_90px_64px]'
                          }`}>
                            <span>Date</span>
                            {sortBy === 'year' && <span>Artist</span>}
                            <span>Venue</span>
                            <span>Status</span>
                            <span className="text-center">Actions</span>
                          </div>

                          {group.shows.map(show => (
                            <div
                              key={show.show_id}
                              className={`grid px-5 py-3 items-center border-t border-border/40 hover:bg-muted/20 transition-colors ${
                                sortBy === 'year'
                                  ? 'grid-cols-[120px_1fr_1fr_90px_64px]'
                                  : 'grid-cols-[120px_1fr_90px_64px]'
                              }`}
                            >
                              <span className="text-sm text-foreground whitespace-nowrap">
                                {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', {
                                  year: 'numeric', month: 'short', day: 'numeric'
                                })}
                              </span>
                              {sortBy === 'year' && (
                                <span className="text-sm text-foreground truncate pr-3">{show.artist_name}</span>
                              )}
                              <span className="text-sm text-muted-foreground truncate pr-3">{show.venue_name}</span>
                              <span className="text-xs">
                                {show.status === 'pending' && <span className="text-muted-foreground">Pending</span>}
                                {show.status === 'added'   && <span className="text-green-500 font-medium">Added ✓</span>}
                                {show.status === 'skipped' && <span className="text-destructive font-medium">Skipped ✗</span>}
                              </span>
                              {/* Heart + X icons matching Upcoming Shows style */}
                              <div className="flex items-center justify-center gap-2.5">
                                <button onClick={() => handleAddShow(show.show_id)} title="Add to My Shows"
                                  className="focus:outline-none">
                                  <svg className={`w-5 h-5 transition-colors ${show.status === 'added'
                                    ? 'fill-destructive text-destructive'
                                    : 'fill-none text-muted-foreground hover:text-destructive'}`}
                                    stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round"
                                      d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                  </svg>
                                </button>
                                <button onClick={() => handleSkipShow(show.show_id)} title="Skip this show"
                                  className="focus:outline-none">
                                  <svg className={`w-4 h-4 transition-colors ${show.status === 'skipped'
                                    ? 'text-destructive'
                                    : 'text-muted-foreground hover:text-destructive'}`}
                                    stroke="currentColor" strokeWidth="2.5" fill="none" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Bottom CTA ── */}
          <div className="mt-8 bg-card rounded-lg shadow p-6 text-center">
            <p className="text-muted-foreground mb-4">
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

function StatCard({ label, value, color = 'blue' }: {
  label: string; value: string; color?: 'blue' | 'green' | 'red' | 'gray'
}) {
  const colors = { blue: 'text-primary', green: 'text-green-500', red: 'text-destructive', gray: 'text-muted-foreground' };
  return (
    <div className="bg-card rounded-lg shadow p-4 border border-border/40">
      <p className="text-xs md:text-sm text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl md:text-2xl font-bold ${colors[color]}`}>{value}</p>
    </div>
  );
}
