'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type SpotifyStatus = {
  status: 'not_connected' | 'pending' | 'processing' | 'complete' | 'error';
  songs_fetched: number;
  total_songs: number;
  progress_percentage: number;
  error_message?: string;
};

export default function SpotifyProcessingPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    startProcessing();
  }, []);

  const startProcessing = async () => {
    console.log('🚀 Starting Spotify processing');
    
    // Poll status and trigger chunks every 3 seconds
    const pollInterval = setInterval(async () => {
      try {
        // Check current status
        const statusResponse = await fetch('/api/spotify/status');
        const statusData: SpotifyStatus = await statusResponse.json();
        
        setStatus(statusData);
        console.log(`📊 Status: ${statusData.status} (${statusData.songs_fetched}/${statusData.total_songs})`);

        // If complete, redirect to venue selection
        if (statusData.status === 'complete') {
          console.log('✅ Processing complete! Redirecting to venue selection...');
          clearInterval(pollInterval);
          
          // Small delay to show 100% before redirect
          setTimeout(() => {
            router.push('/venue-selection');
          }, 1000);
          return;
        }

        // If error, stop polling and show error
        if (statusData.status === 'error') {
          console.error('❌ Processing error:', statusData.error_message);
          clearInterval(pollInterval);
          setError(statusData.error_message || 'Failed to process Spotify library');
          return;
        }

        // If pending or processing, trigger next chunk
        if (statusData.status === 'pending' || statusData.status === 'processing') {
          const fetchResponse = await fetch('/api/spotify/fetch', {
            method: 'POST'
          });
          
          if (!fetchResponse.ok) {
            throw new Error('Failed to fetch Spotify chunk');
          }

          const fetchResult = await fetchResponse.json();
          console.log(`📦 Chunk complete: ${fetchResult.songs_fetched} songs total`);
        }

      } catch (err) {
        console.error('❌ Error in processing:', err);
        clearInterval(pollInterval);
        setError('Failed to process Spotify library. Please try reconnecting.');
      }
    }, 3000); // Poll every 3 seconds

    // Cleanup on unmount
    return () => clearInterval(pollInterval);
  };

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gray-50 py-12 px-4">
          <div className="max-w-2xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-8 text-center">
              <div className="text-6xl mb-4">❌</div>
              <h2 className="text-2xl font-bold text-red-800 mb-2">Processing Failed</h2>
              <p className="text-red-700 mb-6">{error}</p>
              <button
                onClick={() => router.push('/questionnaire')}
                className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition"
              >
                Return to Questionnaire
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="max-w-2xl w-full">
          <div className="bg-white rounded-lg shadow-lg p-12">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">🎵</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                Processing Your Spotify Library
              </h1>
              <p className="text-gray-600">
                This will take a few minutes. Please don't close this page.
              </p>
            </div>

            {/* Progress Section */}
            {status && (
              <div className="space-y-6">
                {/* Progress Bar */}
                <div>
                  <div className="flex justify-between text-sm text-gray-600 mb-2">
                    <span>
                      {status.total_songs > 0 ? (
                        <>
                          {status.songs_fetched.toLocaleString()} / {status.total_songs.toLocaleString()} songs
                        </>
                      ) : (
                        'Initializing...'
                      )}
                    </span>
                    <span className="font-semibold">{status.progress_percentage}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-4">
                    <div 
                      className="bg-blue-600 h-4 rounded-full transition-all duration-500 ease-out flex items-center justify-end pr-2"
                      style={{ width: `${status.progress_percentage}%` }}
                    >
                      {status.progress_percentage > 10 && (
                        <span className="text-xs text-white font-semibold">
                          {status.progress_percentage}%
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status Messages */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500 mt-0.5"></div>
                    <div className="flex-1">
                      <p className="text-sm text-blue-900 font-medium">
                        {status.status === 'pending' && 'Starting to fetch your songs...'}
                        {status.status === 'processing' && 'Fetching and analyzing your music library...'}
                        {status.status === 'complete' && '✅ Complete! Redirecting...'}
                      </p>
                      <p className="text-xs text-blue-700 mt-1">
                        We're matching your listening history with Vancouver concert data.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Estimated Time */}
                {status.total_songs > 0 && status.status === 'processing' && (
                  <div className="text-center">
                    <p className="text-sm text-gray-500">
                      Estimated time remaining: ~{Math.ceil((status.total_songs - status.songs_fetched) / 500 * 4)} seconds
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Loading State (before status arrives) */}
            {!status && (
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
                <p className="text-gray-600">Connecting to Spotify...</p>
              </div>
            )}
          </div>

          {/* Info Footer */}
          <div className="mt-6 text-center text-sm text-gray-500">
            <p>💡 Tip: The more songs you have, the better we can match your concert history!</p>
          </div>
        </div>
      </div>
    </>
  );
}
