'use client'

import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import AuthButton from './AuthButton'

export default function Navigation() {
    const pathname = usePathname()
    const { theme, setTheme } = useTheme()
    const [mounted, setMounted] = useState(false)

    useEffect(() => {
        setMounted(true)
    }, [])

    const isActive = (path: string) => pathname === path

    return (
        <nav className="sticky top-0 z-50 bg-background border-b border-border shadow-sm">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex items-center justify-between h-16">

                    {/* Left: Brand + Nav Links */}
                    <div className="flex items-center gap-0">

                        {/* Brand */}
                        <a
                            href="/"
                            className="text-xl md:text-2xl font-bold text-foreground hover:text-muted-foreground md:-ml-4 mr-4 md:mr-6"
                        >
                            Vancouver Concert History
                        </a>

                        {/* Nav Links */}
                        <div className="hidden md:flex items-center gap-6">
                            <a
                                href="/"
                                className={`text-sm font-medium transition-colors ${isActive('/')
                                    ? 'text-primary border-b-2 border-primary pb-1'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Overview
                            </a>
                            <a
                                href="/browse"
                                className={`text-sm font-medium transition-colors ${isActive('/browse')
                                    ? 'text-primary border-b-2 border-primary pb-1'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                Discover
                            </a>
                            <a         
                            href="/browse"
                            className={`text-sm font-medium transition-colors ${isActive('/browse')
                                ? 'text-primary border-b-2 border-primary pb-1'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                            >
                                Browse
                            </a>
                            <a
                                href="/my-shows"
                                className={`text-sm font-medium transition-colors ${isActive('/my-shows')
                                    ? 'text-primary border-b-2 border-primary pb-1'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                My Shows
                            </a>
                        </div>
                    </div>

                    {/* Right: Theme Toggle + Auth Button */}
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
