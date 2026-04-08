'use client'

import { useState, useMemo, useEffect } from 'react'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import Select from 'react-select'

type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  artist: { artist_id: number; artist_name: string; monthly_listeners: number | null }
  venue: { venue_id: number; venue_name: string; capacity: number | null }
}

type Artist = {
  artist_id: number
  artist_name: string
  monthly_listeners: number | null
}

type Venue = {
  venue_id: number
  venue_name: string
  capacity: number | null
}

type SortColumn = 'date' | 'artist' | 'venue' | null
type SortDirection = 'asc' | 'desc'

export default function BrowseClient({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  // Mounted state for hydration fix
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // State for filters
  const [yearRange, setYearRange] = useState([1900, 2025])
  const [selectedArtist, setSelectedArtist] = useState<{ value: number; label: string } | null>(null)
  const [selectedVenue, setSelectedVenue] = useState<{ value: number; label: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortColumn, setSortColumn] = useState<SortColumn>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const rowsPerPage = 50

  // Handle column header click
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if clicking same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to ascending
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1) // Reset to first page on sort change
  }

  // Filter shows based on current filters
  const filteredShows = useMemo(() => {
    return shows.filter((show) => {
      const year = new Date(show.date).getFullYear()
      const matchesYear = year >= yearRange[0] && year <= yearRange[1]
      const matchesArtist = !selectedArtist || show.artist.artist_id === selectedArtist.value
      const matchesVenue = !selectedVenue || show.venue.venue_id === selectedVenue.value
      return matchesYear && matchesArtist && matchesVenue
    })
  }, [shows, yearRange, selectedArtist, selectedVenue])

  // Sort filtered shows
  const sortedShows = useMemo(() => {
    if (!sortColumn) return filteredShows

    return [...filteredShows].sort((a, b) => {
      let comparison = 0

      switch (sortColumn) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'artist':
          comparison = a.artist.artist_name.localeCompare(b.artist.artist_name)
          break
        case 'venue':
          comparison = a.venue.venue_name.localeCompare(b.venue.venue_name)
          break
      }

      return sortDirection === 'asc' ? comparison : -comparison
    })
  }, [filteredShows, sortColumn, sortDirection])

  // Cascading filter - NO LIMITS, keep all options
  const availableArtists = useMemo(() => {
    const artistIds = new Set(
      shows
        .filter((show) => {
          const year = new Date(show.date).getFullYear()
          return year >= yearRange[0] && year <= yearRange[1]
        })
        .map((show) => show.artist.artist_id)
    )
    return artists
      .filter((a) => artistIds.has(a.artist_id))
      .map((a) => ({ value: a.artist_id, label: a.artist_name }))
  }, [artists, shows, yearRange])

  const availableVenues = useMemo(() => {
    const venueIds = new Set(
      shows
        .filter((show) => {
          const year = new Date(show.date).getFullYear()
          return year >= yearRange[0] && year <= yearRange[1]
        })
        .map((show) => show.venue.venue_id)
    )
    return venues
      .filter((v) => venueIds.has(v.venue_id))
      .map((v) => ({ value: v.venue_id, label: v.venue_name }))
  }, [venues, shows, yearRange])

  // Calculate stats based on filtered data
  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map((s) => s.artist.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map((s) => s.venue.venue_id)).size
    
    // Conditional stats
    const monthlyListeners = selectedArtist
      ? artists.find((a) => a.artist_id === selectedArtist.value)?.monthly_listeners
      : null
    
    const venueCapacity = selectedVenue
      ? venues.find((v) => v.venue_id === selectedVenue.value)?.capacity
      : null

    return { totalShows, uniqueArtists, uniqueVenues, monthlyListeners, venueCapacity }
  }, [filteredShows, selectedArtist, selectedVenue, artists, venues])

  // Pagination (now using sortedShows instead of filteredShows)
  const paginatedShows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return sortedShows.slice(start, start + rowsPerPage)
  }, [sortedShows, currentPage])

  const totalPages = Math.ceil(sortedShows.length / rowsPerPage)

  // Sort indicator component
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <span className="text-gray-400 ml-1">↕</span>
    }
    return <span className="ml-1">{sortDirection === 'asc' ? '↑' : '↓'}</span>
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <h1 className="text-4xl font-bold text-gray-900 mb-8">Browse Shows</h1>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
          <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
          <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          {stats.monthlyListeners && (
            <StatCard label="Monthly Listeners" value={stats.monthlyListeners.toLocaleString()} />
          )}
          {stats.venueCapacity && (
            <StatCard label="Venue Capacity" value={stats.venueCapacity.toLocaleString()} />
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Filters</h2>
          
          {/* Year Range Slider */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Year Range: {yearRange[0]} - {yearRange[1]}
            </label>
            <Slider
              range
              min={1900}
              max={2025}
              value={yearRange}
              onChange={(value) => {
                setYearRange(value as number[])
                setCurrentPage(1)
              }}
              marks={{
                1900: '1900',
                1910: '1910',
                1920: '1920',
                1930: '1930',
                1940: '1940',
                1950: '1950',
                1960: '1960',
                1970: '1970',
                1980: '1980',
                1990: '1990',
                2000: '2000',
                2010: '2010',
                2020: '2020',
                2025: '2025',
              }}
              styles={{
                track: { backgroundColor: '#3b82f6' },
                handle: { borderColor: '#3b82f6' },
              }}
            />
          </div>

          {/* Artist & Venue Dropdowns */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Artist</label>
              {mounted ? (
                <Select
                  instanceId="artist-select"
                  options={availableArtists}
                  value={selectedArtist}
                  onChange={(option) => {
                    setSelectedArtist(option)
                    setCurrentPage(1)
                  }}
                  isClearable
                  placeholder="Search artists..."
                  className="text-sm"
                  filterOption={(option, inputValue) => {
                    // Custom filter for better performance with large lists
                    return option.label.toLowerCase().includes(inputValue.toLowerCase())
                  }}
                  // Key settings for large lists
                  pageSize={50}
                  menuPortalTarget={typeof document !== 'undefined' ? document.body : null}
                  styles={{
                    menuPortal: (base) => ({ ...base, zIndex: 9999 })
                  }}
                />
              ) : (
                <div className="border border-gray-300 rounded px-3 py-2 text-sm text-gray-400">
                  Search artists...
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Venue</label>
              {mounted ? (
                <Select
                  instanceId="venue-select"
                  options={availableVenues}
                  value={selectedVenue}
                  onChange={(option) => {
                    setSelectedVenue(option)
                    setCurrentPage(1)
                  }}
                  isClearable
                  placeholder="Search venues..."
                  className="text-sm"
                />
              ) : (
                <div className="border border-gray-300 rounded px-3 py-2 text-sm text-gray-400">
                  Search venues...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Shows Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    onClick={() => handleSort('date')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-32"
                  >
                    <div className="flex items-center">
                      Date
                      <SortIndicator column="date" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('artist')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-64"
                  >
                    <div className="flex items-center">
                      Artist
                      <SortIndicator column="artist" />
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort('venue')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 select-none w-64"
                  >
                    <div className="flex items-center">
                      Venue
                      <SortIndicator column="venue" />
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                    Setlist
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedShows.map((show) => (
                  <tr key={show.show_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {show.date}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {show.artist.artist_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {show.venue.venue_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {show.setlist_url ? (
                        <a 
                          href={show.setlist_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="bg-gray-50 px-6 py-4 flex items-center justify-between border-t">
              <div className="text-sm text-gray-700">
                Showing {(currentPage - 1) * rowsPerPage + 1} to{' '}
                {Math.min(currentPage * rowsPerPage, sortedShows.length)} of{' '}
                {sortedShows.length} shows
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <span className="px-4 py-2 text-sm text-gray-700">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Stats Card Component
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}