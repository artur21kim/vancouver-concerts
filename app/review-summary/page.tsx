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

  useEffect(() => { fetchSummary(); }, []);

  const fetchSummary = async () => {
    try {
      const response = await fetch('/api/review-summary');
      if (!response.ok) throw new Error('Failed to fetch summary');
      const result = await response.json();
      setSummary(result.data);
    } catch (err) {
      setError('Failed to load summary');
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
            <p className="text-muted-foreground text-lg">Loading your results...</p>
          </div>
        </div>
      </>
    );
  }

  if (error || !summary) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-background py-12 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6">
              <h2 className="text-xl font-bold text-destructive mb-2">Error Loading Summary</h2>
              <p className="text-destructive/80">{error || 'No data available'}</p>
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
      <main className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl font-bold text-foreground mb-3">Your Concert Matching Journey</h1>
            <p className="text-xl text-muted-foreground">
              Here's how your Spotify listening history matched with Vancouver concerts
            </p>
          </div>

          {/* Funnel Stats */}
          <div className="space-y-6 mb-12">
            <div className="bg-card rounded-lg shadow-lg p-6 border-l-4 border-primary">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Step 1: Spotify Match</div>
                  <div className="text-3xl font-bold text-card-foreground">
                    {summary.spotify_matched_shows.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Found based on your Spotify listening history</div>
                </div>
                <div className="text-5xl">🎵</div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="text-4xl text-muted-foreground">↓</div>
            </div>

            <div className="bg-card rounded-lg shadow-lg p-6 border-l-4 border-green-500">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Step 2: Venue Filter</div>
                  <div className="text-3xl font-bold text-card-foreground">
                    {summary.likely_shows_total.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">At venues you've actually attended</div>
                </div>
                <div className="text-5xl">📍</div>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="text-4xl text-muted-foreground">↓</div>
            </div>

            <div className="bg-card rounded-lg shadow-lg p-6 border-l-4 border-secondary">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-muted-foreground mb-1">Step 3: Shows Added</div>
                  <div className="text-3xl font-bold text-card-foreground">
                    {summary.likely_shows_added.toLocaleString()} shows
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Added to your concert history</div>
                </div>
                <div className="text-5xl">✅</div>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
            <div className="bg-primary/10 border border-primary/20 rounded-lg shadow p-6">
              <div className="text-sm font-medium text-primary mb-2">Match Accuracy</div>
              <div className="text-4xl font-bold text-foreground mb-2">{matchAccuracy}%</div>
              <div className="text-sm text-muted-foreground">
                {summary.likely_shows_added} of {summary.likely_shows_total} likely shows added
              </div>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-lg shadow p-6">
              <div className="text-sm font-medium text-green-500 mb-2">Total Concert History</div>
              <div className="text-4xl font-bold text-foreground mb-2">
                {summary.total_shows_in_my_shows.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground">Shows in My Shows (all sources)</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => router.push('/my-shows')}
              className="px-8 py-4 bg-primary text-primary-foreground font-semibold text-lg rounded-lg hover:bg-primary/90 transition"
            >
              View My Shows →
            </button>
            <button
              onClick={() => router.push('/likely-shows')}
              className="px-8 py-4 bg-muted text-muted-foreground font-semibold text-lg rounded-lg hover:bg-muted/80 transition"
            >
              ← Continue Reviewing
            </button>
          </div>

          {completionRate === 100 ? (
            <div className="mt-8 bg-green-500/10 border border-green-500/20 rounded-lg p-6 text-center">
              <div className="text-2xl mb-2">🎉</div>
              <h3 className="text-lg font-semibold text-foreground mb-2">All shows reviewed!</h3>
              <p className="text-muted-foreground">You've reviewed all {summary.likely_shows_total} shows. Great work!</p>
            </div>
          ) : (
            <div className="mt-8 bg-primary/10 border border-primary/20 rounded-lg p-6 text-center">
              <h3 className="text-lg font-semibold text-foreground mb-2">
                {summary.likely_shows_total - summary.likely_shows_added} shows still to review
              </h3>
              <p className="text-muted-foreground">You can continue reviewing anytime. Your progress is saved automatically.</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
