'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import AuthModal from '@/app/components/AuthModal';

type MatchScope = 'past' | 'upcoming';

function getVancouverToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export default function Page() {
  const router = useRouter();
  const supabase = createClient();

  const currentYear = new Date().getFullYear();
  const todayVancouver = getVancouverToday(); // YYYY-MM-DD

  const [matchScope, setMatchScope] = useState<MatchScope>('past');
  const [year, setYear] = useState<number | ''>('');
  const [fromDate, setFromDate] = useState<string>(todayVancouver);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [hasExistingData, setHasExistingData] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    checkUserStatus();
  }, []);

  // Re-check user status when auth modal closes in case they just signed in
  const handleAuthModalClose = () => {
    setShowAuthModal(false);
    checkUserStatus();
  };

  const checkUserStatus = async () => {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      setUser(currentUser);

      if (currentUser) {
        const { data: existingSongs } = await supabase
          .from('user_spotify_songs')
          .select('id')
          .eq('user_id', currentUser.id)
          .limit(1);

        setHasExistingData(!!(existingSongs && existingSongs.length > 0));

        // Restore localStorage values if returning from auth modal
        const savedYear = localStorage.getItem('firstConcertYear');
        const savedScope = localStorage.getItem('matchScope') as MatchScope | null;
        if (savedScope) setMatchScope(savedScope);
        if (savedYear) setYear(parseInt(savedYear));
      }
    } catch (err) {
      console.error('Error checking user status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleScopeChange = (scope: MatchScope) => {
    setMatchScope(scope);
    setError('');
  };

  const handleYearChange = (value: string) => {
    if (value === '') {
      setYear('');
      setError('');
      return;
    }

    const numValue = parseInt(value);
    if (isNaN(numValue)) { setError('Please enter a valid year'); return; }

    if (numValue >= 1900 && numValue <= currentYear) {
      setYear(numValue); setError('');
    } else if (numValue < 1900) {
      setYear(numValue); setError('Year must be 1900 or later');
    } else {
      setYear(numValue); setError(`Year cannot be later than ${currentYear}`);
    }
  };

  const isPastValid = matchScope === 'past' && year !== '' && !error && (year as number) >= 1900 && (year as number) <= currentYear;
  const isUpcomingValid = matchScope === 'upcoming' && fromDate !== '';
  const isFormValid = isPastValid || isUpcomingValid;

  const handleConnectSpotify = async () => {
    if (!isFormValid) return;

    if (!user) {
      if (matchScope === 'past') localStorage.setItem('firstConcertYear', year.toString());
      localStorage.setItem('matchScope', matchScope);
      setShowAuthModal(true);
      return;
    }

    try {
      const profileUpdate: Record<string, any> = {};

      // Only write initial_match_scope on first run, never overwrite
      const { data: existingProfile } = await supabase
        .from('user_profiles')
        .select('initial_match_scope')
        .eq('user_id', user.id)
        .single();

      if (!existingProfile?.initial_match_scope) {
        profileUpdate.initial_match_scope = matchScope;
      }

      if (matchScope === 'past') {
        profileUpdate.first_concert_year = year;
      }

      if (Object.keys(profileUpdate).length > 0) {
        const { error: updateError } = await supabase
          .from('user_profiles')
          .update(profileUpdate)
          .eq('user_id', user.id);

        if (updateError) {
          setError('Failed to save preferences. Please try again.');
          return;
        }
      }

      // Build URL params for Spotify auth route
      const params = new URLSearchParams({ match_scope: matchScope });
      if (matchScope === 'past') {
        params.set('first_concert_year', year.toString());
      } else {
        params.set('from_date', fromDate);
      }

      router.push(`/api/auth/spotify?${params.toString()}`);
    } catch (err) {
      setError('An error occurred. Please try again.');
    }
  };

  const handleRerunMatcher = async () => {
    if (user) {
      await supabase.from('user_spotify_songs').delete().eq('user_id', user.id);
    }
    setHasExistingData(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (hasExistingData) {
    return (
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-2xl mx-auto bg-card rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-card-foreground mb-4">Spotify Already Connected</h1>
          <p className="text-foreground mb-8">
            You've already connected your Spotify account and we've matched your library to Vancouver shows.
          </p>
          <div className="space-y-4">
            <button
              onClick={() => router.push('/matches')}
              className="w-full bg-primary text-primary-foreground px-6 py-3 rounded-lg font-semibold hover:bg-primary/90 transition"
            >
              View My Matched Shows
            </button>
            <div>
              <button
                onClick={handleRerunMatcher}
                className="w-full bg-muted text-muted-foreground px-6 py-3 rounded-lg font-semibold hover:bg-muted/80 transition"
              >
                Re-sync Spotify Data
              </button>
              <p className="text-sm text-muted-foreground text-center mt-2">
                Use this if your match results seem incomplete
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const pageTitle = matchScope === 'past' ? 'Find Your Concert History' : 'Find Upcoming Shows';
  const pageSubtitle = matchScope === 'past'
    ? "We'll match your Spotify library with past Vancouver shows to help you discover ones you may have attended."
    : "We'll match your Spotify library with upcoming Vancouver shows to help you discover ones you may have missed.";

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-2xl mx-auto bg-card rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-card-foreground mb-2">{pageTitle}</h1>
        <p className="text-foreground mb-8">{pageSubtitle}</p>

        <div className="space-y-6">

          {/* Scope toggle */}
          <div>
            <label className="block text-lg font-semibold text-card-foreground mb-3">
              What would you like to explore?
            </label>
            <div className="flex rounded-lg border border-input overflow-hidden">
              <button
                onClick={() => handleScopeChange('past')}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold transition ${
                  matchScope === 'past'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted'
                }`}
              >
                Past Shows
              </button>
              <button
                onClick={() => handleScopeChange('upcoming')}
                className={`flex-1 px-4 py-2.5 text-sm font-semibold transition border-l border-input ${
                  matchScope === 'upcoming'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-foreground hover:bg-muted'
                }`}
              >
                Upcoming Shows
              </button>
            </div>
            <p className="text-sm text-foreground/60 italic mt-2">
              Once connected, you can check both past and upcoming shows anytime — choose whichever you'd like to explore first.
            </p>
          </div>

          {/* Conditional field */}
          {matchScope === 'past' ? (
            <div>
              <label className="block text-lg font-semibold text-card-foreground mb-4">
                What year did you go to your first concert?
              </label>

              <input
                type="number"
                min="1900"
                max={currentYear}
                value={year}
                onChange={(e) => handleYearChange(e.target.value)}
                placeholder="Enter year (e.g., 2010)"
                className="w-full px-4 py-3 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-lg"
              />

              {error && <p className="text-destructive text-sm mt-2">{error}</p>}

              {year !== '' && (
                <div className="mt-6">
                  <div className="flex justify-between text-sm text-muted-foreground mb-2">
                    <span>1900</span>
                    <span className="font-semibold text-foreground">{year}</span>
                    <span>{currentYear}</span>
                  </div>
                  <input
                    type="range"
                    min="1900"
                    max={currentYear}
                    value={year || 1900}
                    onChange={(e) => { setYear(parseInt(e.target.value)); setError(''); }}
                    className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
                  />
                </div>
              )}

              <p className="text-sm text-foreground/70 italic mt-4">
                💡 We'll find Vancouver shows with artists from your Spotify library, from this year onwards.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-lg font-semibold text-card-foreground mb-4">
                Find upcoming concerts from when?
              </label>

              <input
                type="date"
                min={todayVancouver}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-4 py-3 border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-primary bg-background text-foreground text-lg"
              />

              <p className="text-sm text-foreground/70 italic mt-4">
                💡 We'll find Vancouver shows with artists from your Spotify library, from this date onwards.
              </p>
            </div>
          )}

          {/* Spotify button */}
          <div
            className="relative"
            onMouseEnter={() => { if (!isFormValid) setShowTooltip(true); }}
            onMouseLeave={() => setShowTooltip(false)}
          >
            {showTooltip && !isFormValid && (
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-3 py-1.5 rounded-md whitespace-nowrap z-10 shadow-lg">
                {matchScope === 'past'
                  ? 'Enter your first concert year to continue'
                  : 'Select a date to continue'}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
              </div>
            )}
            <button
              onClick={handleConnectSpotify}
              disabled={!isFormValid}
              className={`w-full px-6 py-4 rounded-lg font-semibold text-white text-lg transition flex items-center justify-center gap-3 bg-green-600 hover:bg-green-700 ${
                !isFormValid ? 'opacity-75 cursor-not-allowed hover:bg-green-600' : ''
              }`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
              </svg>
              Connect with Spotify
            </button>
          </div>

          {!user && (
            <p className="text-sm text-foreground/60 text-center">
              You'll be asked to log in before connecting Spotify
            </p>
          )}
        </div>
      </div>

      {/* Auth modal — rendered inline so we can open it without a redirect */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={handleAuthModalClose}
      />
    </div>
  );
}
