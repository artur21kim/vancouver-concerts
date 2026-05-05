'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Navigation from '@/app/components/Navigation';

export default function PastDiscoverSetupPage() {
  const router = useRouter();
  const supabase = createClient();

  const currentYear = new Date().getFullYear();

  const [year, setYear] = useState<number | ''>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/');
        return;
      }
      setCheckingAuth(false);
    };
    checkAuth();
  }, []);

  const handleYearChange = (value: string) => {
    if (value === '') { setYear(''); setError(''); return; }
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

  const isFormValid = year !== '' && !error && (year as number) >= 1900 && (year as number) <= currentYear;

  const handleSubmit = async () => {
    if (!isFormValid) return;
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ first_concert_year: year })
        .eq('user_id', user.id);

      if (updateError) {
        setError('Failed to save your preferences. Please try again.');
        setLoading(false);
        return;
      }

      router.push('/matches');
    } catch (err) {
      setError('An error occurred. Please try again.');
      setLoading(false);
    }
  };

  if (checkingAuth) return null;

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-background py-12 px-4">
        <div className="max-w-2xl mx-auto bg-card rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-card-foreground mb-2">
            Discover Your Concert History
          </h1>
          <p className="text-foreground mb-8">
            We'll match your Spotify library with past Vancouver shows to help you discover ones you may have attended.
          </p>

          <div className="space-y-6">

            {/* Scope toggle — read-only, Past selected */}
            <div>
              <label className="block text-lg font-semibold text-card-foreground mb-3">
                What would you like to explore?
              </label>
              <div className="flex rounded-lg border border-input overflow-hidden">
                <button
                  disabled
                  className="flex-1 px-4 py-2.5 text-sm font-semibold bg-primary text-primary-foreground"
                >
                  Past Shows
                </button>
                <button
                  onClick={() => router.back()}
                  className="flex-1 px-4 py-2.5 text-sm font-semibold transition border-l border-input bg-background text-foreground hover:bg-muted"
                >
                  Upcoming Shows
                </button>
              </div>
              <p className="text-sm text-foreground/60 italic mt-2">
                Once connected, you can check both past and upcoming shows anytime — choose whichever you'd like to explore first.
              </p>
            </div>

            {/* Year input */}
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
                autoFocus
              />
              {error && <p className="text-destructive text-sm mt-2">{error}</p>}
              {year !== '' && !error && (
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

            {/* Submit button */}
            <div
              className="relative"
              onMouseEnter={() => { if (!isFormValid) setShowTooltip(true); }}
              onMouseLeave={() => setShowTooltip(false)}
            >
              {showTooltip && !isFormValid && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm px-3 py-1.5 rounded-md whitespace-nowrap z-10 shadow-lg">
                  Enter your first concert year to continue
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                </div>
              )}
              <button
                onClick={handleSubmit}
                disabled={!isFormValid || loading}
                className={`w-full px-6 py-4 rounded-lg font-semibold text-white text-lg transition flex items-center justify-center gap-3 bg-primary hover:bg-primary/90 ${
                  !isFormValid || loading ? 'opacity-75 cursor-not-allowed hover:bg-primary' : ''
                }`}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                    Starting...
                  </>
                ) : (
                  'Discover My Concert History'
                )}
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
}
