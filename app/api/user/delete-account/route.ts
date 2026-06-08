import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

export async function POST() {
  try {
    // Verify the caller is authenticated via the normal server client
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const uid = user.id

    // Service role client — needed for auth.admin.deleteUser and to bypass RLS
    // on tables where the user's own rows might be referenced from other users
    // (e.g. user_friends has rows owned by both sides of the friendship).
    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Delete in dependency order. Log but don't abort on individual table failures —
    // the auth deletion is the critical step. Orphaned data behind a deleted auth
    // user is inaccessible to anyone and will be purged from backups within 90 days
    // per the Privacy Policy retention schedule.
    const deletions: { table: string; column: string }[] = [
      // user_friends: user may appear in either column depending on who sent the request
      { table: 'user_friends',        column: 'user_id'   },
      { table: 'user_friends',        column: 'friend_id' },
      { table: 'user_venues',         column: 'user_id'   },
      { table: 'user_artist_scores',  column: 'user_id'   },
      { table: 'user_show_reviews',   column: 'user_id'   },
      { table: 'user_shows',          column: 'user_id'   },
      { table: 'user_spotify_songs',  column: 'user_id'   },
      { table: 'user_spotify_tokens', column: 'user_id'   },
      { table: 'user_profiles',       column: 'user_id'   },
    ]

    for (const { table, column } of deletions) {
      const { error } = await admin.from(table).delete().eq(column, uid)
      if (error) {
        console.error(`❌ Failed to delete from ${table} (${column}=${uid}):`, error.message)
      }
    }

    // Final: remove the Supabase Auth identity. This is the point of no return.
    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(uid)
    if (deleteAuthError) {
      console.error('❌ Failed to delete auth user:', deleteAuthError)
      return NextResponse.json(
        { error: 'Failed to delete account. Please contact artur@grooveprint.app.' },
        { status: 500 }
      )
    }

    console.log(`✅ Account fully deleted for user ${uid}`)
    return NextResponse.json({ success: true })

  } catch (error) {
    console.error('❌ Account deletion error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
