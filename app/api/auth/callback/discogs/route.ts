/**
 * GET /api/auth/callback/discogs
 *
 * Step 2 of the Discogs OAuth 1.0a flow:
 *  1. Read oauth_token + oauth_verifier from the query string
 *  2. Retrieve the request-token secret from the cookie set in step 1
 *  3. Exchange for a permanent access token + secret
 *  4. Fetch the user's Discogs identity (username)
 *  5. Upsert into user_discogs_tokens
 *  6. Mark user_profiles.discogs_connected = true
 *  7. Redirect to /settings?discogs=connected
 */

import { NextResponse } from 'next/server'
import { cookies }      from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { createDiscogsOAuth } from '@/lib/discogs/oauth'

const DISCOGS_ACCESS_TOKEN_URL = 'https://api.discogs.com/oauth/access_token'
const DISCOGS_IDENTITY_URL     = 'https://api.discogs.com/oauth/identity'

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)

  try {
    // ── 1. Extract params ──────────────────────────────────────────────────
    const oauthToken    = requestUrl.searchParams.get('oauth_token')
    const oauthVerifier = requestUrl.searchParams.get('oauth_verifier')

    if (!oauthToken || !oauthVerifier) {
      console.error('❌ Discogs callback: missing oauth_token or oauth_verifier')
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    // ── 2. Retrieve request-token secret from cookie ───────────────────────
    const cookieStore      = await cookies()
    const oauthTokenSecret = cookieStore.get('discogs_oauth_token_secret')?.value

    if (!oauthTokenSecret) {
      console.error('❌ Discogs callback: token-secret cookie missing or expired')
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    // ── 3. Verify the user is still signed in ─────────────────────────────
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.redirect(new URL('/login', requestUrl.origin))
    }

    // ── 4. Exchange request token for access token ─────────────────────────
    const oauth        = createDiscogsOAuth()
    const requestToken = { key: oauthToken, secret: oauthTokenSecret }

    // oauth-1.0a moves oauth_verifier from `data` into the Authorization
    // header automatically, where Discogs expects it.
    const authHeader = oauth.toHeader(
      oauth.authorize(
        { url: DISCOGS_ACCESS_TOKEN_URL, method: 'POST', data: { oauth_verifier: oauthVerifier } },
        requestToken
      )
    )

    const tokenRes = await fetch(DISCOGS_ACCESS_TOKEN_URL, {
      method:  'POST',
      headers: {
        ...(authHeader as unknown as Record<string, string>),
        'User-Agent':   'Grooveprint/1.0',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text()
      console.error(`❌ Discogs access_token failed (${tokenRes.status}): ${errBody}`)
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    const tokenBody   = await tokenRes.text()
    const tokenParams = new URLSearchParams(tokenBody)
    const accessToken       = tokenParams.get('oauth_token')
    const accessTokenSecret = tokenParams.get('oauth_token_secret')

    if (!accessToken || !accessTokenSecret) {
      console.error('❌ Discogs access_token: missing fields:', tokenBody)
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    // ── 5. Fetch Discogs identity (username) ──────────────────────────────
    const accessTokenPair = { key: accessToken, secret: accessTokenSecret }
    const identityAuthHeader = oauth.toHeader(
      oauth.authorize({ url: DISCOGS_IDENTITY_URL, method: 'GET' }, accessTokenPair)
    )

    let discogsUsername: string | null = null

    const identityRes = await fetch(DISCOGS_IDENTITY_URL, {
      headers: {
        ...(identityAuthHeader as unknown as Record<string, string>),
        'User-Agent': 'Grooveprint/1.0',
      },
    })

    if (identityRes.ok) {
      const identity  = await identityRes.json()
      discogsUsername = identity.username ?? null
      console.log(`✅ Discogs identity: @${discogsUsername} for user ${user.id}`)
    } else {
      // Non-fatal — tokens are still valid even if identity fails
      console.warn(`⚠️ Discogs identity fetch failed (${identityRes.status}) — continuing`)
    }

    // ── 6. Upsert tokens ──────────────────────────────────────────────────
    const { error: upsertError } = await supabase
      .from('user_discogs_tokens')
      .upsert(
        {
          user_id:             user.id,
          access_token:        accessToken,
          access_token_secret: accessTokenSecret,
          discogs_username:    discogsUsername,
          status:              'pending',
          updated_at:          new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      )

    if (upsertError) {
      console.error('❌ Failed to store Discogs tokens:', upsertError.message)
      return NextResponse.redirect(
        new URL('/settings?discogs=error', requestUrl.origin)
      )
    }

    // ── 7. Mark profile as connected ──────────────────────────────────────
    await supabase
      .from('user_profiles')
      .update({
        discogs_connected: true,
        updated_at:        new Date().toISOString(),
      })
      .eq('user_id', user.id)

    console.log(`✅ Discogs connected for user ${user.id}`)

    // ── 8. Clear temp cookie and redirect ─────────────────────────────────
    const response = NextResponse.redirect(
      new URL('/settings?discogs=connected', requestUrl.origin)
    )
    response.cookies.delete('discogs_oauth_token_secret')

    return response
  } catch (error) {
    console.error('❌ Discogs callback error:', error)
    return NextResponse.redirect(
      new URL('/settings?discogs=error', requestUrl.origin)
    )
  }
}
