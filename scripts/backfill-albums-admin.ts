/**
 * Grooveprint — Admin album backfill script
 *
 * Backfills spotify_album_id, spotify_album_name, spotify_album_release_date
 * for all beta users using their stored Spotify refresh tokens.
 *
 * Run from the project root:
 *   npx tsx --env-file=.env.local scripts/backfill-albums-admin.ts
 *
 * Requires Node.js >= 20.6 (for --env-file). If on an older version, install
 * dotenv (`npm i -D dotenv`) and uncomment the two dotenv lines below.
 */

// import * as dotenv from 'dotenv'
// dotenv.config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL        = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SPOTIFY_CLIENT_ID   = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

const PAGE_DELAY_MS  = 3000  // Between Spotify pages — matches backfill route
const USER_DELAY_MS  = 2000  // Brief gap between users

// ── Supabase client (service role — bypasses RLS for cross-user writes) ───────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function refreshToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!res.ok) {
    console.error(`  ❌ Token refresh failed (${res.status}):`, await res.text())
    return null
  }

  const data = await res.json()
  return data.access_token ?? null
}

async function getNullCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('user_spotify_songs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('spotify_album_id', null)

  return count ?? 0
}

async function backfillUser(
  userId: string,
  accessToken: string
): Promise<{ pages: number; updated: number }> {
  let url: string | null = 'https://api.spotify.com/v1/me/tracks?limit=50'
  let pages   = 0
  let updated = 0

  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      console.error(`  ❌ Spotify /v1/me/tracks error (${res.status}) on page ${pages + 1}`)
      break
    }

    const data      = await res.json()
    const items: any[] = data.items ?? []
    url = data.next ?? null
    pages++

    for (const item of items) {
      const track = item.track
      if (!track?.id || !track.album?.id) continue

      const { error } = await supabase
        .from('user_spotify_songs')
        .update({
          spotify_album_id:           track.album.id,
          spotify_album_name:         track.album.name          ?? null,
          spotify_album_release_date: track.album.release_date  ?? null,
        })
        .eq('user_id', userId)
        .eq('spotify_track_id', track.id)

      if (!error) {
        updated++
      } else {
        console.error(`  ❌ DB update failed for track ${track.id}:`, error.message)
      }
    }

    if (pages % 10 === 0 || !url) {
      console.log(`  Page ${pages}: ${updated} rows updated so far`)
    }

    if (url) await new Promise(r => setTimeout(r, PAGE_DELAY_MS))
  }

  return { pages, updated }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎵 Grooveprint — Album backfill admin script')
  console.log('─'.repeat(50))

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing required env vars. Check .env.local.')
    process.exit(1)
  }

  // Fetch all users with a completed Spotify connection
  const { data: tokens, error: tokensError } = await supabase
    .from('user_spotify_tokens')
    .select('user_id, refresh_token')
    .eq('status', 'complete')

  if (tokensError || !tokens?.length) {
    console.error('❌ Failed to fetch tokens:', tokensError)
    return
  }

  console.log(`Found ${tokens.length} users with completed Spotify connections\n`)

  // Pre-flight: check null counts so we can skip already-done users
  console.log('Checking remaining null counts per user...')
  const nullCounts: { userId: string; refreshToken: string; nullCount: number }[] = []

  for (const { user_id, refresh_token } of tokens) {
    const count = await getNullCount(user_id)
    nullCounts.push({ userId: user_id, refreshToken: refresh_token, nullCount: count })
    console.log(`  ${user_id}: ${count} rows still null`)
  }

  const toProcess = nullCounts.filter(u => u.nullCount > 0)

  console.log(`\n${toProcess.length} users need backfilling (${nullCounts.length - toProcess.length} already complete)\n`)
  console.log('─'.repeat(50))

  for (let i = 0; i < toProcess.length; i++) {
    const { userId, refreshToken: rt, nullCount } = toProcess[i]

    console.log(`\n[${i + 1}/${toProcess.length}] User ${userId} (${nullCount} null rows)`)

    const accessToken = await refreshToken(rt)
    if (!accessToken) {
      console.log('  ⚠️  Skipping — token refresh failed (user may need to reconnect Spotify)')
      continue
    }

    const start = Date.now()
    const { pages, updated } = await backfillUser(userId, accessToken)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`  ✅ Done: ${updated} rows updated across ${pages} pages in ${elapsed}s`)

    if (i < toProcess.length - 1) await new Promise(r => setTimeout(r, USER_DELAY_MS))
  }

  console.log('\n' + '─'.repeat(50))
  console.log('🎉 All users complete!')
  console.log('\nRun this SQL to verify:')
  console.log(`
SELECT user_id,
  COUNT(*) FILTER (WHERE spotify_album_id IS NULL) AS still_null,
  COUNT(*) AS total
FROM user_spotify_songs
GROUP BY user_id
ORDER BY still_null DESC;
`)
}

main().catch(console.error)
