'use client'

import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import AuthButton from './AuthButton'

const DISCOVER_PATHS = [
  '/discover',
  '/discover/upcoming',
  '/matches',
  '/venue-selection',
  '/likely-shows',
  '/review-summary',
]

const PAST_FLOW_BREADCRUMBS: Record<string, { label: string; path: string }[]> = {
  '/matches': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
  ],
  '/venue-selection': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
    { label: 'Venue Selection', path: '/venue-selection' },
  ],
  '/likely-shows': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
    { label: 'Venue Selection', path: '/venue-selection' },
    { label: 'Likely Shows', path: '/likely-shows' },
  ],
  '/review-summary': [
    { label: 'Discover', path: '/discover' },
    { label: 'Matches', path: '/matches' },
    { label: 'Venue Selection', path: '/venue-selection' },
    { label: 'Likely Shows', path: '/likely-shows' },
    { label: 'Summary', path: '/review-summary' },
  ],
}

export default function Navigation() {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [currentPath, setCurrentPath] = useState(pathname)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => { setCurrentPath(pathname) }, [pathname])
  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname)
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const isDiscoverActive = DISCOVER_PATHS.includes(currentPath)
  const breadcrumbs = PAST_FLOW_BREADCRUMBS[currentPath] ?? null

  const navLinkClass = (active: boolean) =>
    `text-sm font-medium transition-colors ${
      active
        ? 'text-primary border-b-2 border-primary pb-1'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <nav className="sticky top-0 z-50 bg-background border-b border-border shadow-sm">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">

          {/* Left: Brand + Nav links */}
          <div className="flex items-center gap-0">
            <a
              href="/"
              className="text-xl md:text-2xl font-bold text-foreground hover:text-muted-foreground md:-ml-4 mr-4 md:mr-6 shrink-0"
            >
              Vancouver Concert History
            </a>

            {/* Nav links — Discover gets special treatment when breadcrumb is active */}
            <div className="hidden md:flex items-center gap-6">
              <a href="/" className={navLinkClass(currentPath === '/')}>Overview</a>

              {/* Discover link — stacks breadcrumb below it when in Past flow */}
              <div className="flex flex-col">
                <a href="/discover" className={navLinkClass(isDiscoverActive)}>Discover</a>
                {breadcrumbs && (
                  <div className="flex items-center gap-1 text-xs mt-1 whitespace-nowrap">
                    {breadcrumbs.map((crumb, i) => {
                      const isLast = i === breadcrumbs.length - 1
                      return (
                        <span key={crumb.path} className="flex items-center gap-1">
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

              <a href="/browse" className={navLinkClass(currentPath === '/browse')}>Browse</a>
              <a href="/my-shows" className={navLinkClass(currentPath === '/my-shows')}>My Shows</a>
            </div>
          </div>

          {/* Right: Theme + Auth */}
          <div className="flex items-center gap-2 -mr-2 md:-mr-4">
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
      </div>
    </nav>
  )
}
