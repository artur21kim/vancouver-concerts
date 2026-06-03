import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code')
    const next = requestUrl.searchParams.get('next')
    const origin = requestUrl.origin

    // Sanitize next param — only allow relative paths starting with /
    const redirectTo = next && next.startsWith('/') ? next : '/'

    if (code) {
        const supabase = await createClient()
        const { data, error } = await supabase.auth.exchangeCodeForSession(code)

        if (!error && data.user) {
            // Populate avatar from Google OAuth metadata (only if not already set)
            const avatarUrl = data.user.user_metadata?.avatar_url ?? null
            if (avatarUrl) {
                await supabase
                    .from('user_profiles')
                    .update({ avatar_url: avatarUrl })
                    .eq('user_id', data.user.id)
                    .is('avatar_url', null)
            }

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

    // Redirect to next param if provided, otherwise home
    return NextResponse.redirect(`${origin}${redirectTo}`)
}
