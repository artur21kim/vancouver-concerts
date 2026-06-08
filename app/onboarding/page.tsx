'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function OnboardingPage() {
    const [username, setUsername] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [checkingAuth, setCheckingAuth] = useState(true)
    const router = useRouter()
    const supabase = createClient()

    useEffect(() => {
        // Check if user is authenticated
        const checkAuth = async () => {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                // Not logged in, redirect to home
                router.push('/')
                return
            }

            // Check if user already has a username
            const { data: profile } = await supabase
                .from('user_profiles')
                .select('username')
                .eq('user_id', user.id)
                .single()

            if (profile?.username) {
                // Already has username, redirect to home
                router.push('/')
                return
            }

            setCheckingAuth(false)
        }

        checkAuth()
    }, [router, supabase])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError(null)

        // Validate username
        if (username.length < 3 || username.length > 20) {
            setError('Username must be between 3 and 20 characters')
            setLoading(false)
            return
        }

        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            setError('Username can only contain letters, numbers, and underscores')
            setLoading(false)
            return
        }

        try {
            const { data: { user } } = await supabase.auth.getUser()

            if (!user) {
                setError('Not authenticated')
                setLoading(false)
                return
            }

            // Check if username is taken
            const { data: existingUser } = await supabase
                .from('user_profiles')
                .select('username')
                .eq('username', username)
                .single()

            if (existingUser) {
                setError('Username is already taken')
                setLoading(false)
                return
            }

            // Create or update user profile
            const { error: profileError } = await supabase
                .from('user_profiles')
                .upsert({
                    user_id: user.id,
                    username: username,
                })

            if (profileError) throw profileError

            // Redirect to home
            router.push('/')
        } catch (err: any) {
            setError(err.message)
            setLoading(false)
        }
    }

    if (checkingAuth) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                    <p className="text-gray-600">Loading...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
            <div className="max-w-md w-full">
                <div className="bg-white rounded-lg shadow-lg p-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-2 text-center">
                        Welcome! 🎵
                    </h1>
                    <p className="text-gray-600 mb-8 text-center">
                        Choose a username to get started
                    </p>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Username
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                                placeholder="concertfan123"
                                required
                                className="w-full px-4 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg placeholder:text-gray-500"
                                autoFocus
                            />
                            <p className="mt-2 text-sm text-gray-500">
                                3-20 characters, letters, numbers, and underscores only
                            </p>
                        </div>

                        {error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                                <p className="text-red-600 text-sm">{error}</p>
                            </div>
                        )}

                        <p className="text-xs text-muted-foreground text-center">
                            By creating an account you agree to our{' '}
                            <a href="/terms" className="underline hover:text-foreground transition-colors">Terms of Service</a>
                            {' '}and{' '}
                            <a href="/privacy" className="underline hover:text-foreground transition-colors">Privacy Policy</a>.
                        </p>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 disabled:opacity-50 font-medium text-lg"
                        >
                            {loading ? 'Creating...' : 'Continue'}
                        </button>
                    </form>
                </div>

                <p className="mt-6 text-center text-sm text-gray-500">
                    This will be your public display name on Grooveprint
                </p>
            </div>
        </div>
    )
}
