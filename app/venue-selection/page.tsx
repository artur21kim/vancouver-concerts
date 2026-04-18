'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Navigation from '../components/Navigation';

type Venue = {
  venue_id: number;
  venue_name: string;
  total_shows: number;
  unique_artists: number;
  venue_score: number;
};

type VenueConfirmation = {
  venue_id: number;
  status: 'yes' | 'no' | 'not_sure';
};

type SpotifyStatus = {
  status: 'not_connected' | 'pending' | 'processing' | 'complete' | 'error';
  songs_fetched: number;
  total_songs: number;
  progress_percentage: number;
  error_message?: string;
};

export default function VenueSelectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [confirmations, setConfirmations] = useState<Map<number, 'yes' | 'no' | 'not_sure'>>(new Map());
  
  // Spotify processing state
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [processingSpotify, setProcessingSpotify] = useState(false);

  useEffect(() => {
    fetchVenues();
    
    // Check if we just came from Spotify OAuth
    const isProcessingSpotify = searchParams.get('spotify') === 'processing';
    if (isProcessingSpotify) {
      setProcessingSpotify(true);
      startSpotifyProcessing();
    }
  }, [searchParams]);

  const fetchVenues = async () => {
    try {
      const response = await fetch('/api/match');
      
      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      setVenues(result.data.top_venues);
      
      // Initialize all venues as 'not_sure'
      const initialConfirmations = new Map<number, 'yes' | 'no' | 'not_sure'>();
      result.data.top_venues.forEach((venue: Venue) => {
        initialConfirmations.set(venue.venue_id, 'not_sure');
      });
      setConfirmations(initialConfirmations);
      
    } catch (err) {
      console.error('Error fetching venues:', err);
      setError('Failed to load venues. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Start Spotify background processing
  const startSpotifyProcessing = async () => {
    console.log('🚀 Starting Spotify background processing');
    
    // Poll status every 3 seconds
    const pollInterval = setInterval(async () => {
      try {
        // Check status
        const statusResponse = await fetch('/api/spotify/status');
        const status: SpotifyStatus = await statusResponse.json();
        
        setSpotifyStatus(status);
        console.log(`📊 Spotify status: ${status.status} (${status.songs_fetched}/${status.total_songs})`);

        // If complete or error, stop polling
        if (status.status === 'complete') {
          console.log('✅ Spotify processing complete!');
          clearInterval(pollInterval);
          setProcessingSpotify(false);
          return;
        }

        if (status.status === 'error') {
          console.error('❌ Spotify processing error:', status.error_message);
          clearInterval(pollInterval);
          setProcessingSpotify(false);
          setError(`Spotify processing failed: ${status.error_message}`);
          return;
        }

        // If processing or pending, trigger next chunk
        if (status.status === 'processing' || status.status === 'pending') {
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
        console.error('Error in Spotify polling:', err);
        clearInterval(pollInterval);
        setProcessingSpotify(false);
        setError('Failed to process Spotify library. Please try reconnecting.');
      }
    }, 3000); // Poll every 3 seconds

    // Cleanup interval on unmount
    return () => clearInterval(pollInterval);
  };

  const handleVenueConfirmation = (venueId: number, status: 'yes' | 'no' | 'not_sure') => {
    setConfirmations(prev => {
      const newMap = new Map(prev);
      newMap.set(venueId, status);
      return newMap;
    });
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError('');

    try {
      // Convert Map to array of confirmations
      const confirmationsArray: VenueConfirmation[] = Array.from(confirmations.entries()).map(
        ([venue_id, status]) => ({ venue_id, status })
      );

      const response = await fetch('/api/venues/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmations: confirmationsArray })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save confirmations');
      }

      // Redirect to likely seen shows page
      router.push('/likely-shows');
      
    } catch (err) {
      console.error('Error saving confirmations:', err);
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Calculate stats
  const yesCount = Array.from(confirmations.values()).filter(s => s === 'yes').length;
  const noCount = Array.from(confirmations.values()).filter(s => s === 'no').length;
  const notSureCount = Array.from(confirmations.values()).filter(s => s === 'not_sure').length;
  const hasConfirmedSome = yesCount > 0 || noCount > 0;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Loading venues...</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Confirm Your Venues</h1>
            <p className="text-gray-600">
              Help us narrow down your concert history by confirming which venues you've actually attended.
            </p>
          </div>

          {/* Spotify Processing Banner */}
          {processingSpotify && spotifyStatus && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <div className="flex items-center gap-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <div className="flex-1">
                  <h3 className="font-semibold text-blue-900 mb-1">
                    Processing Your Spotify Library
                  </h3>
                  <p className="text-sm text-blue-700">
                    {spotifyStatus.total_songs > 0 ? (
                      <>
                        {spotifyStatus.songs_fetched.toLocaleString()} / {spotifyStatus.total_songs.toLocaleString()} songs 
                        ({spotifyStatus.progress_percentage}%)
                      </>
                    ) : (
                      'Starting...'
                    )}
                  </p>
                  <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
                    <div 
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${spotifyStatus.progress_percentage}%` }}
                    />
                  </div>
                </div>
              </div>
              <p className="text-xs text-blue-600 mt-3">
                This may take a few minutes. You can continue selecting venues while we process your library in the background.
              </p>
            </div>
          )}

          {/* Progress Stats */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{yesCount}</div>
                <div className="text-sm text-gray-600">Attended</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-600">{notSureCount}</div>
                <div className="text-sm text-gray-600">Not Sure</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600">{noCount}</div>
                <div className="text-sm text-gray-600">Never Been</div>
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {/* Venue List */}
          <div className="space-y-4 mb-8">
            {venues.map((venue, index) => {
              const status = confirmations.get(venue.venue_id) || 'not_sure';
              
              return (
                <div 
                  key={venue.venue_id}
                  className="bg-white rounded-lg shadow p-6"
                >
                  <div className="mb-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className="text-xl font-bold text-blue-600">#{index + 1}</span>
                          <h3 className="text-xl font-semibold text-gray-900">{venue.venue_name}</h3>
                        </div>
                        <div className="flex gap-4 text-sm text-gray-600 mt-1 ml-9">
                          <span>{venue.total_shows} shows</span>
                          <span>•</span>
                          <span>{venue.unique_artists} artists</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Selection Buttons */}
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'yes')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'yes'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ✓ Yes, I've been here
                    </button>
                    
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'not_sure')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'not_sure'
                          ? 'bg-gray-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ? Not Sure
                    </button>
                    
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'no')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'no'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ✗ Never been
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Submit Button */}
          <div className="bg-white rounded-lg shadow p-6">
            <button
              onClick={handleSubmit}
              disabled={saving || !hasConfirmedSome}
              className={`w-full px-6 py-4 rounded-lg font-semibold text-white text-lg transition ${
                saving || !hasConfirmedSome
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {saving ? 'Saving...' : 'Continue to Likely Shows →'}
            </button>
            
            {!hasConfirmedSome && (
              <p className="text-sm text-gray-500 text-center mt-3">
                Select at least one "Yes" or "No" to continue
              </p>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
