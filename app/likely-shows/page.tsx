'use client';

import { useEffect, useState } from 'react';
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

export default function LikelyShowsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [filteredShows, setFilteredShows] = useState<Show[]>([]);
  const [groupedShows, setGroupedShows] = useState<GroupedShows[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const [yearRange, setYearRange] = useState<[number, number]>([2008, 2025]);
  const [selectedArtists, setSelectedArtists] = useState<number[]>([]);
  const [selectedVenues, setSelectedVenues] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<'relevance' | 'artist' | 'count' | 'year'>('relevance');
  const [availableArtists, setAvailableArtists] = useState<{ artist_id: number; artist_name: string }[]>([]);
  const [availableVenues, setAvailableVenues] = useState<{ venue_id: number; venue_name: string }[]>([]);

  useEffect(() => { fetchLikelyShows(); }, []);
  useEffect(() => { applyFiltersAndSort(); }, [allShows, yearRange, selectedArtists, selectedVenues, sortBy]);

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

      const artists = Array.from(new Set(shows.map((s: Show) => JSON.stringify({ artist_id: s.artist_id, artist_name: s.artist_name }))))
        .map(str => JSON.parse(str as string) as { artist_id: number; artist_name: string })
        .sort((a, b) => a.artist_name.localeCompare(b.artist_name));
      const venues = Array.from(new Set(shows.map((s: Show) => JSON.stringify({ venue_id: s.venue_id, venue_name: s.venue_name }))))
        .map(str => JSON.parse(str as string) as { venue_id: number; venue_name: string })
        .sort((a, b) => a.venue_name.localeCompare(b.venue_name));
      setAvailableArtists(artists);
      setAvailableVenues(venues);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shows');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...allShows];
    filtered = filtered.filter(show => {
      const year = new Date(show.date + 'T12:00:00').getFullYear();
      return year >= yearRange[0] && year <= yearRange[1];
    });
    if (selectedArtists.length > 0) filtered = filtered.filter(show => selectedArtists.includes(show.artist_id));
    if (selectedVenues.length > 0) filtered = filtered.filter(show => selectedVenues.includes(show.venue_id));
    setFilteredShows(filtered);
    groupAndSortShows(filtered);
  };

  const groupAndSortShows = (shows: Show[]) => {
    if (sortBy === 'year') {
      const yearGroups = shows.reduce((acc, show) => {
        const year = new Date(show.date + 'T12:00:00').getFullYear();
        const existing = acc.find(g => g.artist_id === year);
        if (existing) { existing.shows.push(show); existing.show_count++; }
        else acc.push({ artist_id: year, artist_name: year.toString(), show_count: 1, match_score: 0, shows: [show] });
        return acc;
      }, [] as GroupedShows[]);
      yearGroups.sort((a, b) => b.artist_id - a.artist_id);
      yearGroups.forEach(g => g.shows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setGroupedShows(yearGroups);
      return;
    }

    const grouped = shows.reduce((acc, show) => {
      const existing = acc.find(g => g.artist_id === show.artist_id);
      if (existing) { existing.shows.push(show); existing.show_count++; }
      else acc.push({ artist_id: show.artist_id, artist_name: show.artist_name, show_count: 1, match_score: show.match_score, shows: [show] });
      return acc;
    }, [] as GroupedShows[]);

    if (sortBy === 'relevance') grouped.sort((a, b) => b.match_score - a.match_score);
    else if (sortBy === 'artist') grouped.sort((a, b) => a.artist_name.localeCompare(b.artist_name));
    else if (sortBy === 'count') grouped.sort((a, b) => b.show_count - a.show_count);
    grouped.forEach(g => g.shows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setGroupedShows(grouped);
  };

  const autoCollapseIfComplete = (groupId: number, updatedShows: Show[]) => {
    const groupShows = sortBy === 'year'
      ? updatedShows.filter(s => new Date(s.date + 'T12:00:00').getFullYear() === groupId)
      : updatedShows.filter(s => s.artist_id === groupId);
    if (groupShows.every(s => s.status === 'added' || s.status === 'skipped')) {
      setExpandedGroups(prev => { const n = new Set(prev); n.delete(groupId); return n; });
    }
  };

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed to update show status');
      const updatedShows = allShows.map(show => show.show_id === showId ? { ...show, status } : show);
      setAllShows(updatedShows);
      return updatedShows;
    } catch (err) {
      alert('Failed to update show. Please try again.');
      return allShows;
    }
  };

  const handleAddShow = async (showId: number) => {
    const updatedShows = await updateShowStatus(showId, 'added');
    const show = updatedShows.find(s => s.show_id === showId);
    if (show) {
      const groupId = sortBy === 'year' ? new Date(show.date + 'T12:00:00').getFullYear() : show.artist_id;
      setTimeout(() => autoCollapseIfComplete(groupId, updatedShows), 100);
    }
  };

  const handleSkipShow = async (showId: number) => {
    const updatedShows = await updateShowStatus(showId, 'skipped');
    const show = updatedShows.find(s => s.show_id === showId);
    if (show) {
      const groupId = sortBy === 'year' ? new Date(show.date + 'T12:00:00').getFullYear() : show.artist_id;
      setTimeout(() => autoCollapseIfComplete(groupId, updatedShows), 100);
    }
  };

  const handleBulkAction = async (groupId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const groupShows = sortBy === 'year'
      ? allShows.filter(s => new Date(s.date + 'T12:00:00').getFullYear() === groupId)
      : allShows.filter(s => s.artist_id === groupId);
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed to bulk update shows');
      const updatedShows = allShows.map(show => groupShows.some(s => s.show_id === show.show_id) ? { ...show, status } : show);
      setAllShows(updatedShows);
      setTimeout(() => autoCollapseIfComplete(groupId, updatedShows), 100);
    } catch (err) { alert('Failed to update shows. Please try again.'); }
  };

  const handleRestAction = async (groupId: number, action: 'add' | 'skip') => {
    const status: 'added' | 'skipped' = action === 'add' ? 'added' : 'skipped';
    const groupShows = sortBy === 'year'
      ? allShows.filter(s => new Date(s.date + 'T12:00:00').getFullYear() === groupId && s.status === 'pending')
      : allShows.filter(s => s.artist_id === groupId && s.status === 'pending');
    if (groupShows.length === 0) return;
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status, source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed to bulk update shows');
      const updatedShows = allShows.map(show => groupShows.some(s => s.show_id === show.show_id) ? { ...show, status } : show);
      setAllShows(updatedShows);
      setTimeout(() => autoCollapseIfComplete(groupId, updatedShows), 100);
    } catch (err) { alert('Failed to update shows. Please try again.'); }
  };

  const handleClearAll = async (groupId: number) => {
    if (!confirm('Clear all reviews for this artist?')) return;
    const groupShows = sortBy === 'year'
      ? allShows.filter(s => new Date(s.date + 'T12:00:00').getFullYear() === groupId)
      : allShows.filter(s => s.artist_id === groupId);
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_ids: groupShows.map(s => s.show_id), status: 'pending', source: 'likely_shows' })
      });
      if (!response.ok) throw new Error('Failed to clear reviews');
      const updatedShows = allShows.map(show => groupShows.some(s => s.show_id === show.show_id) ? { ...show, status: 'pending' as const } : show);
      setAllShows(updatedShows);
    } catch (err) { alert('Failed to clear reviews. Please try again.'); }
  };

  const toggleGroup = (artistId: number) => {
    setExpandedGroups(prev => {
      const n = new Set(prev);
      n.has(artistId) ? n.delete(artistId) : n.add(artistId);
      return n;
    });
  };

  const totalShows = allShows.length;
  const pendingCount = allShows.filter(s => s.status === 'pending').length;
  const addedCount = allShows.filter(s => s.status === 'added').length;
  const skippedCount = allShows.filter(s => s.status === 'skipped').length;
  const reviewedShowsCount = addedCount + skippedCount;
  const totalArtists = new Set(allShows.map(s => s.artist_id)).size;
  const reviewedArtistsCount = new Set(allShows.filter(s => s.status === 'added' || s.status === 'skipped').map(s => s.artist_id)).size;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground text-lg">Loading likely shows...</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
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
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8 flex items-center justify-between sticky top-16 bg-background py-4 z-10">
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-1">Likely Shows You Attended</h1>
              <p className="text-muted-foreground">
                Based on confirmed venues and your Spotify listening history
              </p>
            </div>
            <button
              onClick={() => router.push('/review-summary')}
              className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition whitespace-nowrap ml-4"
            >
              Done Reviewing →
            </button>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Shows Reviewed" value={`${reviewedShowsCount} / ${totalShows}`} />
            <StatCard label="Artists Reviewed" value={`${reviewedArtistsCount} / ${totalArtists}`} />
            <StatCard label="Added" value={addedCount.toLocaleString()} color="green" />
            <StatCard label="Skipped" value={skippedCount.toLocaleString()} color="red" />
          </div>

          {/* Filters & Sort */}
          <div className="bg-card rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-card-foreground">Filters & Sort</h2>
              <button
                onClick={() => { setYearRange([2008, 2025]); setSelectedArtists([]); setSelectedVenues([]); }}
                className="text-sm text-primary hover:text-primary/80 font-medium"
              >
                Clear All
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">
                  Year Range: {yearRange[0]} - {yearRange[1]}
                </label>
                <div className="relative pt-1">
                  <input
                    type="range" min="2008" max={yearRange[1]} value={yearRange[0]}
                    onChange={(e) => setYearRange([parseInt(e.target.value), yearRange[1]])}
                    className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer slider-primary z-20"
                  />
                  <input
                    type="range" min={yearRange[0]} max="2025" value={yearRange[1]}
                    onChange={(e) => setYearRange([yearRange[0], parseInt(e.target.value)])}
                    className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer slider-primary z-20"
                  />
                  <div className="relative h-2 bg-muted rounded-lg">
                    <div
                      className="absolute h-2 bg-primary rounded-lg"
                      style={{
                        left: `${((yearRange[0] - 2008) / (2025 - 2008)) * 100}%`,
                        right: `${100 - ((yearRange[1] - 2008) / (2025 - 2008)) * 100}%`
                      }}
                    />
                  </div>
                </div>
                <style jsx>{`
                  .slider-primary::-webkit-slider-thumb {
                    -webkit-appearance: none; appearance: none;
                    width: 20px; height: 20px; border-radius: 50%;
                    background: oklch(0.65 0.2 240); cursor: pointer;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                  }
                  .slider-primary::-moz-range-thumb {
                    width: 20px; height: 20px; border-radius: 50%;
                    background: oklch(0.65 0.2 240); cursor: pointer;
                    border: none; box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                  }
                `}</style>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-2">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'relevance' | 'artist' | 'count' | 'year')}
                  className="w-full px-3 py-2 border border-input rounded-lg focus:ring-2 focus:ring-primary bg-background text-foreground"
                >
                  <option value="relevance">Relevance (Recommended)</option>
                  <option value="count">Show Count (Most to Least)</option>
                  <option value="artist">Artist Name (A-Z)</option>
                  <option value="year">Year (Newest First)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Shows Table */}
          <div className="bg-card rounded-lg shadow overflow-hidden">
            {groupedShows.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-muted-foreground text-lg">No shows found matching your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {groupedShows.map(group => {
                  const isExpanded = expandedGroups.has(group.artist_id);
                  const addedCount = group.shows.filter(s => s.status === 'added').length;
                  const skippedCount = group.shows.filter(s => s.status === 'skipped').length;
                  const pendingCount = group.shows.filter(s => s.status === 'pending').length;
                  const allAdded = addedCount === group.show_count;
                  const allSkipped = skippedCount === group.show_count;
                  const hasAdded = addedCount > 0;
                  const hasSkipped = skippedCount > 0;
                  const uniqueArtistCount = sortBy === 'year' ? new Set(group.shows.map(s => s.artist_id)).size : null;

                  return (
                    <div key={group.artist_id}>
                      <div className="bg-muted/50 px-6 py-4 flex items-center justify-between hover:bg-muted transition">
                        <button onClick={() => toggleGroup(group.artist_id)} className="flex items-center gap-3 flex-1 text-left">
                          <span className="text-muted-foreground font-mono text-sm">{isExpanded ? '▼' : '▶'}</span>
                          <h3 className="font-semibold text-foreground">
                            {group.artist_name}
                            <span className="text-muted-foreground font-normal">
                              {sortBy === 'year'
                                ? ` (${group.show_count} shows from ${uniqueArtistCount} artists)`
                                : ` (${group.show_count} shows)`
                              }
                            </span>
                          </h3>
                        </button>
                        <div className="flex gap-2">
                          {allAdded ? (
                            <>
                              <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-green-500/10 text-green-600 cursor-default">All Added ✓</button>
                              <button onClick={() => handleClearAll(group.artist_id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition">Clear</button>
                            </>
                          ) : allSkipped ? (
                            <>
                              <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive/10 text-destructive cursor-default">All Skipped ✓</button>
                              <button onClick={() => handleClearAll(group.artist_id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition">Clear</button>
                            </>
                          ) : pendingCount === 0 && hasAdded && hasSkipped ? (
                            <>
                              <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground cursor-default">{addedCount + skippedCount} Reviewed ✓</button>
                              <button onClick={() => handleClearAll(group.artist_id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition">Clear</button>
                            </>
                          ) : hasAdded || hasSkipped ? (
                            <>
                              {hasAdded && hasSkipped ? (
                                <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground cursor-default">{addedCount + skippedCount} Reviewed ✓</button>
                              ) : hasAdded ? (
                                <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-green-500/10 text-green-600 cursor-default">{addedCount} Added ✓</button>
                              ) : (
                                <button disabled className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive/10 text-destructive cursor-default">{skippedCount} Skipped ✓</button>
                              )}
                              <button onClick={() => handleRestAction(group.artist_id, 'add')} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition">Add Rest</button>
                              <button onClick={() => handleRestAction(group.artist_id, 'skip')} className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition">Skip Rest</button>
                              <button onClick={() => handleClearAll(group.artist_id)} className="px-4 py-2 text-sm font-medium rounded-lg bg-muted text-muted-foreground hover:bg-muted/80 transition">Clear</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => handleBulkAction(group.artist_id, 'add')} className="px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition">Add All</button>
                              <button onClick={() => handleBulkAction(group.artist_id, 'skip')} className="px-4 py-2 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition">Skip All</button>
                            </>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <table className="min-w-full">
                          <thead className="bg-muted">
                            <tr>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                              {sortBy === 'year' && <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist</th>}
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Venue</th>
                              <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Status</th>
                              <th className="px-6 py-3 text-center text-xs font-medium text-muted-foreground uppercase">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {group.shows.map(show => (
                              <tr key={show.show_id} className="hover:bg-muted/30">
                                <td className="px-6 py-4 text-sm text-foreground">
                                  {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}
                                </td>
                                {sortBy === 'year' && <td className="px-6 py-4 text-sm text-foreground">{show.artist_name}</td>}
                                <td className="px-6 py-4 text-sm text-foreground">{show.venue_name}</td>
                                <td className="px-6 py-4 text-sm">
                                  {show.status === 'pending' && <span className="text-muted-foreground">Pending Review</span>}
                                  {show.status === 'added' && <span className="text-green-500 font-medium">Added ✓</span>}
                                  {show.status === 'skipped' && <span className="text-destructive font-medium">Skipped ✗</span>}
                                </td>
                                <td className="px-6 py-4 text-sm text-center">
                                  <div className="flex justify-center gap-3">
                                    <button
                                      onClick={() => handleAddShow(show.show_id)}
                                      className={`text-lg ${show.status === 'added' ? 'text-green-500 font-bold' : 'text-green-500 hover:text-green-400 cursor-pointer'}`}
                                      title="Add to My Shows"
                                    >✓</button>
                                    <button
                                      onClick={() => handleSkipShow(show.show_id)}
                                      className={`text-lg ${show.status === 'skipped' ? 'text-destructive font-bold' : 'text-destructive hover:text-destructive/70 cursor-pointer'}`}
                                      title="Skip this show"
                                    >✗</button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Done Reviewing */}
          <div className="mt-8 bg-card rounded-lg shadow p-6 text-center">
            <p className="text-muted-foreground mb-4">
              {pendingCount === 0
                ? 'All shows reviewed! View your results.'
                : `${pendingCount} shows still pending review. You can continue later.`
              }
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

function StatCard({ label, value, color = 'blue' }: { label: string; value: string; color?: 'blue' | 'gray' | 'green' | 'red' }) {
  const colorClasses = { blue: 'text-primary', gray: 'text-muted-foreground', green: 'text-green-500', red: 'text-destructive' };
  return (
    <div className="bg-card rounded-lg shadow p-4">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
