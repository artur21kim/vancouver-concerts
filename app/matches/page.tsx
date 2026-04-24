'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type Artist = {
  artist_id: number;
  artist_name: string;
  spotify_artist_id: string;
  spotify_song_count: number;
  vancouver_show_count: number;
  vancouver_show_count_all: number;
  weighted_score: number;
  weighted_score_all: number;
  has_pending_shows: boolean;
};

type Venue = {
  venue_id: number;
  venue_name: string;
  capacity: number | null;
  capacity_category: string | null;
  total_shows: number;
  unique_artists: number;
  average_artist_score: number;
  venue_score: number;
  user_status: 'yes' | 'no' | 'not_sure' | null;
};

type MatchData = {
  first_concert_year: number;
  matched_artists_count: number;
  total_shows_count: number;
  total_venues_matched: number;
  top_artists: Artist[];
  all_artists: Artist[];
  top_venues: Venue[];
  duration_seconds: number;
};

type CapacityFilter = 'all' | 'small' | 'medium' | 'large' | 'xlarge' | 'unknown';
type ArtistFilter = 'current' | 'all';

const CAPACITY_BUTTONS: {
  key: CapacityFilter;
  label: string;
  tooltip: string;
  textColor: string;      // unselected label color
  badgeBg: string;        // badge background
  badgeText: string;      // badge text color
}[] = [
  { key: 'all',     label: 'All', tooltip: 'All venues',        textColor: 'text-gray-500',   badgeBg: 'bg-gray-100',   badgeText: 'text-gray-600'   },
  { key: 'small',   label: 'S',   tooltip: 'Small (< 500)',     textColor: 'text-purple-600', badgeBg: 'bg-purple-100', badgeText: 'text-purple-700' },
  { key: 'medium',  label: 'M',   tooltip: 'Medium (500–3K)',   textColor: 'text-blue-600',   badgeBg: 'bg-blue-100',   badgeText: 'text-blue-700'   },
  { key: 'large',   label: 'L',   tooltip: 'Large (3K–10K)',    textColor: 'text-orange-600', badgeBg: 'bg-orange-100', badgeText: 'text-orange-700' },
  { key: 'xlarge',  label: 'XL',  tooltip: 'X-Large (10K+)',    textColor: 'text-rose-600',   badgeBg: 'bg-rose-100',   badgeText: 'text-rose-700'   },
  { key: 'unknown', label: '?',   tooltip: 'Unknown capacity',  textColor: 'text-gray-400',   badgeBg: 'bg-gray-100',   badgeText: 'text-gray-500'   },
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

export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchData, setMatchData] = useState<MatchData | null>(null);
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [artistFilter, setArtistFilter] = useState<ArtistFilter>('current');

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
      setMatchData(result.data);
    } catch (err) {
      console.error('Error fetching matches:', err);
      setError(err instanceof Error ? err.message : 'Failed to load matches');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground text-lg">Running matching algorithm...</p>
            <p className="text-muted-foreground text-sm mt-2">This may take a few seconds</p>
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
          <div className="max-w-4xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Matches</h2>
              <p className="text-destructive/80">{error}</p>
              <button
                onClick={() => router.push('/questionnaire')}
                className="mt-4 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90"
              >
                Back to Questionnaire
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!matchData) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-background py-12 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-muted-foreground">No match data available</p>
          </div>
        </div>
      </>
    );
  }

  const confirmedCount = matchData.top_venues.filter(v => v.user_status === 'yes' || v.user_status === 'no').length;

  const filteredVenues = matchData.top_venues.filter(venue => {
    if (capacityFilter === 'all') return true;
    return capacityFilterKey(venue.capacity_category) === capacityFilter;
  });

  const displayArtists = artistFilter === 'current'
    ? matchData.top_artists.filter(a => a.has_pending_shows)
    : matchData.all_artists;

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-foreground mb-2">Your Concert Matches</h1>
            <p className="text-muted-foreground">
              Based on your Spotify listening history and Vancouver concert data from {matchData.first_concert_year} onwards
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Matched Artists" value={matchData.matched_artists_count.toLocaleString()} />
            <StatCard label="Total Shows" value={matchData.total_shows_count.toLocaleString()} />
            <StatCard label="Total Venues" value={matchData.total_venues_matched.toString()} />
            <StatCard label="Processing Time" value={`${matchData.duration_seconds}s`} />
          </div>

          {/* Top Venues */}
          <div className="bg-card rounded-lg shadow-lg p-6 mb-8">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
              <h2 className="text-2xl font-bold text-card-foreground">
                Top 15 Venues (out of {matchData.total_venues_matched} total)
              </h2>
              {/* Capacity filter buttons with colored labels */}
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                {CAPACITY_BUTTONS.map(btn => (
                  <button
                    key={btn.key}
                    onClick={() => setCapacityFilter(btn.key)}
                    title={btn.tooltip}
                    className={`px-3 py-1.5 transition ${
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

            <p className="text-muted-foreground mb-1">
              These venues hosted the most shows by artists in your Spotify library
            </p>
            {confirmedCount > 0 && (
              <p className="text-sm text-muted-foreground mb-4">
                {confirmedCount} venue{confirmedCount !== 1 ? 's' : ''} already confirmed — badges show your previous answers
              </p>
            )}
            {confirmedCount === 0 && <div className="mb-6" />}

            {filteredVenues.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No venues match this filter</p>
            ) : (
              <div className="space-y-4">
                {filteredVenues.map((venue, index) => (
                  <div
                    key={venue.venue_id}
                    className="border border-border rounded-lg p-4 hover:bg-muted/50 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-2xl font-bold text-primary">#{index + 1}</span>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-lg font-semibold text-card-foreground">{venue.venue_name}</h3>
                              {/* Icon-only attendance badges */}
                              {venue.user_status === 'yes' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">
                                  ✓
                                </span>
                              )}
                              {venue.user_status === 'no' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                                  ✗
                                </span>
                              )}
                              {venue.user_status === 'not_sure' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-muted text-muted-foreground">
                                  ?
                                </span>
                              )}
                              {/* Colored capacity badge */}
                              <CapacityBadge category={venue.capacity_category} capacity={venue.capacity} />
                            </div>
                            <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                              <span>{venue.total_shows} shows</span>
                              <span>•</span>
                              <span>{venue.unique_artists} artists</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-muted-foreground">Match Score</div>
                        <div className="text-2xl font-bold text-card-foreground">
                          {venue.venue_score.toFixed(0)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Artists */}
          <div className="bg-card rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
              <h2 className="text-2xl font-bold text-card-foreground">Top Matched Artists</h2>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm font-medium">
                <button
                  onClick={() => setArtistFilter('current')}
                  className={`px-3 py-1.5 transition ${
                    artistFilter === 'current'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  Current Run
                </button>
                <button
                  onClick={() => setArtistFilter('all')}
                  className={`px-3 py-1.5 transition ${
                    artistFilter === 'all'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:bg-muted'
                  }`}
                >
                  All Artists
                </button>
              </div>
            </div>

            <p className="text-muted-foreground mb-6">
              {artistFilter === 'current'
                ? `Artists with shows still pending review since ${matchData.first_concert_year}`
                : `All matched artists who've played in Vancouver since ${matchData.first_concert_year}`
              }
            </p>

            {displayArtists.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                All artist shows have been reviewed — switch to "All Artists" to see your full list
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">#</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Artist</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">Your Songs</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">YVR Shows</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase">Match Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {displayArtists.slice(0, 15).map((artist, index) => (
                      <tr key={artist.artist_id} className="hover:bg-muted/50">
                        <td className="px-4 py-3 text-sm font-medium text-card-foreground">{index + 1}</td>
                        <td className="px-4 py-3 text-sm text-card-foreground">{artist.artist_name}</td>
                        <td className="px-4 py-3 text-sm text-center text-muted-foreground">{artist.spotify_song_count}</td>
                        <td className="px-4 py-3 text-sm text-center text-muted-foreground">
                          {artistFilter === 'current' ? artist.vancouver_show_count : artist.vancouver_show_count_all}
                        </td>
                        <td className="px-4 py-3 text-sm text-center">
                          <span className="font-semibold text-primary">
                            {artistFilter === 'current'
                              ? artist.weighted_score.toFixed(1)
                              : artist.weighted_score_all.toFixed(1)
                            }
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Next Steps */}
          <div className="mt-8 bg-primary/10 border border-primary/20 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">Next Steps</h3>
            <p className="text-muted-foreground mb-4">
              Review the venues above and confirm which ones you've actually attended. This will help us narrow down the specific shows you likely saw!
            </p>
            <button
              onClick={() => router.push('/venue-selection')}
              className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold hover:bg-primary/90"
            >
              Confirm Venues →
            </button>
          </div>
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow p-4">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold text-card-foreground">{value}</p>
    </div>
  );
}
