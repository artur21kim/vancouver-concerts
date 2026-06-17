'use client'

import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import AuthButton from './AuthButton'
import GlobalSearch from './GlobalSearch'
import { useAuth } from '@/app/providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'

const DISCOVER_PATHS = [
  '/discover',
  '/discover/upcoming',
  '/matches',
  '/likely-shows',
  '/review-summary',
]

const PAST_FLOW_BREADCRUMBS: Record<string, { label: string; path: string }[]> = {
  '/matches': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
  ],
  '/likely-shows': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
    { label: 'Likely Shows', path: '/likely-shows' },
  ],
  '/review-summary': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
    { label: 'Likely Shows', path: '/likely-shows' },
    { label: 'Summary', path: '/review-summary' },
  ],
}

const NAV_LINKS = [
  { label: 'Overview', path: '/' },
  { label: 'Discover', path: '/discover' },
  { label: 'Browse', path: '/browse' },
  { label: 'My Grooveprint', path: '/my-grooveprint' },
  { label: 'Friends', path: '/friends' },
]

function getBreadcrumbs(path: string): { label: string; path: string }[] | null {
  if (PAST_FLOW_BREADCRUMBS[path]) return PAST_FLOW_BREADCRUMBS[path]
  const showsMatch = path.match(/^\/profile\/([^/]+)\/shows$/)
  if (showsMatch) {
    const u = showsMatch[1]
    return [
      { label: `@${u}`, path: `/profile/${u}` },
      { label: 'Shows', path },
    ]
  }
  return null
}

// GP-125: connection status needed to gate Spotify / Discogs tab pills
type NavProfile = { spotifyConnected: boolean; discogsConnected: boolean }

