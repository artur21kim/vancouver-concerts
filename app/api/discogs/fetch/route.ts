import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { discogsFetch } from '@/lib/discogs/oauth'

// Fetches one page (up to 100 releases) of the user's Discogs collection per call.
// The client loops, passing next_url as {cursor} in the body until has_more is false.
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: tokenData, error: tokenError } = await supabase
      .from('user_discogs_tokens')
      .select('access_token, access_token_secret, discogs_username, status, releases_fetched, total_releases')
      .eq('user_id', user.id)
      .single()

    if (tokenError || !tokenData) {
      return NextResponse.json({ error: 'Discogs not connected.' }, { status: 404 })
    }

    if (!tokenData.discogs_username) {
      return NextResponse.json({ error: 'Discogs username missing — please reconnect.' }, { status: 400 })
    }

    // Short-circuit if already complete
    if (tokenData.status === 'complete') {
      return NextResponse.json({
        status: 'complete',
        releases_fetched: tokenData.releases_fetched,
        total_releases: tokenData.total_releases,
        has_more: false,
      })
    }

    // Mark as processing on first call
    if (!tokenData.status || tokenData.status === 'pending') {
      await supabase
        .from('user_discogs_tokens')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
    }

    const token = {
      key: tokenData.access_token,
      secret: tokenData.access_token_secret,
    }

    // Caller passes next_url from previous response as {cursor}; first call omits it
    const body = await request.json().catch(() => ({}))
    const url: string =
      body.cursor ??
      `https://api.discogs.com/users/${encodeURIComponent(tokenData.discogs_username)}/collection/folders/0/releases?per_page=100&sort=added&sort_order=desc`

    console.log(`💿 Discogs fetch: page for user ${user.id}`)

    const res = await discogsFetch('GET', url, token)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.error(`❌ Discogs API error (${res.status}): ${errBody}`)

      await supabase
        .from('user_discogs_tokens')
        .update({ status: 'error', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)

      return NextResponse.json(
        { error: `Discogs API error ${res.status}` },
        { status: res.status === 401 ? 401 : 502 }
      )
    }

    const data = await res.json()
    const releases: any[] = data.releases ?? []
    const nextUrl: string | null = data.pagination?.urls?.next ?? null
    // Use pagination.items as the authoritative total; fall back to what's already stored
    const totalReleases: number = data.pagination?.items ?? tokenData.total_releases ?? 0

    console.log(
      `💿 Got ${releases.length} releases — user ${user.id}` +
        (nextUrl ? ' (more pages)' : ' (last page)')
    )

    // Transform to DB rows — "Various Artists" and multi-artist releases stored as-is (no matching)
    const toUpsert = releases.map((r: any) => ({
      user_id: user.id,
      discogs_release_id: r.id,
      discogs_instance_id: r.instance_id,
      discogs_master_id: r.basic_information?.master_id ?? null,
      title: r.basic_information?.title ?? 'Unknown',
      year: r.basic_information?.year ?? null,
      formats: r.basic_information?.formats ?? null,
      discogs_artist_names: (r.basic_information?.artists ?? []).map((a: any) => a.name),
      discogs_artist_ids: (r.basic_information?.artists ?? []).map((a: any) => a.id),
      labels: r.basic_information?.labels ?? null,
      date_added: r.date_added ?? null,
    }))

    if (toUpsert.length > 0) {
      const { error: upsertError } = await supabase
        .from('user_discogs_releases')
        .upsert(toUpsert, {
          onConflict: 'user_id,discogs_instance_id',
          ignoreDuplicates: false,
        })

      if (upsertError) {
        console.error('❌ Supabase upsert error:', upsertError.message)
        // Non-fatal — continue to update status so the client loop can see progress
      }
    }

    const newFetched = (tokenData.releases_fetched ?? 0) + releases.length
    const isComplete = !nextUrl

    await supabase
      .from('user_discogs_tokens')
      .update({
        status: isComplete ? 'complete' : 'processing',
        releases_fetched: newFetched,
        total_releases: totalReleases,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    if (isComplete) {
      console.log(`✅ Discogs import complete: ${newFetched} releases for user ${user.id}`)
    }

    return NextResponse.json({
      status: isComplete ? 'complete' : 'processing',
      releases_fetched: newFetched,
      total_releases: totalReleases,
      next_url: nextUrl,
      has_more: !isComplete,
    })
  } catch (error) {
    console.error('❌ Discogs fetch error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
