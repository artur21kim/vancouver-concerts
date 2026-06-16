/**
 * GET /api/auth/discogs
 *
 * Step 1 of the Discogs OAuth 1.0a flow:
 *  1. Obtain a temporary request token from Discogs
 *  2. Store the token secret in a short-lived httpOnly cookie
 *  3. Redirect the user to Discogs to authorise the app
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createDiscogsOAuth } from '@/lib/discogs/oauth'

const DISCOGS_REQUEST_TOKEN_URL = 'https://api.discogs.com/oauth/request_token'
const DISCOGS_AUTHORIZE_URL     = 'https://www.discogs.com/oauth/authorize'

export async function GET(request: Request) {
  try {
    // Auth guard — must be signed in to connect Discogs
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    const requestUrl = new URL(request.url)

    if (authError || !user) {
      return NextResponse.redirect(new URL('/login', requestUrl.origin))
    }

    const callbackUrl = `${requestUrl.origin}/api/auth/callback/discogs`

    // Build the request-token URL with oauth_callback as a query param so it
    // is included in the OAuth signature base string and sent to Discogs.
    const fetchUrl = `${DISCOGS_REQUEST_TOKEN_URL}?oauth_callback=${encodeURIComponent(callbackUrl)}`

    const oauth = createDiscogsOAuth()
    const authHeader = oauth.toHeader(
      oauth.authorize({ url: fetchUrl, method: 'GET' })
    )

    const res = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        ...(authHeader as unknown as Record<string, string>),
        'User-Agent': 'Grooveprint/1.0',
      },
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`❌ Discogs request_token failed (${res.status}): ${body}`)
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    const body = await res.text()
    const params = new URLSearchParams(body)
    const oauthToken       = params.get('oauth_token')
    const oauthTokenSecret = params.get('oauth_token_secret')

    if (!oauthToken || !oauthTokenSecret) {
      console.error('❌ Discogs request_token: missing fields in response:', body)
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    console.log(`✅ Discogs request_token obtained for user ${user.id}`)

    // Persist the request-token secret in a short-lived httpOnly cookie.
    // We need it in the callback to complete the HMAC signature.
    const response = NextResponse.redirect(
      `${DISCOGS_AUTHORIZE_URL}?oauth_token=${oauthToken}`
    )
    response.cookies.set('discogs_oauth_token_secret', oauthTokenSecret, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === 'production',
      sameSite: 'lax',   // lax: survives the redirect back from discogs.com
      maxAge:   600,     // 10 minutes — plenty of time to complete auth
      path:     '/',
    })

    return response
  } catch (error) {
    console.error('❌ Discogs auth init error:', error)
    const url = new URL(request.url)
    return NextResponse.redirect(new URL('/settings?discogs=error', url.origin))
  }
}
