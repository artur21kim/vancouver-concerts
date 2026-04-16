'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import AuthModal from './AuthModal'

export default function AuthButton() {
    const router = useRouter()
    const { user, loading } = useAuth()
    const [showAuthModal, setShowAuthModal] = useState(false)
    const [showUserMenu, setShowUserMenu] = useState(false)
    const [username, setUsername] = useState<string | null>(null)
    const supabase = createClient()

    // Fetch username when user is available
    useEffect(() => {
        const fetchUsername = async () => {
            if (!user) {
                setUsername(null)
                return
            }

            const { data } = await supabase
                .from('user_profiles')
                .select('username')
                .eq('user_id', user.id)
                .single()

            if (data) {
                setUsername(data.username)
            }
        }

        fetchUsername()
    }, [user, supabase])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        setShowUserMenu(false)
    }

    if (loading) {
        return (
            <div className="w-20 h-10 bg-gray-200 animate-pulse rounded-md"></div>
        )
    }

    if (!user) {
        return (
            <>
                <button
                    onClick={() => setShowAuthModal(true)}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                >
                    Sign In
                </button>
                <AuthModal
                    isOpen={showAuthModal}
                    onClose={() => setShowAuthModal(false)}
                />
            </>
        )
    }

    const displayName = username || user.email

    return (
        <div className="relative">
            <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
                <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {username ? username[0].toUpperCase() : user.email?.[0].toUpperCase()}
                </div>
                <span className="text-gray-900 font-medium hidden md:block">
                    {displayName}
                </span>
            </button>

            {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200">
                    <div className="px-4 py-2 border-b border-gray-200">
                        <p className="text-sm text-gray-500">Signed in as</p>
                        <p className="text-sm font-medium text-gray-900 truncate">
                            {displayName}
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setShowUserMenu(false)
                            // TODO: Navigate to profile page
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                        My Profile
                    </button>
                    <button
                        onClick={() => {
                            setShowUserMenu(false)
                            router.push('/my-shows')
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                        My Shows
                    </button>
                    <div className="border-t border-gray-200"></div>
                    <button
                        onClick={handleSignOut}
                        className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-gray-100"
                    >
                        Sign Out
                    </button>
                </div>
            )}
        </div>
    )
}