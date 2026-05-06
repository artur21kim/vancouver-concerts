'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

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
  total_shows_count: number;
  total_venues_matched: number;
  top_artists: Artist[];
  all_artists: Artist[];
  all_venues: Venue[];
  duration_seconds: number;
};

type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';
type ArtistView = 'current' | 'all';
type VenueStatus = 'yes' | 'no' | 'not_sure';

const VENUES_PER_PAGE = 10;

const CAPACITY_BUTTONS: {
  key: CapacityFilter;
  label: string;
  tooltip: string;
  textColor: string;
  badgeBg: string;
  badgeText: string;
}[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        textColor: 'text-gray-500',                              badgeBg: 'bg-gray-100 dark:bg-gray-800',   badgeText: 'text-gray-600 dark:text-gray-400'   },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     textColor: 'text-purple-400 dark:text-purple-300',       badgeBg: 'bg-purple-100 dark:bg-purple-900/30', badgeText: 'text-purple-700 dark:text-purple-300' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–1.5K)', textColor: 'text-[#3A8FBD]',                             badgeBg: 'bg-blue-100 dark:bg-blue-900/30',   badgeText: 'text-[#3A8FBD]'  },
  { key: 'large',   label: 'L',   tooltip: 'Large (1.5K–10K)',  textColor: 'text-orange-600 dark:text-orange-400',       badgeBg: 'bg-orange-100 dark:bg-orange-900/30', badgeText: 'text-orange-700 dark:text-orange-400' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    textColor: 'text-rose-600 dark:text-rose-400',           badgeBg: 'bg-rose-100 dark:bg-rose-900/30',   badgeText: 'text-rose-700 dark:text-rose-400'   },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  textColor: 'text-gray-400 dark:text-gray-500',           badgeBg: 'bg-gray-100 dark:bg-gray-800',   badgeText: 'text-gray-500'   },
];

function capacityFilterKey(category: string | null): CapacityFilter {
  if (!category) return 'unknown';
  if (category.toLowerCase().includes('small'))   return 'small';
  if (category.toLowerCase().includes('medium'))  return 'medium';
  if (category.toLowerCase().includes('x-large') || category.toLowerCase().includes('10k')) return 'xlarge';
  if (category.toLowerCase().includes('large'))   return 'large';
  return 'unknown';
}