export default function Navigation() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const { user } = useAuth()
  const [mounted, setMounted]               = useState(false)
  const [currentPath, setCurrentPath]       = useState(pathname)
  const [menuOpen, setMenuOpen]             = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [pendingCount, setPendingCount]     = useState(0)
  const [navProfile, setNavProfile]         = useState<NavProfile | null>(null)
  const [myGPHover, setMyGPHover]           = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setCurrentPath(pathname) }, [pathname])
  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  // Close both menus on route change
  useEffect(() => {
    setMenuOpen(false)
    setMobileSearchOpen(false)
  }, [currentPath])

  // Fetch pending friend request count
  useEffect(() => {
    if (!user) { setPendingCount(0); return }
    const supabase = createClient()
    supabase.rpc('get_pending_requests').then(({ data }) => {
      setPendingCount(data?.length ?? 0)
    })
  }, [user, currentPath])

  // GP-125: fetch Spotify/Discogs connection status for My Grooveprint hover menu
  // Only re-runs on user change (not every route change) — connection status is stable
  useEffect(() => {
    if (!user) { setNavProfile(null); return }
    const supabase = createClient()
    supabase
      .from('user_profiles')
      .select('spotify_user_id, discogs_username')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) setNavProfile({
          spotifyConnected: !!data.spotify_user_id,
          discogsConnected: !!data.discogs_username,
        })
      })
  }, [user])

  const isDiscoverActive = DISCOVER_PATHS.includes(currentPath)
  const breadcrumbs = getBreadcrumbs(currentPath)

  const isLinkActive = (path: string) =>
    path === '/discover' ? isDiscoverActive : currentPath === path

  const navLinkClass = (active: boolean) =>
    `text-sm font-medium transition-colors ${
      active
        ? 'text-primary border-b-2 border-primary pb-1'
        : 'text-muted-foreground hover:text-foreground'
    }`

  const mobileLinkClass = (active: boolean) =>
    `block w-full text-left px-4 py-3 text-sm font-medium transition-colors border-l-2 ${
      active
        ? 'text-primary border-primary bg-muted/50'
        : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/30'
    }`

  return (
    <nav className="sticky top-0 z-50 bg-background border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4">

        {/* ── Main nav row ── */}
        {mobileSearchOpen ? (

          // Mobile: search expanded — full width input replaces nav row
          <div className="flex items-center h-16 gap-2">
            <GlobalSearch autoFocus className="flex-1" />
            <button
              onClick={() => setMobileSearchOpen(false)}
              className="p-2 flex-shrink-0 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

        ) : (

          // Normal nav row
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              {/* Hamburger — mobile only */}
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                className="md:hidden p-2 -ml-2 mr-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Toggle menu"
                aria-expanded={menuOpen}
              >
                {menuOpen ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="3" y1="6" x2="21" y2="6" />
                    <line x1="3" y1="12" x2="21" y2="12" />
                    <line x1="3" y1="18" x2="21" y2="18" />
                  </svg>
                )}
              </button>

              <a
                href="/"
                className="text-xl md:text-2xl font-bold text-foreground hover:text-muted-foreground md:-ml-4 mr-4 md:mr-6 shrink-0"
              >
                Grooveprint
              </a>

              {/* Desktop nav links */}
              <div className="hidden md:flex items-center gap-6">
                {NAV_LINKS.map(({ label, path }) => {
                  // GP-125: My Grooveprint gets a hover dropdown when Spotify or Discogs is connected.
                  // Dropdown is suppressed when neither is connected (no point showing a one-item menu).
                  if (
                    path === '/my-grooveprint' &&
                    navProfile &&
                    (navProfile.spotifyConnected || navProfile.discogsConnected)
                  ) {
                      return (
                      <div
                        key={path}
                        className="relative"
                        onMouseEnter={() => setMyGPHover(true)}
                        onMouseLeave={() => setMyGPHover(false)}
                      >
                        {/* Main link — click behaviour unchanged */}
                        <a href={path} className={navLinkClass(isLinkActive(path))}>
                          {label}
                        </a>

                        {/* Tab jump dropdown */}
                        {myGPHover && (
                          <div className="absolute top-full left-1/2 -translate-x-1/2 pt-1.5 z-50">
                            <div className="bg-card border border-border rounded-lg shadow-xl py-1 px-1 flex flex-col min-w-[140px]">

                              {/* Shows — teal dot placeholder until Grooveprint logo is finalised */}
                              <a href="/my-grooveprint" className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-muted transition-colors">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: '#00BFA8' }} />
                                <span className="text-sm text-foreground">Shows</span>
                              </a>

                              {/* Spotify — brand icon, always green */}
                              {navProfile.spotifyConnected && (
                                <a href="/my-grooveprint?tab=spotify" className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-muted transition-colors">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="#1DB954" className="flex-shrink-0">
                                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                                  </svg>
                                  <span className="text-sm text-foreground">Spotify</span>
                                </a>
                              )}

                              {/* Discogs — brand icon, currentColor = theme-adaptive (white in dark mode) */}
                              {navProfile.discogsConnected && (
                                <a href="/my-grooveprint?tab=discogs" className="flex items-center gap-2.5 px-3 py-2 rounded-md hover:bg-muted transition-colors">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="flex-shrink-0 text-foreground">
                                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm-.37 17.5H8.13V6.5h3.5c3.314 0 6 2.239 6 5.5s-2.686 5.5-6 5.5zm0-9.5H9.63v8h1.999c2.485 0 4.501-1.79 4.501-4s-2.016-4-4.501-4z"/>
                                  </svg>
                                  <span className="text-sm text-foreground">Discogs</span>
                                </a>
                              )}

                            </div>
                          </div>
                        )}
                      </div>
                    )
                  }

                  // Default link for all other nav items
                  return (
                    <a
                      key={path}
                      href={path}
                      className={`relative ${navLinkClass(isLinkActive(path))}`}
                    >
                      {label}
                      {path === '/friends' && pendingCount > 0 && (
                        <span className="absolute -top-1.5 -right-4 min-w-[16px] h-4 bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                          {pendingCount > 9 ? '9+' : pendingCount}
                        </span>
                      )}
                    </a>
                  )
                })}
              </div>
            </div>

            {/* Right side: search + theme toggle + auth */}
            <div className="flex items-center gap-2 -mr-2 md:-mr-4">

              {/* Search bar — desktop only */}
              <div className="hidden md:block">
                <GlobalSearch className="w-44 lg:w-56" />
              </div>

              {/* Search icon — mobile only */}
              <button
                onClick={() => { setMobileSearchOpen(true); setMenuOpen(false) }}
                className="md:hidden p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </button>

              {/* Theme toggle */}
              {mounted && (
                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Toggle theme"
                >
                  {theme === 'dark' ? '☀️' : '🌙'}
                </button>
              )}
              <AuthButton />
            </div>
          </div>

        )}

        {/* Breadcrumb row — hidden when mobile search is open */}
        {!mobileSearchOpen && breadcrumbs && (
          <div className="flex items-center gap-1.5 pb-2 text-xs md:-ml-4">
            {breadcrumbs.map((crumb, i) => {
              const isLast = i === breadcrumbs.length - 1
              return (
                <span key={crumb.path} className="flex items-center gap-1.5">
                  {isLast ? (
                    <span className="text-foreground font-semibold">{crumb.label}</span>
                  ) : (
                    <a href={crumb.path} className="text-muted-foreground hover:text-foreground transition-colors">
                      {crumb.label}
                    </a>
                  )}
                  {!isLast && <span className="text-primary font-medium">›</span>}
                </span>
              )
            })}
          </div>
        )}

      </div>

      {/* Mobile dropdown menu — hidden when search is open */}
      {!mobileSearchOpen && menuOpen && (
        <div className="md:hidden border-t border-border bg-background py-2">
          {NAV_LINKS.map(({ label, path }) => (
            <a
              key={path}
              href={path}
              className={`relative ${mobileLinkClass(isLinkActive(path))}`}
              onClick={() => setMenuOpen(false)}
            >
              <span className="flex items-center gap-2">
                {label}
                {path === '/friends' && pendingCount > 0 && (
                  <span className="min-w-[18px] h-[18px] bg-destructive text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                    {pendingCount > 9 ? '9+' : pendingCount}
                  </span>
                )}
              </span>
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}
