'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function QuestionnairePage() {
  const router = useRouter();
  const supabase = createClient();
  
  // State
  const [year, setYear] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasExistingData, setHasExistingData] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Check auth and existing Spotify data on mount
  useEffect(() => {
    checkUserStatus();
  }, []);

  const checkUserStatus = async () => {
    try {
      // Check if user is logged in
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);

      // If logged in, check for existing Spotify data
      if (currentUser) {
        const { data: existingSongs } = await supabase
          .from('user_spotify_songs')
          .select('id')
          .eq('user_id', currentUser.id)
          .limit(1);

        setHasExistingData(!!(existingSongs && existingSongs.length > 0));
      }
    } catch (err) {
      console.error('Error checking user status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleYearChange = (value: string) => {
    const numValue = value === '' ? '' : parseInt(value);
    
    if (value === '') {
      setYear('');
      setError('');
    } else if (numValue >= 1900 && numValue <= 2025) {
      setYear(numValue);
      setError('');
    } else if (numValue < 1900) {
      setYear(numValue);
      setError('Year must be 1900 or later');
    } else if (numValue > 2025) {
      setYear(numValue);
      setError('Year cannot be in the future');
    }
  };

  const handleSliderChange = (value: number) => {
    setYear(value);
    setError('');
  };

  const handleConnectSpotify = async () => {
    // Validate year
    if (!year || year < 1900 || year > 2025) {
      setError('Please enter a valid year between 1900 and 2025');
      return;
    }

    // Store year in localStorage for use after OAuth callback
    localStorage.setItem('firstConcertYear', year.toString());

    // Check if user is logged in
    if (!user) {
      // Redirect to login with return path
      router.push('/login?return_to=/questionnaire');
      return;
    }

    // Redirect to Spotify OAuth
    // Update this URL to match your Spotify OAuth endpoint
    const spotifyAuthUrl = `/api/auth/spotify?first_concert_year=${year}`;
    router.push(spotifyAuthUrl);
  };

  const handleRerunMatcher = async () => {
    // Clear existing Spotify data
    if (user) {
      await supabase
        .from('user_spotify_songs')
        .delete()
        .eq('user_id', user.id);
    }
    
    setHasExistingData(false);
  };

  const handleViewMatches = () => {
    router.push('/matches'); // Update this route as needed
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // If user has already completed Spotify setup
  if (hasExistingData) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold mb-4">Spotify Already Connected</h1>
          <p className="text-gray-600 mb-8">
            You've already connected your Spotify account and we've matched your listening history to Vancouver concerts.
          </p>
          
          <div className="space-y-4">
            <button
              onClick={handleViewMatches}
              className="w-full bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition"
            >
              View My Matches
            </button>
            
            <button
              onClick={handleRerunMatcher}
              className="w-full bg-gray-200 text-gray-800 px-6 py-3 rounded-lg font-semibold hover:bg-gray-300 transition"
            >
              Re-run Matcher (Refresh Data)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Main questionnaire UI
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold mb-2">Find Your Concert History</h1>
        <p className="text-gray-600 mb-8">
          We'll match your Spotify listening history with Vancouver concerts to help you discover shows you may have attended.
        </p>

        <div className="space-y-6">
          {/* Question */}
          <div>
            <label className="block text-lg font-semibold mb-4">
              What year did you go to your first concert?
            </label>
            
            {/* Text Input */}
            <input
              type="number"
              min="1900"
              max="2025"
              value={year}
              onChange={(e) => handleYearChange(e.target.value)}
              placeholder="Enter year (e.g., 2010)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
            />
            
            {/* Error Message */}
            {error && (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            )}
            
            {/* Range Slider */}
            {year !== '' && (
              <div className="mt-6">
                <div className="flex justify-between text-sm text-gray-600 mb-2">
                  <span>1900</span>
                  <span className="font-semibold">{year}</span>
                  <span>2025</span>
                </div>
                <input
                  type="range"
                  min="1900"
                  max="2025"
                  value={year || 1900}
                  onChange={(e) => handleSliderChange(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>
            )}
          </div>

          {/* Info Box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-800">
              💡 We'll only search for concerts from this year onwards to match your concert-going history.
            </p>
          </div>

          {/* Connect Spotify Button */}
          <button
            onClick={handleConnectSpotify}
            disabled={!year || !!error}
            className={`w-full px-6 py-4 rounded-lg font-semibold text-white text-lg transition flex items-center justify-center gap-3 ${
              !year || !!error
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700'
            }`}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
            </svg>
            Connect with Spotify
          </button>

          {!user && (
            <p className="text-sm text-gray-500 text-center">
              You'll be asked to log in before connecting Spotify
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