function CapacityBadge({ category, capacity }: { category: string | null; capacity: number | null }) {
  const key = capacityFilterKey(category);
  const btn = CAPACITY_BUTTONS.find(b => b.key === key)!;
  const capacityText = capacity ? ` · ${capacity.toLocaleString()}` : '';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${btn.badgeBg} ${btn.badgeText}`}>
      {btn.label}{capacityText}
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-muted rounded-full h-1.5 min-w-[60px]">
        <div
          className="bg-primary h-1.5 rounded-full transition-all"
          style={{ width: `${Math.min(score, 100)}%` }}
        />
      </div>
      <span className="text-sm font-semibold text-primary tabular-nums w-12 text-right">
        {score.toFixed(1)}%
      </span>
    </div>
  );
}

export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [matchData, setMatchData] = useState<MatchData | null>(null);

  // Venue state
  const [venueStatuses, setVenueStatuses] = useState<Map<number, VenueStatus>>(new Map());
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [venuePage, setVenuePage] = useState(1);

  // Artist state
  const [artistView, setArtistView] = useState<ArtistView>('current');

  useEffect(() => {
    fetchMatches();
  }, []);

  const fetchMatches = async () => {
    try {
      const response = await fetch('/api/match');
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch matches');
      }
      const result = await response.json();
      // Normalise response — support both old shape (top_venues) and new shape (all_venues)
      const data = {
        ...result.data,
        all_venues: result.data.all_venues ?? result.data.top_venues ?? [],
      };
      setMatchData(data);

      // Pre-populate venue statuses from existing user_status
      const initialStatuses = new Map<number, VenueStatus>();
      const venues = result.data.all_venues ?? result.data.top_venues ?? [];
      venues.forEach((v: Venue) => {
        if (v.user_status) initialStatuses.set(v.venue_id, v.user_status as VenueStatus);
      });
      setVenueStatuses(initialStatuses);
    } catch (err) {
      console.error('Error fetching matches:', err);
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  };

  const handleVenueStatus = useCallback((venueId: number, status: VenueStatus) => {
    setVenueStatuses(prev => {
      const next = new Map(prev);
      // Toggle off if clicking the same status
      if (next.get(venueId) === status) {
        next.delete(venueId);
      } else {
        next.set(venueId, status);
      }
      return next;
    });
  }, []);

  const handleSaveAndContinue = async () => {
    setSaving(true);
    setError('');
    try {
      const confirmations = Array.from(venueStatuses.entries()).map(([venue_id, status]) => ({
        venue_id,
        status,
      }));

      const response = await fetch('/api/venues/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmations }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save confirmations');
      }

      router.push('/likely-shows');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Derived venue data — guard against stale cache returning old shape (top_venues vs all_venues)
  const filteredVenues = matchData && Array.isArray(matchData.all_venues)
    ? matchData.all_venues.filter(v =>
        capacityFilter === 'all' || capacityFilterKey(v.capacity_category) === capacityFilter
      )
    : [];

  const totalVenuePages = Math.ceil(filteredVenues.length / VENUES_PER_PAGE);
  const pagedVenues = filteredVenues.slice(
    (venuePage - 1) * VENUES_PER_PAGE,
    venuePage * VENUES_PER_PAGE
  );

  const confirmedCount = venueStatuses.size;
  const yesCount = Array.from(venueStatuses.values()).filter(s => s === 'yes').length;
  const noCount = Array.from(venueStatuses.values()).filter(s => s === 'no').length;
  const hasConfirmedSome = confirmedCount > 0;

  // Date range display
  const dateRangeValue = matchData
    ? `${matchData.first_concert_year} – ${new Date().getFullYear()}`
    : '—';

  // Artist display
  const displayArtists = matchData
    ? (artistView === 'current' ? matchData.top_artists : matchData.all_artists).slice(0, 15)
    : [];

  if (loading) {
    return (
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
  }

  if (error && !matchData) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-background py-12 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Matches</h2>
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

  if (!matchData) return null;

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-6 md:py-8 px-4">
        <div className="max-w-6xl mx-auto">

          {/* Header */}
          <div className="mb-6 md:mb-8">
            <h1 className="text-2xl md:text-4xl font-bold text-foreground mb-1">Your Matched Shows</h1>
            <p className="text-sm md:text-base text-muted-foreground">
              Based on your Spotify library and Vancouver show data from {matchData.first_concert_year} onwards
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4 mb-6 md:mb-8">
            <StatCard label="Matched Artists" value={matchData.matched_artists_count.toLocaleString()} />
            <StatCard label="Total Shows" value={matchData.total_shows_count.toLocaleString()} />
            <StatCard label="Total Venues" value={matchData.total_venues_matched.toLocaleString()} />
            <StatCard label="Date Range" value={dateRangeValue} />
          </div>

          {/* ── Venues Section ── */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6 mb-6 md:mb-8">

            {/* Venue header row */}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-3">
              <div>
                <h2 className="text-xl md:text-2xl font-bold text-card-foreground">
                  Top Venues
                  <span className="text-sm md:text-base font-normal text-muted-foreground ml-2">
                    ({matchData.total_venues_matched} total)
                  </span>
                </h2>
                <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                  These venues hosted the most shows by artists in your Spotify library
                </p>
                <p className="text-xs md:text-sm text-muted-foreground/70 italic mt-1">
                  We recommend reviewing at least the top 10 venues — but the more you confirm, the better your results.
                </p>
              </div>

              {/* Capacity filter */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs text-muted-foreground hidden md:inline">Size:</span>
                <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                  {CAPACITY_BUTTONS.map(btn => (
                    <button
                      key={btn.key}
                      onClick={() => { setCapacityFilter(btn.key); setVenuePage(1); }}
                      title={btn.tooltip}
                      className={`px-2.5 py-1.5 transition-colors text-xs md:text-sm ${
                        capacityFilter === btn.key
                          ? 'bg-primary text-primary-foreground'
                          : `bg-card ${btn.textColor} hover:bg-muted`
                      }`}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Confirmation summary */}
            {confirmedCount > 0 && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4 bg-muted/50 rounded-lg px-3 py-2">
                <span>{confirmedCount} confirmed</span>
                {yesCount > 0 && <span className="text-green-500 font-medium">✓ {yesCount} attended</span>}
                {noCount > 0 && <span className="text-destructive font-medium">✗ {noCount} never been</span>}
              </div>
            )}

            {/* Venue list */}
            {filteredVenues.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No venues match this filter</p>
            ) : (
              <div className="space-y-2 md:space-y-3">
                {pagedVenues.map((venue, index) => {
                  const globalRank = (venuePage - 1) * VENUES_PER_PAGE + index + 1;
                  const currentStatus = venueStatuses.get(venue.venue_id) ?? null;

                  return (
                    <div
                      key={venue.venue_id}
                      className={`border rounded-lg p-3 md:p-4 transition-colors ${
                        currentStatus === 'yes'
                          ? 'border-green-500/40 bg-green-500/5'
                          : currentStatus === 'no'
                          ? 'border-destructive/30 bg-destructive/5'
                          : currentStatus === 'not_sure'
                          ? 'border-border bg-muted/30'
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      {/* Desktop layout */}
                      <div className="hidden md:flex md:items-center md:gap-4">
                        {/* Rank + name */}
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <span className="text-xl font-bold text-primary flex-shrink-0 w-8 text-center">
                            #{globalRank}
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-semibold text-card-foreground truncate">{venue.venue_name}</h3>
                              <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {venue.total_shows} shows · {venue.unique_artists} artists
                            </p>
                          </div>
                        </div>

                        {/* Score bar */}
                        <div className="w-44 flex-shrink-0">
                          <ScoreBar score={venue.match_score} />
                        </div>

                        {/* Confirmation buttons */}
                        <div className="flex gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'yes')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              currentStatus === 'yes'
                                ? 'bg-green-600 text-white'
                                : 'bg-muted text-muted-foreground hover:bg-green-600/10 hover:text-green-600 border border-border'
                            }`}
                          >
                            ✓ Yes
                          </button>
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'not_sure')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              currentStatus === 'not_sure'
                                ? 'bg-muted border border-foreground/30 text-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80 border border-border'
                            }`}
                          >
                            ? Maybe
                          </button>
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'no')}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              currentStatus === 'no'
                                ? 'bg-destructive text-white'
                                : 'bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive border border-border'
                            }`}
                          >
                            ✗ No
                          </button>
                        </div>
                      </div>

                      {/* Mobile layout */}
                      <div className="md:hidden">
                        <div className="flex items-start gap-2 mb-2">
                          <span className="text-base font-bold text-primary flex-shrink-0 w-7">
                            #{globalRank}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <h3 className="text-sm font-semibold text-card-foreground">{venue.venue_name}</h3>
                              <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {venue.total_shows} shows · {venue.unique_artists} artists
                            </p>
                          </div>
                          <div className="flex-shrink-0 w-20">
                            <ScoreBar score={venue.match_score} />
                          </div>
                        </div>

                        {/* Mobile buttons */}
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'yes')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              currentStatus === 'yes'
                                ? 'bg-green-600 text-white'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            ✓ Yes
                          </button>
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'not_sure')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              currentStatus === 'not_sure'
                                ? 'bg-muted border border-foreground/30 text-foreground'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            ? Maybe
                          </button>
                          <button
                            onClick={() => handleVenueStatus(venue.venue_id, 'no')}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              currentStatus === 'no'
                                ? 'bg-destructive text-white'
                                : 'bg-muted text-muted-foreground border border-border'
                            }`}
                          >
                            ✗ No
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pagination */}
            {totalVenuePages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
                <button
                  onClick={() => setVenuePage(p => Math.max(1, p - 1))}
                  disabled={venuePage === 1}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  ← Previous
                </button>
                <span className="text-sm text-muted-foreground">
                  Page {venuePage} of {totalVenuePages}
                  <span className="hidden md:inline text-muted-foreground/60 ml-1">
                    ({filteredVenues.length} venues total)
                  </span>
                </span>
                <button
                  onClick={() => setVenuePage(p => Math.min(totalVenuePages, p + 1))}
                  disabled={venuePage === totalVenuePages}
                  className="px-3 py-1.5 text-sm border border-border rounded-lg bg-card text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Next →
                </button>
              </div>
            )}

            {/* Save & Continue CTA */}
            <div className="mt-6 pt-4 border-t border-border">
              {error && (
                <div className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <p className="text-xs md:text-sm text-muted-foreground">
                  {hasConfirmedSome
                    ? `${confirmedCount} venue${confirmedCount !== 1 ? 's' : ''} confirmed — you can continue or keep reviewing.`
                    : 'Confirm at least one venue to continue to Likely Shows.'}
                </p>
                <button
                  onClick={handleSaveAndContinue}
                  disabled={!hasConfirmedSome || saving}
                  className={`px-6 py-3 rounded-lg font-semibold text-sm md:text-base transition-colors flex items-center justify-center gap-2 ${
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

          {/* ── Artists Section ── */}
          <div className="bg-card rounded-lg shadow-lg p-4 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-2">
              <h2 className="text-xl md:text-2xl font-bold text-card-foreground">Top Matched Artists</h2>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button
                  onClick={() => setArtistView('current')}
                  className={`px-3 py-1.5 transition-colors ${
                    artistView === 'current'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Current Run
                </button>
                <button
                  onClick={() => setArtistView('all')}
                  className={`px-3 py-1.5 transition-colors ${
                    artistView === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  All Artists
                </button>
              </div>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground mb-4">
              {artistView === 'current'
                ? `Artists with past Vancouver shows since ${matchData.first_concert_year}`
                : `All matched artists who've played in Vancouver since ${matchData.first_concert_year}`}
            </p>

            {displayArtists.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No artists to show — switch to "All Artists" to see your full list
              </p>
            ) : (
              <div className="overflow-x-auto -mx-4 md:mx-0">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-muted">
                      <th className="px-3 md:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-8">#</th>
                      <th className="px-3 md:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Artist</th>
                      <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Songs</th>
                      <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">YVR Shows</th>
                      <th className="px-3 md:px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider pr-4 md:pr-6">Match Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayArtists.map((artist, index) => (
                      <tr key={artist.artist_id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-3 md:px-4 py-3 text-sm font-medium text-muted-foreground">{index + 1}</td>
                        <td className="px-3 md:px-4 py-3 text-sm font-medium text-card-foreground">{artist.artist_name}</td>
                        <td className="px-3 md:px-4 py-3 text-sm text-center text-muted-foreground">{artist.spotify_song_count}</td>
                        <td className="px-3 md:px-4 py-3 text-sm text-center text-muted-foreground">
                          {artistView === 'current' ? artist.vancouver_show_count : artist.vancouver_show_count_all}
                        </td>
                        <td className="px-3 md:px-4 py-3 pr-4 md:pr-6">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 md:w-24 bg-muted rounded-full h-1.5 hidden sm:block">
                              <div
                                className="bg-primary h-1.5 rounded-full"
                                style={{ width: `${Math.min(artistView === 'current' ? artist.match_score : artist.match_score_all, 100)}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-primary tabular-nums">
                              {(artistView === 'current' ? artist.match_score : artist.match_score_all).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
