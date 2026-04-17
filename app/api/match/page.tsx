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
  spotify_score: number;
  vancouver_score: number;
  weighted_score: number;
};

type Venue = {
  venue_id: number;
  venue_name: string;
  total_shows: number;
  unique_artists: number;
  average_artist_score: number;
  venue_score: number;
};

type MatchData = {
  first_concert_year: number;
  matched_artists_count: number;
  total_shows_count: number;
  top_artists: Artist[];
  top_venues: Venue[];
  duration_seconds: number;
};

export default function MatchesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [matchData, setMatchData] = useState<MatchData | null>(null);

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
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Running matching algorithm...</p>
            <p className="text-gray-500 text-sm mt-2">This may take a few seconds</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gray-50 py-12 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h2 className="text-xl font-bold text-red-800 mb-2">Error Loading Matches</h2>
              <p className="text-red-700">{error}</p>
              <button
                onClick={() => router.push('/questionnaire')}
                className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
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
        <div className="min-h-screen bg-gray-50 py-12 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <p className="text-gray-600">No match data available</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Your Concert Matches</h1>
            <p className="text-gray-600">
              Based on your Spotify listening history and Vancouver concert data from {matchData.first_concert_year} onwards
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard 
              label="Matched Artists" 
              value={matchData.matched_artists_count.toLocaleString()} 
            />
            <StatCard 
              label="Total Shows" 
              value={matchData.total_shows_count.toLocaleString()} 
            />
            <StatCard 
              label="Top Venues" 
              value={matchData.top_venues.length.toString()} 
            />
            <StatCard 
              label="Processing Time" 
              value={`${matchData.duration_seconds}s`} 
            />
          </div>

          {/* Top Venues */}
          <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Top Venues You Likely Attended</h2>
            <p className="text-gray-600 mb-6">
              These venues hosted the most shows by artists in your Spotify library
            </p>

            <div className="space-y-4">
              {matchData.top_venues.map((venue, index) => (
                <div 
                  key={venue.venue_id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold text-blue-600">#{index + 1}</span>
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{venue.venue_name}</h3>
                          <div className="flex gap-4 text-sm text-gray-600 mt-1">
                            <span>{venue.total_shows} shows</span>
                            <span>•</span>
                            <span>{venue.unique_artists} artists</span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-500">Match Score</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {venue.venue_score.toFixed(0)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Artists */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Top Matched Artists</h2>
            <p className="text-gray-600 mb-6">
              Artists you listen to most who've played in Vancouver since {matchData.first_concert_year}
            </p>

            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Artist</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Your Songs</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">YVR Shows</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Match Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {matchData.top_artists.slice(0, 15).map((artist, index) => (
                    <tr key={artist.artist_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{index + 1}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{artist.artist_name}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">{artist.spotify_song_count}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-600">{artist.vancouver_show_count}</td>
                      <td className="px-4 py-3 text-sm text-center">
                        <span className="font-semibold text-blue-600">
                          {artist.weighted_score.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Next Steps */}
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">Next Steps</h3>
            <p className="text-blue-800 mb-4">
              Review the venues above and confirm which ones you've actually attended. This will help us narrow down the specific shows you likely saw!
            </p>
            <button
              onClick={() => router.push('/venue-selection')}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
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
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
