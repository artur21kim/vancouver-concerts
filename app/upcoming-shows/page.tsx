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

type SortKey = 'date' | 'artist' | 'score';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// Shared column widths across all tables
const COL_DATE    = 'w-36';
const COL_ARTIST  = 'w-56';
const COL_VENUE   = 'w-64';  // capped so actions stay close to content
const COL_ACTIONS = 'w-48';  // wide enough for badge + Undo on one line

export default function UpcomingShowsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('upcoming_banner_dismissed');
    if (!dismissed) setBannerVisible(true);
    fetchUpcomingShows();
  }, []);

  const fetchUpcomingShows = async () => {
    try {
      const response = await fetch('/api/upcoming-shows');
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

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status, source: 'upcoming_shows' }),
      });
      if (!response.ok) throw new Error('Failed to update show status');
      setAllShows(prev => prev.map(s => s.show_id === showId ? { ...s, status } : s));
    } catch {
      alert('Failed to update show. Please try again.');
    }
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
    } catch {
      alert('Failed to update shows. Please try again.');
    }
  };

  const undoShowStatus = async (showId: number) => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status: 'pending', source: 'upcoming_shows' }),
      });
      if (!response.ok) throw new Error('Failed to undo show status');
      setAllShows(prev => prev.map(s => s.show_id === showId ? { ...s, status: 'pending' } : s));
    } catch {
      alert('Failed to undo. Please try again.');
    }
  };

  const sortShows = (shows: Show[]) => {
    return [...shows].sort((a, b) => {
      if (sortBy === 'date')   return new Date(a.date).getTime() - new Date(b.date).getTime();
      if (sortBy === 'artist') return a.artist_name.localeCompare(b.artist_name);
      if (sortBy === 'score')  return b.match_score - a.match_score;
      return 0;
    });
  };

  const newShows     = sortShows(allShows.filter(s => s.status === 'pending'));
  const savedShows   = sortShows(allShows.filter(s => s.status === 'added'));
  const skippedShows = sortShows(allShows.filter(s => s.status === 'skipped'));
  const allReviewed  = allShows.length > 0 && newShows.length === 0;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground text-lg">Finding upcoming shows for you...</p>
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
          <div className="max-w-7xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Shows</h2>
              <p className="text-destructive/80">{error}</p>
              <button
                onClick={() => router.push('/discover')}
                className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90"
              >
                Back to Discover
              </button>
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
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-1">Upcoming Shows For You</h1>
            <p className="text-muted-foreground">
              Based on your Spotify library and upcoming Vancouver shows
            </p>
          </div>

          {/* Dismissible banner — no empty space when closed */}
          {bannerVisible && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg px-4 py-3 mb-6 flex items-start justify-between gap-4">
              <p className="text-sm text-foreground">
                💡 Your matches update automatically — come back any time to see new upcoming shows based on your Spotify library. Your saved and skipped choices are remembered.
              </p>
              <button
                onClick={dismissBanner}
                className="text-muted-foreground hover:text-foreground transition shrink-0 text-lg leading-none"
                title="Close"
              >
                ×
              </button>
            </div>
          )}

          {/* Stats + Sort row */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex gap-4">
              <StatPill label="New"     value={newShows.length}     color="default" />
              <StatPill label="Saved"   value={savedShows.length}   color="green"   />
              <StatPill label="Skipped" value={skippedShows.length} color="muted"   />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Sort by</span>
              <div className="flex rounded-lg border border-border overflow-hidden font-medium">
                {(['date', 'artist', 'score'] as SortKey[]).map(key => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`px-3 py-1.5 transition ${
                      sortBy === key
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    {key === 'score' ? 'Match' : key === 'date' ? 'Date' : 'Artist'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Completion banner */}
          {allReviewed && (
            <div className="bg-primary/10 border border-primary/20 rounded-lg p-6 mb-6 text-center">
              <p className="text-foreground font-semibold mb-1">You're all set!</p>
              <p className="text-muted-foreground text-sm mb-4">
                Saved shows will appear in My Shows. Check back soon for new upcoming shows.
              </p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={() => router.push('/my-shows')}
                  className="px-5 py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition"
                >
                  View My Shows →
                </button>
                <button
                  onClick={() => router.push('/browse')}
                  className="px-5 py-2 bg-card border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition"
                >
                  Browse All Shows →
                </button>
              </div>
            </div>
          )}

          {/* No shows at all */}
          {allShows.length === 0 && (
            <div className="bg-card rounded-lg shadow p-12 text-center">
              <p className="text-muted-foreground text-lg mb-2">
                No upcoming Vancouver shows found for artists in your Spotify library.
              </p>
              <p className="text-muted-foreground text-sm">Check back soon — new shows are added regularly.</p>
            </div>
          )}

          {/* New Shows */}
          {newShows.length > 0 && (
            <ShowTable
              title="New Shows"
              shows={newShows}
              onSave={(id) => updateShowStatus(id, 'added')}
              onSkip={(id) => updateShowStatus(id, 'skipped')}
              onSaveAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'added')}
              onSkipAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'skipped')}
              showBulk
            />
          )}

          {/* Saved */}
          {savedShows.length > 0 && (
            <ShowTable
              title="Saved"
              shows={savedShows}
              onSave={(id) => updateShowStatus(id, 'added')}
              onSkip={(id) => updateShowStatus(id, 'skipped')}
              onUndo={undoShowStatus}
              reviewed
            />
          )}

          {/* Skipped — collapsed by default */}
          {skippedShows.length > 0 && (
            <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
              <button
                onClick={() => setSkippedOpen(o => !o)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition text-left"
              >
                <span className="font-semibold text-card-foreground">
                  Skipped
                  <span className="text-muted-foreground font-normal ml-2">({skippedShows.length})</span>
                </span>
                <span className="text-muted-foreground font-mono text-sm">{skippedOpen ? '▼' : '▶'}</span>
              </button>
              {skippedOpen && (
                <div className="border-t border-border">
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col className={COL_DATE} />
                      <col className={COL_ARTIST} />
                      <col className={COL_VENUE} />
                      <col className={COL_ACTIONS} />
                    </colgroup>
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist</th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Venue</th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {skippedShows.map(show => (
                        <tr key={show.show_id} className="hover:bg-muted/30">
                          <td className="px-6 py-4 text-sm text-foreground">{formatDate(show.date)}</td>
                          <td className="px-6 py-4 text-sm text-foreground">{show.artist_name}</td>
                          <td className="px-6 py-4 text-sm text-muted-foreground">{show.venue_name}</td>
                          <td className="px-6 py-4 text-sm text-right">
                            <div className="flex justify-end items-center gap-2">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-zinc-600 text-zinc-100">
                                Skipped ✓
                              </span>
                              <button
                                onClick={() => undoShowStatus(show.show_id)}
                                className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition"
                              >
                                Undo
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Bottom nav links */}
          {allShows.length > 0 && !allReviewed && (
            <div className="mt-4 flex justify-center gap-4 text-sm">
              <button
                onClick={() => router.push('/my-shows')}
                className="text-primary hover:text-primary/80 font-medium transition"
              >
                View My Shows →
              </button>
              <button
                onClick={() => router.push('/browse')}
                className="text-primary hover:text-primary/80 font-medium transition"
              >
                Browse All Shows →
              </button>
            </div>
          )}

        </div>
      </main>
    </>
  );
}

function ShowTable({
  title,
  shows,
  onSave,
  onSkip,
  onUndo,
  onSaveAll,
  onSkipAll,
  showBulk = false,
  reviewed = false,
}: {
  title: string;
  shows: Show[];
  onSave: (id: number) => void;
  onSkip: (id: number) => void;
  onUndo?: (id: number) => void;
  onSaveAll?: () => void;
  onSkipAll?: () => void;
  showBulk?: boolean;
  reviewed?: boolean;
}) {
  return (
    <div className="bg-card rounded-lg shadow overflow-hidden mb-6">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h2 className="font-semibold text-card-foreground">
          {title}
          <span className="text-muted-foreground font-normal ml-2">({shows.length})</span>
        </h2>
        {showBulk && onSaveAll && onSkipAll && shows.length > 1 && (
          <div className="flex gap-2">
            <button
              onClick={onSaveAll}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
            >
              Save All
            </button>
            <button
              onClick={onSkipAll}
              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-destructive text-white hover:bg-destructive/90 transition"
            >
              Skip All
            </button>
          </div>
        )}
      </div>
      <table className="w-full table-fixed">
        <colgroup>
          <col className={COL_DATE} />
          <col className={COL_ARTIST} />
          <col className={COL_VENUE} />
          <col className={COL_ACTIONS} />
        </colgroup>
        <thead className="bg-muted">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Venue</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase">
              {reviewed ? 'Status' : 'Actions'}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {shows.map(show => (
            <tr key={show.show_id} className="hover:bg-muted/30">
              <td className="px-6 py-4 text-sm text-foreground">{formatDate(show.date)}</td>
              <td className="px-6 py-4 text-sm text-foreground">{show.artist_name}</td>
              <td className="px-6 py-4 text-sm text-muted-foreground">{show.venue_name}</td>
              <td className="px-6 py-4 text-sm text-right">
                {reviewed ? (
                  <div className="flex justify-end items-center gap-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      show.status === 'added'
                        ? 'bg-green-900/50 text-green-300'
                        : 'bg-zinc-600 text-zinc-100'
                    }`}>
                      {show.status === 'added' ? 'Saved ✓' : 'Skipped ✓'}
                    </span>
                    {onUndo && (
                      <button
                        onClick={() => onUndo(show.show_id)}
                        className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground transition"
                      >
                        Undo
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => onSave(show.show_id)}
                      className="text-xs px-3 py-1 rounded-lg bg-green-600 text-white hover:bg-green-700 transition"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => onSkip(show.show_id)}
                      className="text-xs px-3 py-1 rounded-lg bg-destructive text-white hover:bg-destructive/90 transition"
                    >
                      Skip
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
