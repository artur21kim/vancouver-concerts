'use client'

import { usePathname } from 'next/navigation'
import AuthButton from './AuthButton'

export default function Navigation() {
    const pathname = usePathname()

    const isActive = (path: string) => pathname === path

    return (
        <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-6 md:px-8">
                <div className="flex items-center justify-between h-16">
                    {/* Left: Brand + Nav Links */}
                    <div className="flex items-center gap-0">
                        {/* Brand - Aligned with content below */}
                       <a 
                        href="/"
                        className="text-xl md:text-2xl font-bold text-gray-900 hover:text-gray-700 md:-ml-4 mr-4 md:mr-6"
            >
                        Vancouver Concert History
                    </a>

                    {/* Nav Links */}
                    <div className="hidden md:flex items-center gap-6">
                       <a 
                        href="/"
                        className={`text-sm font-medium transition-colors ${isActive('/')
                                ? 'text-blue-600 border-b-2 border-blue-600 pb-1'
                                : 'text-gray-600 hover:text-gray-900'
                            }`}
              >
                        Overview
                    </a>
                   <a                
                    href="/browse"
                    className={`text-sm font-medium transition-colors ${isActive('/browse')
                            ? 'text-blue-600 border-b-2 border-blue-600 pb-1'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
              >
                    Browse
                </a>
               <a             
                href="/my-shows"
                className={`text-sm font-medium transition-colors ${isActive('/my-shows')
                        ? 'text-blue-600 border-b-2 border-blue-600 pb-1'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
              >
                My Shows
            </a>
        </div>
          </div >

                    {/* Right: Auth Button - Smaller on mobile */}
                    <div className="-mr-2 md:-mr-4">
                        <AuthButton />
                    </div>
                </div>
            </div>
        </nav>
    )
}
