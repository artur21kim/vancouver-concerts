'use client';

import { Suspense } from 'react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navigation from '../../components/Navigation';

type Show = {
  show_id: number;
  date: string;
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string | null;
  venue_id: number;
  venue_name: string;
  ticketmaster_url: string | null;
  status: 'pending' | 'added' | 'skipped';
  match_score: number;
  spotify_song_count: number;
  vancouver_show_count: number;
  is_spotify_match: boolean;
};

type SortKey = 'date' | 'artist' | 'score';
type Scope = 'spotify' | 'all';

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function UpcomingShowsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pastDestination = searchParams.get('past_destination') || 'matches';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [scope, setScope] = useState<Scope>('spotify');
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [bannerVisible, setBannerVisible] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem('upcoming_banner_dismissed');
    if (!dismissed) setBannerVisible(true);
  }, []);

  useEffect(() => {
    fetchUpcomingShows();
  }, [scope]);

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

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped' | 'pending') => {
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

  const handleHeart = (show: Show) => {
    updateShowStatus(show.show_id, show.status === 'added' ? 'pending' : 'added');
  };

  const handleSkip = (show: Show) => {
    updateShowStatus(show.show_id, show.status === 'skipped' ? 'pending' : 'skipped');
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

  const newMatchedShows   = newShows.filter(s => s.is_spotify_match);
  const newUnmatchedShows = newShows.filter(s => !s.is_spotify_match);

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* Header with view switcher */}
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

            {/* View switcher — prominent tab-style */}
            <div className="flex rounded-xl border border-border overflow-hidden w-fit">
              <button
                className="flex items-center gap-2.5 px-6 py-3 text-sm font-semibold transition bg-primary text-primary-foreground"
                aria-current="page"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Upcoming Shows
              </button>
              <button
                onClick={() => router.push(`/${pastDestination}`)}
                className="flex items-center gap-2.5 px-6 py-3 text-sm font-semibold transition bg-card text-muted-foreground hover:text-foreground hover:bg-muted border-l border-border"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Past Shows
              </button>
            </div>
          </div>

          {/* Dismissible banner */}
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

          {/* Stats + controls row */}
          <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
            <div className="flex gap-4">
              <StatPill label="New"     value={newShows.length}     color="default" />
              <StatPill label="Saved"   value={savedShows.length}   color="green"   />
              <StatPill label="Skipped" value={skippedShows.length} color="muted"   />
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {/* Scope toggle */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button
                  onClick={() => setScope('spotify')}
                  className={`px-3 py-1.5 transition ${
                    scope === 'spotify'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  My Matches
                </button>
                <button
                  onClick={() => setScope('all')}
                  className={`px-3 py-1.5 transition ${
                    scope === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  All Shows
                </button>
              </div>

              {/* Sort */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Sort by</span>
                <div className="flex rounded-lg border border-border overflow-hidden font-medium">
                  {(['date', 'artist', ...(scope === 'spotify' ? ['score'] : [])] as SortKey[]).map(key => (
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
          </div>

          {/* Loading state */}
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

          {/* Error state */}
          {error && !loading && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Shows</h2>
              <p className="text-destructive/80">{error}</p>
              <button
                onClick={fetchUpcomingShows}
                className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90"
              >
                Try Again
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
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

              {/* No shows */}
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

              {/* Spotify scope: single New Shows table */}
              {scope === 'spotify' && newShows.length > 0 && (
                <ShowTable
                  title="New Shows"
                  shows={newShows}
                  onHeart={handleHeart}
                  onSkip={handleSkip}
                  onSaveAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'added')}
                  onSkipAll={() => bulkUpdateStatus(newShows.map(s => s.show_id), 'skipped')}
                  showBulk
                  showSpotifyBadge={false}
                />
              )}

              {/* All scope: split into Spotify Matches + Other Shows */}
              {scope === 'all' && newShows.length > 0 && (
                <>
                  {newMatchedShows.length > 0 && (
                    <ShowTable
                      title="Your Spotify Matches"
                      shows={newMatchedShows}
                      onHeart={handleHeart}
                      onSkip={handleSkip}
                      onSaveAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'added')}
                      onSkipAll={() => bulkUpdateStatus(newMatchedShows.map(s => s.show_id), 'skipped')}
                      showBulk
                      showSpotifyBadge={false}
                      highlightHeader
                    />
                  )}
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

              {/* Skipped — collapsed */}
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

              {/* Bottom nav */}
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
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground text-lg">Loading...</p>
        </div>
      </div>
    }>
      <UpcomingShowsContent />
    </Suspense>
  );
}

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
    <table className="w-full table-fixed">
      <colgroup>
        <col className="w-20" />
        <col className="w-36" />
        <col />
        <col className="w-16" />
      </colgroup>
      <thead className="bg-muted">
        <tr>
          <th className="px-4 py-3"></th>
          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Date</th>
          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist / Venue</th>
          <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">Tickets</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {shows.map(show => (
          <tr
            key={show.show_id}
            className={`hover:bg-muted/30 ${showSpotifyBadge && show.is_spotify_match ? 'bg-primary/5' : ''}`}
          >
            <td className="px-4 py-4">
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
            <td className="px-4 py-4 text-sm text-foreground">{formatDate(show.date)}</td>
            <td className="px-4 py-4">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-sm font-medium truncate ${show.is_spotify_match ? 'text-primary' : 'text-foreground'}`}>
                  {show.artist_name}
                </span>
                {show.spotify_artist_id ? (
                  <a
                    href={`https://open.spotify.com/artist/${show.spotify_artist_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in Spotify"
                    className="hover:opacity-70 transition-opacity inline-flex items-center justify-center shrink-0"
                  >
                    <svg
                      className="w-3.5 h-3.5 md:w-4 md:h-4"
                      viewBox="0 0 24 24"
                      fill={show.is_spotify_match ? '#1DB954' : 'currentColor'}
                      style={show.is_spotify_match ? {} : { color: 'var(--muted-foreground)', opacity: 0.4 }}
                    >
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                  </a>
                ) : null}
                {showSpotifyBadge && show.is_spotify_match && (
                  <span className="text-xs text-green-500 font-medium shrink-0">● match</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">{show.venue_name}</div>
            </td>
            <td className="px-4 py-4 text-center">
              {show.ticketmaster_url ? (
                <a
                  href={show.ticketmaster_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Buy tickets on Ticketmaster"
                  className="hover:opacity-70 transition-opacity inline-flex items-center justify-center"
                >
                  <img
                    src="https://www.ticketmaster.ca/favicon.ico"
                    alt="Ticketmaster"
                    className="w-4 h-4"
                  />
                </a>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </td>
          </tr>
        ))}
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
