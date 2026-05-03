'use client'

import Navigation from '../components/Navigation'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type Show = {
  show_id: number
  date: string
  setlist_url: string | null
  show_type: string | null
  festival_name: string | null
  added_at: string
  notes: string | null
  source: string | null
  artist: {
    artist_id: number
    artist_name: string
    monthly_listeners: number | null
    spotify_artist_id: string | null
  }
  venue: {
    venue_id: number
    venue_name: string
    capacity: number | null
  }
}

type SortField = 'date' | 'artist' | 'venue' | 'added_at'
type SortDirection = 'asc' | 'desc'

type MyShowsClientProps = {
  shows: Show[]
}

export default function MyShowsClient({ shows: initialShows }: MyShowsClientProps) {
  const router = useRouter()
  const [shows, setShows] = useState(initialShows)
  const [sortField, setSortField] = useState<SortField>('added_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [removingShows, setRemovingShows] = useState<Set<number>>(new Set())
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const showsPerPage = 50

  const removeShow = async (showId: number) => {
    setRemovingShows(prev => new Set(prev).add(showId))

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      await supabase
        .from('user_shows')
        .delete()
        .eq('user_id', user.id)
        .eq('show_id', showId)

      setShows(shows.filter(s => s.show_id !== showId))
    } catch (error) {
      console.error('Error removing show:', error)
    } finally {
      setRemovingShows(prev => {
        const newSet = new Set(prev)
        newSet.delete(showId)
        return newSet
      })
    }
  }

  const sortedShows = useMemo(() => {
    const sorted = [...shows]

    sorted.sort((a, b) => {
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
        case 'added_at':
          aVal = new Date(a.added_at).getTime()
          bVal = new Date(b.added_at).getTime()
          break
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return sorted
  }, [shows, sortField, sortDirection])

  const stats = useMemo(() => {
    const totalShows = shows.length
    const uniqueArtists = new Set(shows.map(s => s.artist.artist_id)).size
    const uniqueVenues = new Set(shows.map(s => s.venue.venue_id)).size
    return { totalShows, uniqueArtists, uniqueVenues }
  }, [shows])

  const totalPages = Math.ceil(sortedShows.length / showsPerPage)
  const currentShows = useMemo(() => {
    const startIndex = (currentPage - 1) * showsPerPage
    return sortedShows.slice(startIndex, startIndex + showsPerPage)
  }, [sortedShows, currentPage])

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

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-7xl mx-auto">

          {/* Header */}
          <h1 className="text-4xl font-bold text-foreground mb-8">My Shows</h1>

          {/* Stats Cards */}
          <div className="mb-8">
            <div className="grid grid-cols-3 gap-4">
              <StatCard label="Shows" value={stats.totalShows.toLocaleString()} />
              <StatCard label="Artists" value={stats.uniqueArtists.toLocaleString()} />
              <StatCard label="Venues" value={stats.uniqueVenues.toLocaleString()} />
            </div>
          </div>

          {shows.length === 0 ? (
            <div className="bg-card rounded-lg shadow-lg p-12 text-center border border-border">
              <p className="text-muted-foreground text-lg mb-4">You haven't added any shows yet!</p>
              <button
                onClick={() => router.push('/browse')}
                className="px-6 py-3 bg-primary text-primary-foreground rounded-md hover:opacity-90 font-medium transition-opacity"
              >
                Browse Shows
              </button>
            </div>
          ) : (
            <div className="bg-card rounded-lg shadow-lg overflow-hidden border border-border">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-16"></th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/80 w-32 transition-colors"
                        onClick={() => handleSort('date')}
                      >
                        Date {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/80 w-80 transition-colors"
                        onClick={() => handleSort('artist')}
                      >
                        Artist {sortField === 'artist' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th
                        className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/80 w-64 transition-colors"
                        onClick={() => handleSort('venue')}
                      >
                        Venue {sortField === 'venue' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider w-48">
                        Festival
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">
                        Setlist
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider w-24">
                        Spotify
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-card divide-y divide-border">
                    {currentShows.map((show) => {
                      const isRemoving = removingShows.has(show.show_id)

                      return (
                        <tr key={show.show_id} className="hover:bg-muted/50 transition-colors">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => removeShow(show.show_id)}
                              disabled={isRemoving}
                              className="focus:outline-none disabled:opacity-50"
                              title="Remove from My Shows"
                            >
                              {isRemoving ? (
                                <div className="w-5 h-5 border-2 border-muted-foreground border-t-destructive rounded-full animate-spin"></div>
                              ) : (
                                <svg
                                  className="w-6 h-6 fill-destructive text-destructive hover:opacity-70 transition-opacity"
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
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-foreground">
                            {new Date(show.date + 'T12:00:00').toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'short',
                              day: 'numeric'
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            <button
                              onClick={() => router.push(`/browse?artist_id=${show.artist.artist_id}`)}
                              className="text-primary hover:opacity-70 hover:underline text-left transition-opacity"
                            >
                              {show.artist.artist_name}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">
                            <button
                              onClick={() => router.push(`/browse?venue_id=${show.venue.venue_id}`)}
                              className="text-primary hover:opacity-70 hover:underline text-left transition-opacity"
                            >
                              {show.venue.venue_name}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">
                            {show.festival_name || '-'}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                            {show.setlist_url ? (
                              <a
                                href={show.setlist_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center hover:opacity-70 transition-opacity"
                                title="View on setlist.fm"
                              >
                                <img
                                  src="https://www.setlist.fm/favicon.ico"
                                  alt="setlist.fm"
                                  className="w-4 h-4"
                                />
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm text-center">
                            {show.artist.spotify_artist_id ? (
                              <a
                                href={`https://open.spotify.com/artist/${show.artist.spotify_artist_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center justify-center hover:opacity-70 transition-opacity"
                                title="Open in Spotify"
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1DB954">
                                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                                </svg>
                              </a>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-muted px-4 py-3 border-t border-border sm:px-6">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Showing{' '}
                      <span className="font-medium text-foreground">
                        {(currentPage - 1) * showsPerPage + 1}
                      </span>{' '}
                      to{' '}
                      <span className="font-medium text-foreground">
                        {Math.min(currentPage * showsPerPage, sortedShows.length)}
                      </span>{' '}
                      of{' '}
                      <span className="font-medium text-foreground">{sortedShows.length}</span> shows
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-border bg-card text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                      >
                        Previous
                      </button>

                      <form onSubmit={handlePageInputSubmit} className="flex items-center gap-1">
                        <span className="text-sm text-muted-foreground">Page</span>
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
                          className="w-16 px-2 py-1 text-sm text-center text-foreground bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                        <span className="text-sm text-muted-foreground">of {totalPages}</span>
                      </form>

                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-border bg-card text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card rounded-lg shadow border border-border p-4">
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  )
}
