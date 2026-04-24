'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '../components/Navigation';

type Venue = {
  venue_id: number;
  venue_name: string;
  total_shows: number;
  unique_artists: number;
  venue_score: number;
  user_status: 'yes' | 'no' | 'not_sure' | null;
};

type VenueConfirmation = {
  venue_id: number;
  status: 'yes' | 'no' | 'not_sure';
};

function VenueSelectionContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingMore, setSavingMore] = useState(false);
  const [error, setError] = useState('');
  const [venues, setVenues] = useState<Venue[]>([]);
  const [hasMoreVenues, setHasMoreVenues] = useState(false);
  const [confirmations, setConfirmations] = useState<Map<number, 'yes' | 'no' | 'not_sure'>>(new Map());

  useEffect(() => {
    fetchVenues();
  }, []);

  const fetchVenues = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/match?mode=venue-selection');

      if (!response.ok) {
        throw new Error('Failed to fetch venues');
      }

      const result = await response.json();
      const fetchedVenues: Venue[] = result.data.top_venues;
      setVenues(fetchedVenues);
      setHasMoreVenues(result.data.has_more_venues || false);

      const initialConfirmations = new Map<number, 'yes' | 'no' | 'not_sure'>();
      fetchedVenues.forEach((venue: Venue) => {
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

  const handleVenueConfirmation = (venueId: number, status: 'yes' | 'no' | 'not_sure') => {
    setConfirmations(prev => {
      const newMap = new Map(prev);
      newMap.set(venueId, status);
      return newMap;
    });
  };

  const saveConfirmations = async () => {
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
  };

  const handleContinue = async () => {
    setSaving(true);
    setError('');
    try {
      await saveConfirmations();
      router.push('/likely-shows');
    } catch (err) {
      console.error('Error saving confirmations:', err);
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleReviewMore = async () => {
    setSavingMore(true);
    setError('');
    try {
      await saveConfirmations();
      await fetchVenues();
    } catch (err) {
      console.error('Error saving confirmations:', err);
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setSavingMore(false);
    }
  };

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

  if (venues.length === 0) {
    return (
      <>
        <Navigation />
        <main className="min-h-screen bg-gray-50 py-8 px-4">
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-4xl font-bold text-gray-900 mb-2">Confirm Your Venues</h1>
              <p className="text-gray-600">
                Help us narrow down your concert history by confirming which venues you've actually attended.
              </p>
            </div>
            <div className="bg-white rounded-lg shadow p-8 text-center">
              <div className="text-4xl mb-4">✅</div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">All venues confirmed!</h2>
              <p className="text-gray-600 mb-6">
                You've already reviewed all the top venues. Head to Likely Shows to continue reviewing your concert history.
              </p>
              <button
                onClick={() => router.push('/likely-shows')}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
              >
                Continue to Likely Shows →
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Confirm Your Venues</h1>
            <p className="text-gray-600">
              Help us narrow down your concert history by confirming which venues you've actually attended.
            </p>
          </div>

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

          <div className="space-y-4 mb-8">
            {venues.map((venue, index) => {
              const status = confirmations.get(venue.venue_id) || 'not_sure';
              return (
                <div key={venue.venue_id} className="bg-white rounded-lg shadow p-6">
                  <div className="mb-4">
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
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'yes')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'yes' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ✓ Yes, I've been here
                    </button>
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'not_sure')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'not_sure' ? 'bg-gray-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ? Not Sure
                    </button>
                    <button
                      onClick={() => handleVenueConfirmation(venue.venue_id, 'no')}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition ${
                        status === 'no' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      ✗ Never been
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <button
              onClick={handleContinue}
              disabled={saving || savingMore || !hasConfirmedSome}
              className={`w-full px-6 py-4 rounded-lg font-semibold text-white text-lg transition ${
                saving || savingMore || !hasConfirmedSome
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

            {hasMoreVenues && hasConfirmedSome && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                <button
                  onClick={handleReviewMore}
                  disabled={saving || savingMore}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium disabled:opacity-50"
                >
                  {savingMore ? 'Saving...' : 'Want better results? Review more venues first →'}
                </button>
                <p className="text-xs text-gray-400 mt-1">
                  More venues beyond the top 15 — helpful but not required
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

export default function VenueSelectionPage() {
  return (
    <Suspense fallback={
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Loading...</p>
          </div>
        </div>
      </>
    }>
      <VenueSelectionContent />
    </Suspense>
  );
}
