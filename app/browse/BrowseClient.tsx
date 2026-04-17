'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Select from 'react-select'
import Slider from 'rc-slider'
import 'rc-slider/assets/index.css'
import { useAuth } from '../providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import Navigation from '../components/Navigation'

type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  show_type: string | null
  festival_name: string | null
  artist: {
    artist_id: number
    artist_name: string
    monthly_listeners: number | null
  }
  venue: {
    venue_id: number
    venue_name: string
    capacity: number | null
  }
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

type SortField = 'date' | 'artist' | 'venue'
type SortDirection = 'asc' | 'desc'

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Custom styles for react-select dropdowns
const customSelectStyles = {
  control: (base: any) => ({
    ...base,
    fontSize: '0.875rem'
  }),
  singleValue: (base: any) => ({
    ...base,
    color: '#111827' // text-gray-900 - dark text for selected value
  }),
  placeholder: (base: any) => ({
    ...base,
    color: '#6B7280' // text-gray-500 - medium gray for placeholder
  }),
  option: (base: any) => ({
    ...base,
    color: '#111827' // text-gray-900 - dark text for dropdown options
  })
}

function BrowseContent({
  shows,
  artists,
  venues,
}: {
  shows: Show[]
  artists: Artist[]
  venues: Venue[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user } = useAuth()

  // Get initial filter values from URL params
  const initialArtistId = searchParams.get('artist_id')
  const initialVenueId = searchParams.get('venue_id')
  const urlYear = searchParams.get('year')
  const urlMonth = searchParams.get('month')

  const [selectedArtist, setSelectedArtist] = useState<{ value: number; label: string } | null>(
    initialArtistId
      ? {
        value: parseInt(initialArtistId),
        label: artists.find((a) => a.artist_id === parseInt(initialArtistId))?.artist_name || '',
      }
      : null
  )
  const [selectedVenue, setSelectedVenue] = useState<{ value: number; label: string } | null>(
    initialVenueId
      ? {
        value: parseInt(initialVenueId),
        label: venues.find((v) => v.venue_id === parseInt(initialVenueId))?.venue_name || '',
      }
      : null
  )
  const [selectedShowType, setSelectedShowType] = useState<string | null>(null)
  const [selectedFestival, setSelectedFestival] = useState<{ value: string; label: string } | null>(null)
  
  const [yearRange, setYearRange] = useState<[number | string, number | string]>(() => {
    if (urlYear) {
      const year = parseInt(urlYear)
      return [year, year]
    }
    return [1900, 2025]
  })
  
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const showsPerPage = 50

  // User shows state
  const [userShows, setUserShows] = useState<Set<number>>(new Set())
  const [loadingShows, setLoadingShows] = useState<Set<number>>(new Set())

  // Auto-adjust year range when artist/venue filter changes
  useEffect(() => {
    // Skip if both filters are empty (default state)
    if (!selectedArtist && !selectedVenue) {
      setYearRange([1900, 2025])
      return
    }

    // Calculate the natural date range of filtered shows (before year range filter)
    let relevantShows = shows

    if (selectedArtist) {
      relevantShows = relevantShows.filter((show) => show.artist.artist_id === selectedArtist.value)
    }

    if (selectedVenue) {
      relevantShows = relevantShows.filter((show) => show.venue.venue_id === selectedVenue.value)
    }

    if (relevantShows.length > 0) {
      const years = relevantShows.map(s => new Date(s.date).getFullYear())
      const minYear = Math.min(...years)
      const maxYear = Math.max(...years)
      setYearRange([minYear, maxYear])
    }
  }, [selectedArtist, selectedVenue, shows])

  // Fetch user's shows
  useEffect(() => {
    const fetchUserShows = async () => {
      if (!user) return

      const supabase = createClient()
      const { data } = await supabase
        .from('user_shows')
        .select('show_id')
        .eq('user_id', user.id)

      if (data) {
        setUserShows(new Set(data.map(s => s.show_id)))
      }
    }

    fetchUserShows()
  }, [user])

  const toggleShow = async (showId: number) => {
    if (!user) {
      alert('Please sign in to save shows')
      return
    }

    const supabase = createClient()
    const isAdded = userShows.has(showId)
    setLoadingShows(prev => new Set(prev).add(showId))

    try {
      if (isAdded) {
        await supabase
          .from('user_shows')
          .delete()
          .eq('user_id', user.id)
          .eq('show_id', showId)

        setUserShows(prev => {
          const newSet = new Set(prev)
          newSet.delete(showId)
          return newSet
        })
      } else {
        await supabase
          .from('user_shows')
          .insert({
            user_id: user.id,
            show_id: showId,
            source: 'manual'
          })

        setUserShows(prev => new Set(prev).add(showId))
      }
    } catch (error) {
      console.error('Error toggling show:', error)
    } finally {
      setLoadingShows(prev => {
        const newSet = new Set(prev)
        newSet.delete(showId)
        return newSet
      })
    }
  }

  // Filter and sort shows
  const filteredShows = useMemo(() => {
    let filtered = shows

    // Show Type filter
    if (selectedShowType) {
      if (selectedShowType === 'music') {
        // Include NULL as music (untagged shows assumed to be music)
        filtered = filtered.filter((show) => 
          show.show_type === 'music' || show.show_type === null
        )
      } else {
        // Comedy and Festival are explicit only
        filtered = filtered.filter((show) => show.show_type === selectedShowType)
      }
    }

    if (selectedArtist) {
      filtered = filtered.filter((show) => show.artist.artist_id === selectedArtist.value)
    }

    if (selectedVenue) {
      filtered = filtered.filter((show) => show.venue.venue_id === selectedVenue.value)
    }

    // Festival filter
    if (selectedFestival) {
      filtered = filtered.filter((show) => show.festival_name === selectedFestival.value)
    }

    const startYear = typeof yearRange[0] === 'number' ? yearRange[0] : parseInt(yearRange[0]) || 1900
    const endYear = typeof yearRange[1] === 'number' ? yearRange[1] : parseInt(yearRange[1]) || 2025

    filtered = filtered.filter((show) => {
      const year = new Date(show.date).getFullYear()
      return year >= startYear && year <= endYear
    })

    if (urlMonth) {
      const monthNum = parseInt(urlMonth)
      if (monthNum >= 1 && monthNum <= 12) {
        filtered = filtered.filter((show) => {
          const dateParts = show.date.split('-')
          const showMonth = parseInt(dateParts[1])
          return showMonth === monthNum
        })
      }
    }

    filtered.sort((a, b) => {
      let aVal: any
      let bVal: any

      switch (sortField) {
        case 'date':
          aVal = new Date(a.date).getTime()
          bVal = new Date(b.date).getTime()
          break
        case 'artist':
          aVal = a.artist.artist_name.toLowerCase()
          bVal = b.artist.artist_name.toLowerCase()
          break
        case 'venue':
          aVal = a.venue.venue_name.toLowerCase()
          bVal = b.venue.venue_name.toLowerCase()
          break
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return filtered
  }, [shows, selectedShowType, selectedArtist, selectedVenue, selectedFestival, yearRange, urlMonth, sortField, sortDirection])

  // Calculate stats
  const stats = useMemo(() => {
    const totalShows = filteredShows.length
    const uniqueArtists = new Set(filteredShows.map((s) => s.artist.artist_id)).size
    const uniqueVenues = new Set(filteredShows.map((s) => s.venue.venue_id)).size

    const monthlyListeners = selectedArtist
      ? artists.find((a) => a.artist_id === selectedArtist.value)?.monthly_listeners || null
      : null

    const capacity = selectedVenue
      ? venues.find((v) => v.venue_id === selectedVenue.value)?.capacity || null
      : null

    const sortedByDate = [...filteredShows].sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    )
    const firstShow = sortedByDate.length > 0 ? sortedByDate[0].date : null
    const lastShow = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].date : null

    return {
      totalShows,
      uniqueArtists,
      uniqueVenues,
      monthlyListeners,
      capacity,
      firstShow,
      lastShow,
    }
  }, [filteredShows, selectedArtist, selectedVenue, artists, venues])

  // Pagination
  const totalPages = Math.ceil(filteredShows.length / showsPerPage)
  const currentShows = useMemo(() => {
    const startIndex = (currentPage - 1) * showsPerPage
    return filteredShows.slice(startIndex, startIndex + showsPerPage)
  }, [filteredShows, currentPage])

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
    setCurrentPage(1)
    setPageInput('1')
  }

  // Handle page change
  const handlePageChange = (page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page)
      setPageInput(page.toString())
    }
  }

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInput(e.target.value)
  }

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const page = parseInt(pageInput)
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      setCurrentPage(page)
    } else {
      setPageInput(currentPage.toString())
    }
  }

  // Artist and venue options for react-select
  const artistOptions = artists.map((artist) => ({
    value: artist.artist_id,
    label: artist.artist_name,
  }))

  const venueOptions = venues.map((venue) => ({
    value: venue.venue_id,
    label: venue.venue_name,
  }))

  // Festival options - get unique festival names from shows
  const festivalOptions = useMemo(() => {
    const uniqueFestivals = new Set(
      shows
        .map(show => show.festival_name)
        .filter((name): name is string => name !== null && name !== '')
    )
    return Array.from(uniqueFestivals)
      .sort()
      .map(festival => ({
        value: festival,
        label: festival
      }))
  }, [shows])

  // Dynamic page title
  const pageTitle = useMemo(() => {
    if (urlYear && urlMonth) {
      const monthName = MONTH_NAMES[parseInt(urlMonth) - 1]
      return `Browse: ${monthName} ${urlYear}`
    }
    
    if (selectedArtist && selectedVenue) {
      return `Browse: ${selectedArtist.label} @ ${selectedVenue.label}`
    } else if (selectedArtist) {
      return `Browse: ${selectedArtist.label}`
    } else if (selectedVenue) {
      return `Browse: ${selectedVenue.label}`
    }
    return 'Browse Shows'
  }, [selectedArtist, selectedVenue, urlYear, urlMonth])

  return (
    <>
      <Navigation />
    <main className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        
      {/* Dynamic Header */}
          <h1 className="text-4xl font-bold text-gray-900 mb-6">{pageTitle}</h1>

      {/* Stats Cards */}
      <div className="mb-8">
          {/* Row 1: Always visible */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
            <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
            <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
          </div>

          {/* Row 2: Conditional cards */}
          {(selectedArtist || selectedVenue || stats.firstShow) && (
            <div className="grid grid-cols-3 gap-4">
              {/* Monthly Listeners - only when artist selected */}
              {selectedArtist && stats.monthlyListeners !== null && (
                <StatCard
                  label="Monthly Listeners"
                  value={stats.monthlyListeners.toLocaleString()}
                />
              )}

              {/* Capacity - only when venue selected */}
              {selectedVenue && stats.capacity !== null && (
                <StatCard label="Capacity" value={stats.capacity.toLocaleString()} />
              )}

              {/* First Show */}
              {stats.firstShow && (
                <StatCard
                  label={
                    selectedArtist && !selectedVenue
                      ? 'First Show (Artist)'
                      : selectedVenue && !selectedArtist
                        ? 'First Show (Venue)'
                        : 'First Show'
                  }
                  value={stats.firstShow}
                />
              )}

              {/* Last Show */}
              {stats.lastShow && (
                <StatCard
                  label={
                    selectedArtist && !selectedVenue
                      ? 'Last Show (Artist)'
                      : selectedVenue && !selectedArtist
                        ? 'Last Show (Venue)'
                        : 'Last Show'
                  }
                  value={stats.lastShow}
                />
              )}
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-baseline gap-3 mb-4">
            <h2 className="text-xl font-bold text-gray-900">Filters</h2>
            <button
              onClick={() => {
                setSelectedShowType(null)
                setSelectedArtist(null)
                setSelectedVenue(null)
                setSelectedFestival(null)
                setYearRange([1900, 2025])
                setCurrentPage(1)
                setPageInput('1')
              }}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Clear All
            </button>
          </div>

          {/* Show Type, Artist, Venue, and Festival Filters - 4 columns */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            {/* Show Type Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Show Type</label>
              <select
                value={selectedShowType || ''}
                onChange={(e) => {
                  setSelectedShowType(e.target.value || null)
                  setCurrentPage(1)
                  setPageInput('1')
                }}
                className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="" className="text-gray-500">All Shows</option>
                <option value="music" className="text-gray-900">Music</option>
                <option value="comedy" className="text-gray-900">Comedy</option>
                <option value="festival" className="text-gray-900">Festival</option>
              </select>
            </div>

            {/* Artist Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Artist</label>
              <Select
                instanceId="artist-select"
                options={artistOptions}
                value={selectedArtist}
                onChange={(option) => {
                  setSelectedArtist(option)
                  setCurrentPage(1)
                  setPageInput('1')
                }}
                isClearable
                placeholder="All artists..."
                className="text-sm"
                styles={customSelectStyles}
              />
            </div>

            {/* Venue Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Venue</label>
              <Select
                instanceId="venue-select"
                options={venueOptions}
                value={selectedVenue}
                onChange={(option) => {
                  setSelectedVenue(option)
                  setCurrentPage(1)
                  setPageInput('1')
                }}
                isClearable
                placeholder="All venues..."
                className="text-sm"
                styles={customSelectStyles}
              />
            </div>

            {/* Festival Filter */}
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-2">Festival</label>
              <Select
                instanceId="festival-select"
                options={festivalOptions}
                value={selectedFestival}
                onChange={(option) => {
                  setSelectedFestival(option)
                  setCurrentPage(1)
                  setPageInput('1')
                }}
                isClearable
                placeholder="All festivals..."
                className="text-sm"
                styles={customSelectStyles}
              />
            </div>
          </div>

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
                    e.currentTarget.blur()
                  }
                }}
                min={1900}
                max={2025}
                className="w-20 px-2 py-1 text-sm text-center text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    e.currentTarget.blur()
                  }
                }}
                min={1900}
                max={2025}
                className="w-20 px-2 py-1 text-sm text-center text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
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
        </div>

        {/* Shows Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {user && <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-16"></th>}
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-32"
                    onClick={() => handleSort('date')}
                  >
                    Date {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-80"
                    onClick={() => handleSort('artist')}
                  >
                    Artist {sortField === 'artist' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-64"
                    onClick={() => handleSort('venue')}
                  >
                    Venue {sortField === 'venue' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-48">
                    Festival
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                    Setlist
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {currentShows.map((show) => {
                  const isAdded = userShows.has(show.show_id)
                  const isLoading = loadingShows.has(show.show_id)

                  return (
                    <tr key={show.show_id} className="hover:bg-gray-50">
                      {user && (
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleShow(show.show_id)}
                            disabled={isLoading}
                            className="focus:outline-none disabled:opacity-50"
                            title={isAdded ? 'Remove from My Shows' : 'Add to My Shows'}
                          >
                            {isLoading ? (
                              <div className="w-5 h-5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin"></div>
                            ) : (
                              <svg
                                className={`w-6 h-6 transition-colors ${isAdded
                                    ? 'fill-red-500 text-red-500'
                                    : 'fill-none text-gray-300 hover:text-red-400'
                                  }`}
                                stroke="currentColor"
                                strokeWidth="2"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
                                />
                              </svg>
                            )}
                          </button>
                        </td>
                      )}
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {show.date}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <button
                          onClick={() => {
                            setSelectedArtist({
                              value: show.artist.artist_id,
                              label: show.artist.artist_name,
                            })
                            setCurrentPage(1)
                            setPageInput('1')
                          }}
                          className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                        >
                          {show.artist.artist_name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        <button
                          onClick={() => {
                            setSelectedVenue({
                              value: show.venue.venue_id,
                              label: show.venue.venue_name,
                            })
                            setCurrentPage(1)
                            setPageInput('1')
                          }}
                          className="text-blue-600 hover:text-blue-800 hover:underline text-left"
                        >
                          {show.venue.venue_name}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {show.festival_name || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {show.setlist_url ? (
                          <a 
                            href={show.setlist_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

        {/* Pagination */}
        <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 sm:px-6">
          <div className="flex items-center justify-between">
            <div className="flex-1 flex justify-between sm:hidden">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={currentPage === totalPages}
                className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
            <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-gray-700">
                  Showing{' '}
                  <span className="font-medium">
                    {(currentPage - 1) * showsPerPage + 1}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium">
                    {Math.min(currentPage * showsPerPage, filteredShows.length)}
                  </span>{' '}
                  of <span className="font-medium">{filteredShows.length}</span> results
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  Previous
                </button>

                <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
                  <span className="text-sm text-gray-700">Page</span>
                  <input
                    type="number"
                    min="1"
                    max={totalPages}
                    value={pageInput}
                    onChange={handlePageInputChange}
                    onBlur={() => {
                      const page = parseInt(pageInput)
                      if (isNaN(page) || page < 1 || page > totalPages) {
                        setPageInput(currentPage.toString())
                      }
                    }}
                    className="w-16 px-2 py-1 text-sm text-center text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-700">of {totalPages}</span>
                </form>

                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
        </div>
      </main>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <p className="text-sm text-gray-600 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  )
}

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
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <BrowseContent shows={shows} artists={artists} venues={venues} />
    </Suspense>
  )
}
