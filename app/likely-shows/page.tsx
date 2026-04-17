'use client';

import { useEffect, useState } from 'react';
import Navigation from '../components/Navigation';

type Show = {
  show_id: number;
  date: string;
  artist_id: number;
  artist_name: string;
  venue_id: number;
  venue_name: string;
  status: 'pending' | 'added' | 'skipped';
};

type GroupedShows = {
  artist_id: number;
  artist_name: string;
  show_count: number;
  shows: Show[];
};

export default function LikelyShowsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [allShows, setAllShows] = useState<Show[]>([]);
  const [filteredShows, setFilteredShows] = useState<Show[]>([]);
  const [groupedShows, setGroupedShows] = useState<GroupedShows[]>([]);
  
  // Filter states
  const [yearRange, setYearRange] = useState<[number, number]>([2008, 2025]);
  const [selectedArtists, setSelectedArtists] = useState<number[]>([]);
  const [selectedVenues, setSelectedVenues] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<'artist' | 'count' | 'date'>('artist');

  // Available options for filters
  const [availableArtists, setAvailableArtists] = useState<{ artist_id: number; artist_name: string }[]>([]);
  const [availableVenues, setAvailableVenues] = useState<{ venue_id: number; venue_name: string }[]>([]);

  useEffect(() => {
    fetchLikelyShows();
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [allShows, yearRange, selectedArtists, selectedVenues, sortBy]);

  const fetchLikelyShows = async () => {
    try {
      const response = await fetch('/api/likely-shows');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch shows');
      }

      const result = await response.json();
      const shows = result.data.shows.map((show: any) => ({
        ...show,
        status: 'pending' as const
      }));
      
      setAllShows(shows);
      
      // Extract unique artists and venues for filters
      const artists = Array.from(new Set(shows.map((s: Show) => JSON.stringify({ artist_id: s.artist_id, artist_name: s.artist_name }))))
        .map(str => JSON.parse(str))
        .sort((a, b) => a.artist_name.localeCompare(b.artist_name));
      
      const venues = Array.from(new Set(shows.map((s: Show) => JSON.stringify({ venue_id: s.venue_id, venue_name: s.venue_name }))))
        .map(str => JSON.parse(str))
        .sort((a, b) => a.venue_name.localeCompare(b.venue_name));
      
      setAvailableArtists(artists);
      setAvailableVenues(venues);
      
    } catch (err) {
      console.error('Error fetching likely shows:', err);
      setError(err instanceof Error ? err.message : 'Failed to load shows');
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...allShows];

    // Filter by year range
    filtered = filtered.filter(show => {
      const year = new Date(show.date).getFullYear();
      return year >= yearRange[0] && year <= yearRange[1];
    });

    // Filter by artists
    if (selectedArtists.length > 0) {
      filtered = filtered.filter(show => selectedArtists.includes(show.artist_id));
    }

    // Filter by venues
    if (selectedVenues.length > 0) {
      filtered = filtered.filter(show => selectedVenues.includes(show.venue_id));
    }

    setFilteredShows(filtered);
    groupAndSortShows(filtered);
  };

  const groupAndSortShows = (shows: Show[]) => {
    // Group by artist
    const grouped = shows.reduce((acc, show) => {
      const existing = acc.find(g => g.artist_id === show.artist_id);
      if (existing) {
        existing.shows.push(show);
        existing.show_count++;
      } else {
        acc.push({
          artist_id: show.artist_id,
          artist_name: show.artist_name,
          show_count: 1,
          shows: [show]
        });
      }
      return acc;
    }, [] as GroupedShows[]);

    // Sort groups
    if (sortBy === 'artist') {
      grouped.sort((a, b) => a.artist_name.localeCompare(b.artist_name));
    } else if (sortBy === 'count') {
      grouped.sort((a, b) => b.show_count - a.show_count);
    } else if (sortBy === 'date') {
      // For date sort, sort shows within each group, then sort groups by earliest show
      grouped.forEach(group => {
        group.shows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      });
      grouped.sort((a, b) => new Date(b.shows[0].date).getTime() - new Date(a.shows[0].date).getTime());
    }

    // Sort shows within each group by date (newest first)
    grouped.forEach(group => {
      group.shows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });

    setGroupedShows(grouped);
  };

  const handleAddShow = async (showId: number) => {
    await updateShowStatus(showId, 'added');
  };

  const handleSkipShow = async (showId: number) => {
    await updateShowStatus(showId, 'skipped');
  };

  const updateShowStatus = async (showId: number, status: 'added' | 'skipped') => {
    try {
      const response = await fetch('/api/shows/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_id: showId, status })
      });

      if (!response.ok) {
        throw new Error('Failed to update show status');
      }

      // Update local state
      setAllShows(prev => prev.map(show => 
        show.show_id === showId ? { ...show, status } : show
      ));

    } catch (err) {
      console.error('Error updating show status:', err);
      alert('Failed to update show. Please try again.');
    }
  };

  const handleBulkAction = async (artistId: number, action: 'add' | 'skip') => {
    const status = action === 'add' ? 'added' : 'skipped';
    const artistShows = allShows.filter(s => s.artist_id === artistId);
    
    try {
      const response = await fetch('/api/shows/bulk-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          show_ids: artistShows.map(s => s.show_id),
          status 
        })
      });

      if (!response.ok) {
        throw new Error('Failed to bulk update shows');
      }

      // Update local state
      setAllShows(prev => prev.map(show => 
        artistShows.some(s => s.show_id === show.show_id) ? { ...show, status } : show
      ));

    } catch (err) {
      console.error('Error bulk updating shows:', err);
      alert('Failed to update shows. Please try again.');
    }
  };

  const clearFilters = () => {
    setYearRange([2008, 2025]);
    setSelectedArtists([]);
    setSelectedVenues([]);
  };

  // Calculate stats
  const totalShows = allShows.length;
  const pendingCount = allShows.filter(s => s.status === 'pending').length;
  const addedCount = allShows.filter(s => s.status === 'added').length;
  const skippedCount = allShows.filter(s => s.status === 'skipped').length;

  if (loading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600 text-lg">Loading likely shows...</p>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gray-50 py-12 px-4">
          <div className="max-w-6xl mx-auto">
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h2 className="text-xl font-bold text-red-800 mb-2">Error Loading Shows</h2>
              <p className="text-red-700">{error}</p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Likely Shows You Attended</h1>
            <p className="text-gray-600">
              Based on confirmed venues and your Spotify listening history
            </p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Total Shows" value={totalShows.toLocaleString()} />
            <StatCard label="Pending Review" value={pendingCount.toLocaleString()} color="gray" />
            <StatCard label="Added" value={addedCount.toLocaleString()} color="green" />
            <StatCard label="Skipped" value={skippedCount.toLocaleString()} color="red" />
          </div>

          {/* Filters & Sort */}
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Filters & Sort</h2>
              <button
                onClick={clearFilters}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Clear All
              </button>
            </div>

            <div className="space-y-4">
              {/* Year Range */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Year Range: {yearRange[0]} - {yearRange[1]}
                </label>
                <input
                  type="range"
                  min="2008"
                  max="2025"
                  value={yearRange[1]}
                  onChange={(e) => setYearRange([yearRange[0], parseInt(e.target.value)])}
                  className="w-full"
                />
              </div>

              {/* Sort */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'artist' | 'count' | 'date')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="artist">Artist Name (A-Z)</option>
                  <option value="count">Show Count (Most to Least)</option>
                  <option value="date">Date (Newest to Oldest)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Shows Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {groupedShows.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-gray-500 text-lg">No shows found matching your filters</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {groupedShows.map(group => (
                  <div key={group.artist_id}>
                    {/* Artist Group Header */}
                    <div className="bg-gray-50 px-6 py-4 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">
                        {group.artist_name} <span className="text-gray-500">({group.show_count} shows)</span>
                      </h3>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleBulkAction(group.artist_id, 'add')}
                          className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
                        >
                          Add All
                        </button>
                        <button
                          onClick={() => handleBulkAction(group.artist_id, 'skip')}
                          className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
                        >
                          Skip All
                        </button>
                      </div>
                    </div>

                    {/* Shows Table */}
                    <table className="min-w-full">
                      <thead className="bg-gray-100">
                        <tr>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Venue</th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {group.shows.map(show => (
                          <tr key={show.show_id} className="hover:bg-gray-50">
                            <td className="px-6 py-4 text-sm text-gray-900">
                              {new Date(show.date).toLocaleDateString('en-US', { 
                                year: 'numeric', 
                                month: 'short', 
                                day: 'numeric' 
                              })}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-900">{show.venue_name}</td>
                            <td className="px-6 py-4 text-sm">
                              {show.status === 'pending' && (
                                <span className="text-gray-600">Pending Review</span>
                              )}
                              {show.status === 'added' && (
                                <span className="text-green-600 font-medium">Added ✓</span>
                              )}
                              {show.status === 'skipped' && (
                                <span className="text-red-600 font-medium">Skipped ✗</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={() => handleAddShow(show.show_id)}
                                  disabled={show.status !== 'pending'}
                                  className={`px-3 py-1 rounded ${
                                    show.status === 'pending'
                                      ? 'bg-green-600 text-white hover:bg-green-700'
                                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  }`}
                                >
                                  ✓ Add
                                </button>
                                <button
                                  onClick={() => handleSkipShow(show.show_id)}
                                  disabled={show.status !== 'pending'}
                                  className={`px-3 py-1 rounded ${
                                    show.status === 'pending'
                                      ? 'bg-red-600 text-white hover:bg-red-700'
                                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                                  }`}
                                >
                                  ✗ Skip
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function StatCard({ label, value, color = 'blue' }: { label: string; value: string; color?: 'blue' | 'gray' | 'green' | 'red' }) {
  const colorClasses = {
    blue: 'text-blue-600',
    gray: 'text-gray-600',
    green: 'text-green-600',
    red: 'text-red-600'
  };

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</p>
    </div>
  );
}
