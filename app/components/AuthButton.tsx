'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/app/providers/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import AuthModal from './AuthModal'

export default function AuthButton() {
    const router = useRouter()
    const pathname = usePathname()
    const { user, loading } = useAuth()
    const [showAuthModal, setShowAuthModal] = useState(false)
    const [showUserMenu, setShowUserMenu] = useState(false)
    const [username, setUsername] = useState<string | null>(null)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [imgError, setImgError] = useState(false)
    const supabase = createClient()

    useEffect(() => {
        const fetchProfile = async () => {
            if (!user) {
                setUsername(null)
                setAvatarUrl(null)
                return
            }

            const { data } = await supabase
                .from('user_profiles')
                .select('username, avatar_url')
                .eq('user_id', user.id)
                .single()

            if (data) {
                setUsername(data.username)
                setAvatarUrl(data.avatar_url ?? null)
            }
        }

        fetchProfile()
    }, [user, supabase])

    // Reset image error state whenever the URL changes (e.g. after avatar refresh)
    useEffect(() => { setImgError(false) }, [avatarUrl])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        setShowUserMenu(false)
    }

    if (loading) {
        return (
            <div className="w-20 h-10 bg-muted animate-pulse rounded-md"></div>
        )
    }

    if (!user) {
        return (
            <>
                <button
                    onClick={() => setShowAuthModal(true)}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 font-medium text-sm whitespace-nowrap"
                >
                    Sign In
                </button>
                <AuthModal
                    isOpen={showAuthModal}
                    onClose={() => setShowAuthModal(false)}
                    returnPath={pathname}
                />
            </>
        )
    }

    const displayName = username || user.email
    const showAvatar = avatarUrl && !imgError

    return (
        <div className="relative">
            <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-2 px-2 md:px-4 py-2 bg-muted hover:opacity-80 rounded-md"
            >
                {showAvatar ? (
                    <img
                        src={avatarUrl}
                        alt={username ?? 'avatar'}
                        onError={() => setImgError(true)}
                        className="w-7 h-7 md:w-8 md:h-8 rounded-full object-cover flex-shrink-0"
                    />
                ) : (
                    <div className="w-7 h-7 md:w-8 md:h-8 bg-primary rounded-full flex items-center justify-center text-primary-foreground font-semibold text-xs md:text-sm flex-shrink-0">
                        {username ? username[0].toUpperCase() : (user.email?.[0]?.toUpperCase() ?? '?')}
                    </div>
                )}
                <span className="text-foreground font-medium hidden md:block">
                    {displayName}
                </span>
            </button>

            {showUserMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-card rounded-md shadow-lg py-1 z-50 border border-border">
                    <div className="px-4 py-2 border-b border-border">
                        <p className="text-sm text-muted-foreground">Signed in as</p>
                        <p className="text-sm font-medium text-foreground truncate">
                            {displayName}
                        </p>
                    </div>
                    <button
                        onClick={() => {
                            setShowUserMenu(false)
                            router.push('/settings')
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-foreground hover:bg-muted"
                    >
                        Settings
                    </button>
                    <div className="border-t border-border"></div>
                    <button
                        onClick={handleSignOut}
                        className="block w-full text-left px-4 py-2 text-sm text-destructive hover:bg-muted"
                    >
                        Sign Out
                    </button>
                </div>
            )}
        </div>
    )
}
