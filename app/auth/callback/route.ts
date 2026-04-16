import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const origin = requestUrl.origin

    if (code) {
        const supabase = await createClient()
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error && data.user) {
            // Check if user profile exists
            const { data: profile } = await supabase
                .from('user_profiles')
                .select('username')
                .eq('user_id', data.user.id)
                .single()

            // If no profile or no username, redirect to onboarding
            if (!profile || !profile.username) {
                return NextResponse.redirect(`${origin}/onboarding`)
            }
        }
    }

    // User has profile with username, redirect to home
    return NextResponse.redirect(`${origin}`)
}