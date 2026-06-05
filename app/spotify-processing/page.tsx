'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navigation from '../components/Navigation';

type SpotifyStatus = {
  status: 'not_connected' | 'pending' | 'processing' | 'complete' | 'error';
  songs_fetched: number;
  total_songs: number;
  progress_percentage: number;
  error_message?: string;
};

function SpotifyProcessingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const matchScope = searchParams.get('match_scope') || 'past';
  const fromDate = searchParams.get('from_date') || null;

  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    startProcessing();
  }, []);

  const startProcessing = async () => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch('/api/spotify/status');
        const statusData: SpotifyStatus = await statusResponse.json();
        setStatus(statusData);

        if (statusData.status === 'complete') {
          clearInterval(pollInterval);
          const destination = matchScope === 'upcoming' ? '/discover/upcoming' : '/matches';
          setTimeout(() => router.push(destination), 1000);
          return;
        }

        if (statusData.status === 'error') {
          clearInterval(pollInterval);
          setError(statusData.error_message || 'Failed to process Spotify library');
          return;
        }

        if (statusData.status === 'pending' || statusData.status === 'processing') {
          const fetchResponse = await fetch('/api/spotify/fetch', { method: 'POST' });
          if (!fetchResponse.ok) throw new Error('Failed to fetch Spotify chunk');
        }
      } catch (err) {
        clearInterval(pollInterval);
        setError('Failed to process Spotify library. Please try reconnecting.');
      }
    }, 3000);

    return () => clearInterval(pollInterval);
  };

  const handleRetry = async () => {
    setResetting(true);
    try {
      const res = await fetch('/api/spotify/reset', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Reset failed');
      }
      // Re-initiate OAuth with the same scope the user originally chose
      const params = new URLSearchParams({ match_scope: matchScope });
      if (fromDate) params.set('from_date', fromDate);
      router.push(`/api/auth/spotify?${params.toString()}`);
    } catch (err) {
      setResetting(false);
      setError(err instanceof Error ? err.message : 'Reset failed. Please try again.');
    }
  };

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-background py-6 md:py-12 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-6 md:p-8 text-center">
              <div className="text-4xl md:text-6xl mb-4">❌</div>
              <h2 className="text-xl md:text-2xl font-bold text-destructive mb-2">Processing Failed</h2>
              <p className="text-destructive/80 mb-6">
                {error === 'Authentication failed (403). Please reconnect Spotify.'
                  ? 'Spotify connection failed — this sometimes happens if your access was added recently. Click Try Again to reconnect.'
                  : error}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  onClick={handleRetry}
                  disabled={resetting}
                  className="px-6 py-3 bg-primary text-primary-foreground font-semibold rounded-lg hover:bg-primary/90 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {resetting && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                  )}
                  {resetting ? 'Resetting...' : 'Try Again'}
                </button>
                <button
                  onClick={() => router.push('/discover')}
                  className="px-6 py-3 bg-card border border-border text-foreground font-semibold rounded-lg hover:bg-muted transition"
                >
                  Return to Discover
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-background py-6 md:py-12 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-card rounded-lg shadow-lg p-6 md:p-12">
            <div className="text-center mb-4 md:mb-8">
              <div className="text-4xl md:text-6xl mb-3 md:mb-4">🎵</div>
              <h1 className="text-xl md:text-3xl font-bold text-card-foreground mb-2">
                Processing Your Spotify Library
              </h1>
              <p className="text-sm md:text-base text-muted-foreground">
                This will take a few minutes. Please don't close this page.
              </p>
            </div>

            {status && (
              <div className="space-y-4 md:space-y-6">
                <div>
                  <div className="flex justify-between text-sm text-muted-foreground mb-2">
                    <span>
                      {status.total_songs > 0
                        ? <>{status.songs_fetched.toLocaleString()} / {status.total_songs.toLocaleString()} songs</>
                        : 'Initializing...'
                      }
                    </span>
                    <span className="font-semibold text-foreground">{status.progress_percentage}%</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-4">
                    <div
                      className="bg-primary h-4 rounded-full transition-all duration-500 ease-out flex items-center justify-end pr-2"
                      style={{ width: `${status.progress_percentage}%` }}
                    >
                      {status.progress_percentage > 10 && (
                        <span className="text-xs text-primary-foreground font-semibold">
                          {status.progress_percentage}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="animate-spin rounded-full h-5 w-5 md:h-6 md:w-6 border-b-2 border-primary mt-0.5 shrink-0"></div>
                    <div className="flex-1">
                      <p className="text-sm text-foreground font-medium">
                        {status.status === 'pending' && 'Starting to fetch your songs...'}
                        {status.status === 'processing' && 'Fetching and analyzing your music library...'}
                        {status.status === 'complete' && '✅ Complete! Redirecting...'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        We're matching your Spotify library with Vancouver show data.
                      </p>
                    </div>
                  </div>
                </div>

                {status.total_songs > 0 && status.status === 'processing' && (
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">
                      Estimated time remaining: ~{Math.ceil((status.total_songs - status.songs_fetched) / 500 * 4)} seconds
                    </p>
                  </div>
                )}
              </div>
            )}

            {!status && (
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 md:h-16 md:w-16 border-b-2 border-primary"></div>
                <p className="text-sm md:text-base text-muted-foreground">Connecting to Spotify...</p>
              </div>
            )}
          </div>

          <div className="mt-4 md:mt-6 text-center text-xs md:text-sm text-muted-foreground px-2">
            <p>💡 Tip: The more songs you have, the better we can match your {matchScope === 'upcoming' ? 'upcoming shows' : 'concert history'}!</p>
          </div>
        </div>
      </div>
    </>
  );
}

export default function SpotifyProcessingPage() {
  return (
    <Suspense fallback={
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
        </div>
      </>
    }>
      <SpotifyProcessingContent />
    </Suspense>
  );
}
