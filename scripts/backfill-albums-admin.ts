/**
 * Grooveprint — Admin album backfill script (Client Credentials)
 *
 * Uses Spotify's Client Credentials flow to fetch public catalog metadata
 * (album_id, album_name, release_date) for all track IDs that still have
 * null album data — no user tokens or allowlist access required.
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

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SPOTIFY_CLIENT_ID    = process.env.NEXT_PUBLIC_SPOTIFY_CLIENT_ID!
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET!

const BATCH_SIZE = 50   // Spotify /v1/tracks max IDs per request
const DELAY_MS   = 400  // Between Spotify API calls

// ── Supabase client (service role — bypasses RLS for cross-user writes) ───────

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Spotify Client Credentials token ─────────────────────────────────────────

async function getClientCredentialsToken(): Promise<string> {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(
        `${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`
      ).toString('base64')}`,
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  })

  if (!res.ok) {
    throw new Error(`Client Credentials request failed (${res.status}): ${await res.text()}`)
  }

  const data = await res.json()
  return data.access_token as string
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🎵 Grooveprint — Album backfill admin script (Client Credentials)')
  console.log('─'.repeat(60))

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('❌ Missing required env vars. Check .env.local.')
    process.exit(1)
  }

  // Get app-level token — no user allowlist restrictions apply
  console.log('Getting Spotify Client Credentials token...')
  const accessToken = await getClientCredentialsToken()
  console.log('✅ Token obtained\n')

  // Fetch all unique track IDs still needing album data across ALL users
  console.log('Fetching null track IDs from database...')
  const { data: nullRows, error: nullError } = await supabase
    .from('user_spotify_songs')
    .select('spotify_track_id')
    .is('spotify_album_id', null)

  if (nullError || !nullRows) {
    console.error('❌ Failed to fetch null tracks:', nullError)
    return
  }

  // Deduplicate — same track_id appears across multiple users and artists
  const uniqueTrackIds = [...new Set(nullRows.map(r => r.spotify_track_id as string))]
  const totalBatches   = Math.ceil(uniqueTrackIds.length / BATCH_SIZE)

  console.log(
    `${nullRows.length} null rows → ${uniqueTrackIds.length} unique tracks` +
    ` → ${totalBatches} Spotify API calls\n`
  )
  console.log('─'.repeat(60))

  let totalUpdated = 0

  for (let i = 0; i < uniqueTrackIds.length; i += BATCH_SIZE) {
    const batch    = uniqueTrackIds.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const res: Response = await fetch(
      `https://api.spotify.com/v1/tracks?ids=${batch.join(',')}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )

    if (!res.ok) {
      console.error(`❌ Spotify error (${res.status}) on batch ${batchNum}: ${await res.text()}`)
      continue
    }

    const data          = await res.json()
    const tracks: any[] = data.tracks ?? []

    for (const track of tracks) {
      if (!track?.id || !track.album?.id) continue

      // Update all users who have this track with null album data in one statement
      const { error } = await supabase
        .from('user_spotify_songs')
        .update({
          spotify_album_id:           track.album.id,
          spotify_album_name:         track.album.name          ?? null,
          spotify_album_release_date: track.album.release_date  ?? null,
        })
        .eq('spotify_track_id', track.id)
        .is('spotify_album_id', null)

      if (!error) {
        totalUpdated++
      } else {
        console.error(`❌ DB update failed for track ${track.id}:`, error.message)
      }
    }

    if (batchNum % 20 === 0 || batchNum === totalBatches) {
      console.log(`Batch ${batchNum}/${totalBatches}: ${totalUpdated} unique tracks updated`)
    }

    if (i + BATCH_SIZE < uniqueTrackIds.length) {
      await new Promise(r => setTimeout(r, DELAY_MS))
    }
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`🎉 Done! ${totalUpdated} unique tracks updated across all users`)
  console.log('(Each unique track update covers all users who share that track)\n')
  console.log('Run this SQL to verify:')
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
