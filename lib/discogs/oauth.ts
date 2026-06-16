/**
 * Shared Discogs OAuth 1.0a helpers.
 * Server-only — never import from client components.
 *
 * Discogs requirements:
 *  - HMAC-SHA1 signatures
 *  - User-Agent: Grooveprint/1.0 on every request (or API rejects with 403)
 */

import OAuth from 'oauth-1.0a'
import crypto from 'crypto'

export type DiscogsToken = {
  key: string
  secret: string
}

// ---------------------------------------------------------------------------
// OAuth client
// ---------------------------------------------------------------------------

export function createDiscogsOAuth(): OAuth {
  return new OAuth({
    consumer: {
      key: process.env.DISCOGS_CONSUMER_KEY!,
      secret: process.env.DISCOGS_CONSUMER_SECRET!,
    },
    signature_method: 'HMAC-SHA1',
    hash_function(base_string: string, key: string) {
      return crypto.createHmac('sha1', key).update(base_string).digest('base64')
    },
  })
}

// ---------------------------------------------------------------------------
// Signed fetch helper
//
// Builds the OAuth Authorization header for `method + url` (+ optional token)
// and issues the fetch. The caller is responsible for parsing the response.
// ---------------------------------------------------------------------------

export async function discogsFetch(
  method: 'GET' | 'POST',
  url: string,
  token?: DiscogsToken,
  /** Body params for POST (also included in the OAuth signature). */
  data?: Record<string, string>
): Promise<Response> {
  const oauth = createDiscogsOAuth()

  // oauth-1.0a signs query params when they're part of the URL for GET
  // and moves oauth_verifier from data into the Authorization header automatically.
  const authHeader = oauth.toHeader(
    oauth.authorize({ url, method, data: data ?? {} }, token)
  )

  const headers: Record<string, string> = {
    ...(authHeader as Record<string, string>),
    'User-Agent': 'Grooveprint/1.0',
  }

  let body: string | undefined
  if (method === 'POST' && data) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(data).toString()
  }

  return fetch(url, { method, headers, body })
}
