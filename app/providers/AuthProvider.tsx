'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

type AuthContextType = {
    user: User | null
    loading: boolean
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    loading: true,
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)
    const supabase = createClient()

    useEffect(() => {
        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            setUser(session?.user ?? null)
            setLoading(false)
        })

        // Listen for auth changes
        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
            setUser(session?.user ?? null)

            // SCRUM-81: Referral attribution — runs for ALL sign-in flows (email and Google).
            // The profile page stores gp_referrer_username in localStorage when a visitor
            // arrives via ?r=1. We consume it here on the first SIGNED_IN event after signup.
            // Using .is('referred_by', null) on the update prevents overwriting existing
            // attribution; localStorage key is removed after the first attempt.
            if (event === 'SIGNED_IN' && session?.user) {
                const referrerUsername = localStorage.getItem('gp_referrer_username')
                if (referrerUsername) {
                    ;(async () => {
                        try {
                            const { data: referrerProfile } = await supabase
                                .from('user_profiles')
                                .select('user_id')
                                .eq('username', referrerUsername)
                                .single()

                            if (
                                referrerProfile?.user_id &&
                                referrerProfile.user_id !== session.user.id
                            ) {
                                await supabase
                                    .from('user_profiles')
                                    .update({ referred_by: referrerProfile.user_id })
                                    .eq('user_id', session.user.id)
                                    .is('referred_by', null) // never overwrite existing attribution
                            }
                        } catch (e) {
                            // Silent fail — localStorage key stays, retries on next SIGNED_IN
                            console.error('Referral attribution error:', e)
                            return
                        }
                        localStorage.removeItem('gp_referrer_username')
                    })()
                }
            }
        })

        return () => subscription.unsubscribe()
    }, [supabase.auth])

    return (
        <AuthContext.Provider value={{ user, loading }}>
            {children}
        </AuthContext.Provider>
    )
}

export const useAuth = () => {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
