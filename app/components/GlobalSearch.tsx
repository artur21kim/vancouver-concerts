'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

// ── Types ─────────────────────────────────────────────────────────────────────
type ArtistResult = {
  value: number
  label: string
  monthly_listeners: number | null
  spotify_artist_id: string | null
}

type VenueResult = {
  value: number
  label: string
  capacity_category: string | null
}

type FlatResult =
  | { type: 'artist'; item: ArtistResult }
  | { type: 'venue';  item: VenueResult  }

// ── Helpers ───────────────────────────────────────────────────────────────────
const MAX_PER_SECTION = 3

function fmtListeners(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`
  return String(n)
}

function fmtCapacity(category: string | null): string {
  if (!category) return ''
  const c = category.toLowerCase()
  if (c.includes('x-large') || c.includes('10k')) return 'X-Large'
  if (c.includes('large'))  return 'Large'
  if (c.includes('medium')) return 'Medium'
  if (c.includes('small'))  return 'Small'
  return ''
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GlobalSearch({
  autoFocus = false,
  className = '',
}: {
  autoFocus?: boolean
  className?: string
}) {
  const router = useRouter()

  const [query,       setQuery]       = useState('')
  const [artists,     setArtists]     = useState<ArtistResult[]>([])
  const [venues,      setVenues]      = useState<VenueResult[]>([])
  const [isOpen,      setIsOpen]      = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const inputRef     = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Flat list for keyboard navigation — artists first, then venues
  const flatResults: FlatResult[] = [
    ...artists.slice(0, MAX_PER_SECTION).map(a => ({ type: 'artist' as const, item: a })),
    ...venues.slice(0, MAX_PER_SECTION).map(v  => ({ type: 'venue'  as const, item: v })),
  ]
  const artistCount = Math.min(artists.length, MAX_PER_SECTION)
  const hasResults  = flatResults.length > 0

  // Auto-focus when used in mobile expanded mode
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveIndex(-1)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch both endpoints in parallel
  const search = useCallback(async (q: string) => {
    if (q.length < 1) {
      setArtists([]); setVenues([]); setIsOpen(false); setLoading(false)
      return
    }
    setLoading(true)
    try {
      const encoded = encodeURIComponent(q)
      const [aRes, vRes] = await Promise.all([
        fetch(`/api/browse/artists/search?q=${encoded}`),
        fetch(`/api/browse/venues/search?q=${encoded}`),
      ])
      const [aData, vData] = await Promise.all([aRes.json(), vRes.json()])
      setArtists(aData.artists ?? [])
      setVenues(vData.venues   ?? [])
      setIsOpen(true)
      setActiveIndex(-1)
    } catch (e) {
      console.error('Search error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 200)
  }

  // Navigate to result and reset state
  const commit = (type: 'artist' | 'venue', id: number) => {
    setIsOpen(false)
    setQuery('')
    setArtists([]); setVenues([])
    router.push(type === 'artist' ? `/browse?artist_id=${id}` : `/browse?venue_id=${id}`)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!isOpen && query.length >= 1 && hasResults) { setIsOpen(true); return }
      setActiveIndex(prev => Math.min(prev + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && activeIndex < flatResults.length) {
        const sel = flatResults[activeIndex]
        commit(sel.type, sel.item.value)
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false)
      setActiveIndex(-1)
      inputRef.current?.blur()
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className={`relative ${className}`}>

      {/* Input */}
      <div className="relative">
        <svg
          className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none"
          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.length >= 1 && hasResults) setIsOpen(true) }}
          placeholder="Search artists or venues…"
          className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary transition-colors"
        />
        {loading && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
            <div className="w-3 h-3 border-2 border-border border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && query.length >= 1 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-card border border-border rounded-lg shadow-xl z-50 overflow-hidden min-w-[280px]">

          {/* Empty state */}
          {!hasResults && !loading && (
            <p className="px-3 py-4 text-sm text-muted-foreground text-center">
              No results for &ldquo;{query}&rdquo;
            </p>
          )}

          {/* Artists section */}
          {artistCount > 0 && (
            <div>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/60 border-b border-border">
                Artists
              </p>
              {artists.slice(0, MAX_PER_SECTION).map((a, i) => (
                <button
                  key={a.value}
                  onMouseDown={() => commit('artist', a.value)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors border-b border-border/40 last:border-0 ${
                    activeIndex === i ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                >
                  <span className="text-sm font-medium text-foreground truncate">{a.label}</span>
                  {a.monthly_listeners != null && a.monthly_listeners > 0 && (
                    <span className="text-xs text-muted-foreground flex-shrink-0 ml-3 tabular-nums">
                      {fmtListeners(a.monthly_listeners)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Venues section */}
          {venues.slice(0, MAX_PER_SECTION).length > 0 && (
            <div className={artistCount > 0 ? 'border-t border-border' : ''}>
              <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/60 border-b border-border">
                Venues
              </p>
              {venues.slice(0, MAX_PER_SECTION).map((v, i) => {
                const idx = artistCount + i
                const cap = fmtCapacity(v.capacity_category)
                return (
                  <button
                    key={v.value}
                    onMouseDown={() => commit('venue', v.value)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors border-b border-border/40 last:border-0 ${
                      activeIndex === idx ? 'bg-muted' : 'hover:bg-muted/50'
                    }`}
                  >
                    <span className="text-sm font-medium text-foreground truncate">{v.label}</span>
                    {cap && (
                      <span className="text-xs text-muted-foreground flex-shrink-0 ml-3">{cap}</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
