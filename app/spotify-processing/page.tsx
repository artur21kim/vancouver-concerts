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

  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState('');

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
          const destination = matchScope === 'upcoming' ? '/upcoming-shows' : '/matches';
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

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-background py-12 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-8 text-center">
              <div className="text-6xl mb-4">❌</div>
              <h2 className="text-2xl font-bold text-destructive mb-2">Processing Failed</h2>
              <p className="text-destructive/80 mb-6">{error}</p>
              <button
                onClick={() => router.push('/discover')}
                className="px-6 py-3 bg-destructive text-white font-semibold rounded-lg hover:bg-destructive/90 transition"
              >
                Return to Discover
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
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-2xl w-full">
          <div className="bg-card rounded-lg shadow-lg p-12">
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🎵</div>
              <h1 className="text-3xl font-bold text-card-foreground mb-2">
                Processing Your Spotify Library
              </h1>
              <p className="text-muted-foreground">
                This will take a few minutes. Please don't close this page.
              </p>
            </div>

            {status && (
              <div className="space-y-6">
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
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mt-0.5"></div>
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
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary"></div>
                <p className="text-muted-foreground">Connecting to Spotify...</p>
              </div>
            )}
          </div>

          <div className="mt-6 text-center text-sm text-muted-foreground">
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
