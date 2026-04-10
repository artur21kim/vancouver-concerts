'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
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

// Create a new component that uses useSearchParams
function BrowseContent({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  const searchParams = useSearchParams()

  // Mounted state for hydration fix
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  // State for filters
  const [yearRange, setYearRange] = useState<[number | string, number | string]>([1900, 2025])
  const [selectedArtist, setSelectedArtist] = useState<{ value: number; label: string } | null>(null)
  const [selectedVenue, setSelectedVenue] = useState<{ value: number; label: string } | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [sortColumn, setSortColumn] = useState<SortColumn>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const rowsPerPage = 50

  // Handle URL params on mount
  useEffect(() => {
    const artistId = searchParams.get('artist_id')
    const venueId = searchParams.get('venue_id')

    if (artistId) {
      const artist = artists.find(a => a.artist_id === parseInt(artistId))
      if (artist) {
        setSelectedArtist({ value: artist.artist_id, label: artist.artist_name })
      }
    }

    if (venueId) {
      const venue = venues.find(v => v.venue_id === parseInt(venueId))
      if (venue) {
        setSelectedVenue({ value: venue.venue_id, label: venue.venue_name })
      }
    }
  }, [searchParams, artists, venues])

  // Dynamic page title
  const pageTitle = useMemo(() => {
    if (selectedArtist && selectedVenue) {
      return `Browse: ${selectedArtist.label} @ ${selectedVenue.label}`
    }
    if (selectedArtist) {
      return `Browse: ${selectedArtist.label}`
    }
    if (selectedVenue) {
      return `Browse: ${selectedVenue.label}`
    }
    return 'Browse Shows'
  }, [selectedArtist, selectedVenue])

  // Handle column header click
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
    setCurrentPage(1)
    setPageInput('1')
  }

  // Filter shows based on current filters
  const filteredShows = useMemo(() => {
    return shows.filter((show) => {
      const year = new Date(show.date).getFullYear()
      const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
      const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2025
      const matchesYear = year >= startYear && year <= endYear
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
    const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
    const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2025

    const artistIds = new Set(
      shows
        .filter((show) => {
          const year = new Date(show.date).getFullYear()
          return year >= startYear && year <= endYear
        })
        .map((show) => show.artist.artist_id)
    )
    return artists
      .filter((a) => artistIds.has(a.artist_id))
      .map((a) => ({ value: a.artist_id, label: a.artist_name }))
  }, [artists, shows, yearRange])

  const availableVenues = useMemo(() => {
    const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
    const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2025

    const venueIds = new Set(
      shows
        .filter((show) => {
          const year = new Date(show.date).getFullYear()
          return year >= startYear && year <= endYear
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

    // First/Last show dates
    let firstShow = null
    let lastShow = null

    if (filteredShows.length > 0) {
      const sortedByDate = [...filteredShows].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      )
      firstShow = sortedByDate[0].date
      lastShow = sortedByDate[sortedByDate.length - 1].date
    }

    return {
      totalShows,
      uniqueArtists,
      uniqueVenues,
      monthlyListeners,
      venueCapacity,
      firstShow,
      lastShow
    }
  }, [filteredShows, selectedArtist, selectedVenue, artists, venues])

  // Pagination
  const paginatedShows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage
    return sortedShows.slice(start, start + rowsPerPage)
  }, [sortedShows, currentPage])

  const totalPages = Math.ceil(sortedShows.length / rowsPerPage)

  // Update page input when currentPage changes programmatically
  useEffect(() => {
    setPageInput(currentPage.toString())
  }, [currentPage])

  // Handle page input change
  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value)
  }

  // Handle page input submit
  const handlePageInputSubmit = (e: React.FormEvent | React.FocusEvent) => {
    e.preventDefault()
    const pageNum = parseInt(pageInput)
    if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPages) {
      setCurrentPage(pageNum)
    } else {
      // Reset to current page if invalid
      setPageInput(currentPage.toString())
    }
  }

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
        {/* Back to Home Link */}
        <div className="mb-4">
          <a
            href="/"
            className="text-blue-600 hover:text-blue-800 underline text-lg"
          >
            ← Overview
          </a>
        </div>

        {/* Dynamic Header */}
        <h1 className="text-4xl font-bold text-gray-900 mb-8">{pageTitle}</h1>

        {/* Stats Cards */}
        <div className="mb-8">
          {/* Top row - always 3 columns */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
            <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
            <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          </div>

          {/* Second row - conditional stats, also 3 columns max */}
          {(stats.monthlyListeners || stats.venueCapacity || stats.firstShow || stats.lastShow) && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {stats.monthlyListeners && (
                <StatCard label="Monthly Listeners" value={stats.monthlyListeners.toLocaleString()} />
              )}
              {stats.venueCapacity && (
                <StatCard label="Capacity" value={stats.venueCapacity.toLocaleString()} />
              )}
              {stats.firstShow && (
                <StatCard
                  label={selectedArtist ? "First Show (Artist)" : selectedVenue ? "First Show (Venue)" : "First Show"}
                  value={stats.firstShow}
                />
              )}
              {stats.lastShow && (
                <StatCard
                  label={selectedArtist ? "Last Show (Artist)" : selectedVenue ? "Last Show (Venue)" : "Last Show"}
                  value={stats.lastShow}
                />
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4 text-gray-900">Filters</h2>

          {/* Year Range Slider */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <label className="block text-sm font-medium text-gray-900">
                Year Range:
              </label>
              <input
                type="number"
                defaultValue={typeof yearRange[0] === 'number' ? yearRange[0] : 1900}
                onBlur={(e) => {
                  const value = e.target.value
                  const newStart = parseInt(value)
                  if (!isNaN(newStart) && newStart >= 1900 && newStart <= (typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]))) {
                    setYearRange([newStart, yearRange[1]])
                    setCurrentPage(1)
                    setPageInput('1')
                  } else {
                    e.target.value = (typeof yearRange[0] === 'number' ? yearRange[0] : 1900).toString()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur() // Trigger onBlur
                  }
                }}
                min={1900}
                max={2025}
                className="w-20 px-2 py-1 text-sm text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-900">—</span>
              <input
                type="number"
                defaultValue={typeof yearRange[1] === 'number' ? yearRange[1] : 2025}
                onBlur={(e) => {
                  const value = e.target.value
                  const newEnd = parseInt(value)
                  if (!isNaN(newEnd) && newEnd <= 2025 && newEnd >= (typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]))) {
                    setYearRange([yearRange[0], newEnd])
                    setCurrentPage(1)
                    setPageInput('1')
                  } else {
                    e.target.value = (typeof yearRange[1] === 'number' ? yearRange[1] : 2025).toString()
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur() // Trigger onBlur
                  }
                }}
                min={1900}
                max={2025}
                className="w-20 px-2 py-1 text-sm text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <Slider
              range
              min={1900}
              max={2025}
              value={[
                typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900,
                typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2025
              ]}
              onChange={(value) => {
                const vals = value as number[]
                setYearRange([vals[0], vals[1]] as [number, number])
                setCurrentPage(1)
                setPageInput('1')
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
              <label className="block text-sm font-medium text-gray-900 mb-2">Artist</label>
              {mounted ? (
                <Select
                  instanceId="artist-select"
                  options={availableArtists}
                  value={selectedArtist}
                  onChange={(option) => {
                    setSelectedArtist(option)
                    setCurrentPage(1)
                    setPageInput('1')
                  }}
                  isClearable
                  placeholder="Search artists..."
                  className="text-sm"
                  filterOption={(option, inputValue) => {
                    return option.label.toLowerCase().includes(inputValue.toLowerCase())
                  }}
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
              <label className="block text-sm font-medium text-gray-900 mb-2">Venue</label>
              {mounted ? (
                <Select
                  instanceId="venue-select"
                  options={availableVenues}
                  value={selectedVenue}
                  onChange={(option) => {
                    setSelectedVenue(option)
                    setCurrentPage(1)
                    setPageInput('1')
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
                      <button
                        onClick={() => {
                          setSelectedArtist({
                            value: show.artist.artist_id,
                            label: show.artist.artist_name
                          })
                          setCurrentPage(1)
                          setPageInput('1')
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                      >
                        {show.artist.artist_name}
                      </button>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      <button
                        onClick={() => {
                          setSelectedVenue({
                            value: show.venue.venue_id,
                            label: show.venue.venue_name
                          })
                          setCurrentPage(1)
                          setPageInput('1')
                        }}
                        className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                      >
                        {show.venue.venue_name}
                      </button>
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
              <div className="text-sm text-gray-900">
                Showing {((currentPage - 1) * rowsPerPage + 1).toLocaleString()} to{' '}
                {Math.min(currentPage * rowsPerPage, sortedShows.length).toLocaleString()} of{' '}
                {sortedShows.length.toLocaleString()} shows
              </div>
              <div className="flex gap-2 items-center">
                <button
                  onClick={() => {
                    setCurrentPage((p) => Math.max(1, p - 1))
                  }}
                  disabled={currentPage === 1}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Previous
                </button>
                <form onSubmit={handlePageInputSubmit} className="flex items-center gap-2">
                  <span className="text-sm text-gray-900">Page</span>
                  <input
                    type="text"
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onBlur={handlePageInputSubmit}
                    className="w-16 px-2 py-1 text-sm text-center border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-900">of {totalPages.toLocaleString()}</span>
                </form>
                <button
                  onClick={() => {
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }}
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

// Main export with Suspense wrapper
export default function BrowseClient({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 py-8 px-4 flex items-center justify-center">Loading...</div>}>
      <BrowseContent shows={shows} artists={artists} venues={venues} />
    </Suspense>
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