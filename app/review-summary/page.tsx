'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type SummaryData = {
  spotify_matched_shows: number;
  likely_shows_total: number;
  likely_shows_added: number;
  total_shows_in_my_shows: number;
};

export default function ReviewSummaryPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<SummaryData | null>(null);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    try {
      const response = await fetch('/api/review-summary');
      
      if (!response.ok) {
        throw new Error('Failed to fetch summary');
      }

      const result = await response.json();
      setSummary(result.data);
    } catch (err) {
      console.error('Error fetching summary:', err);
      setError('Failed to load summary');
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
            <p className="text-gray-600 text-lg">Loading your results...</p>
          </div>
        </div>
      </>
    );
  }

  if (error || !summary) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gray-50 py-12 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h2 className="text-xl font-bold text-red-800 mb-2">Error Loading Summary</h2>
              <p className="text-red-700">{error || 'No data available'}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const completionRate = summary.likely_shows_total > 0
    ? Math.round((summary.likely_shows_added / summary.likely_shows_total) * 100)
    : 0;

  const matchAccuracy = summary.likely_shows_total > 0
    ? Math.round((summary.likely_shows_added / summary.likely_shows_total) * 100)
    : 0;

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-gray-900 mb-3">Your Concert Matching Journey</h1>
            <p className="text-xl text-gray-600">
              Here's how your Spotify listening history matched with Vancouver concerts
            </p>
          </div>

          {/* Funnel Stats */}
          <div className="space-y-6 mb-12">
            {/* Step 1: Spotify Match */}
            <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-blue-500">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Step 1: Spotify Match</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {summary.spotify_matched_shows.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Found based on your Spotify listening history
                  </div>
                </div>
                <div className="text-5xl">🎵</div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="text-4xl text-gray-400">↓</div>
            </div>

            {/* Step 2: Venue Filter */}
            <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Step 2: Venue Filter</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {summary.likely_shows_total.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    At venues you've actually attended
                  </div>
                </div>
                <div className="text-5xl">📍</div>
              </div>
            </div>

            {/* Arrow */}
            <div className="flex justify-center">
              <div className="text-4xl text-gray-400">↓</div>
            </div>

            {/* Step 3: Your Selection */}
            <div className="bg-white rounded-lg shadow-lg p-6 border-l-4 border-purple-500">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Step 3: Shows Added</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {summary.likely_shows_added.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    Added to your concert history
                  </div>
                </div>
                <div className="text-5xl">✅</div>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow p-6">
              <div className="text-sm font-medium text-blue-800 mb-2">Match Accuracy</div>
              <div className="text-4xl font-bold text-blue-900 mb-2">{matchAccuracy}%</div>
              <div className="text-sm text-blue-700">
                {summary.likely_shows_added} of {summary.likely_shows_total} likely shows added
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow p-6">
              <div className="text-sm font-medium text-green-800 mb-2">Total Concert History</div>
              <div className="text-4xl font-bold text-green-900 mb-2">
                {summary.total_shows_in_my_shows.toLocaleString()}
              </div>
              <div className="text-sm text-green-700">
                Shows in My Shows (all sources)
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => router.push('/my-shows')}
              className="px-8 py-4 bg-blue-600 text-white font-semibold text-lg rounded-lg hover:bg-blue-700 transition"
            >
              View My Shows →
            </button>
            <button
              onClick={() => router.push('/likely-shows')}
              className="px-8 py-4 bg-gray-200 text-gray-700 font-semibold text-lg rounded-lg hover:bg-gray-300 transition"
            >
              ← Continue Reviewing
            </button>
          </div>

          {/* Completion Message */}
          {completionRate === 100 ? (
            <div className="mt-8 bg-green-50 border border-green-200 rounded-lg p-6 text-center">
              <div className="text-2xl mb-2">🎉</div>
              <h3 className="text-lg font-semibold text-green-900 mb-2">
                All shows reviewed!
              </h3>
              <p className="text-green-700">
                You've reviewed all {summary.likely_shows_total} shows. Great work!
              </p>
            </div>
          ) : (
            <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6 text-center">
              <h3 className="text-lg font-semibold text-blue-900 mb-2">
                {summary.likely_shows_total - summary.likely_shows_added} shows still to review
              </h3>
              <p className="text-blue-700">
                You can continue reviewing anytime. Your progress is saved automatically.
              </p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
