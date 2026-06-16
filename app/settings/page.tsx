'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/app/providers/AuthProvider'
import Navigation from '@/app/components/Navigation'

type ProfileSettings = {
  username: string
  bio: string | null
  profile_visibility: 'public' | 'friends' | 'private'
  spotify_connected: boolean
  show_spotify_stats: boolean
  discogs_connected: boolean | null
  discogs_username: string | null
}

type DiscogsImportProgress = {
  fetched: number
  total: number
  status: string
}

const VISIBILITY_OPTIONS: {
  value: 'public' | 'friends' | 'private'
  label: string
  description: string
}[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can view your profile',
  },
  {
    value: 'friends',
    label: 'Friends Only',
    description: 'Only friends can view your profile',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Your profile is hidden from everyone',
  },
]

export default function SettingsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const supabase = createClient()

  const [settings, setSettings] = useState<ProfileSettings | null>(null)
  const [bio, setBio] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'friends' | 'private'>('public')
  const [showSpotifyStats, setShowSpotifyStats] = useState(false)
  const [discogsConnected, setDiscogsConnected] = useState(false)
  const [discogsFlash, setDiscogsFlash] = useState<'connected' | 'error' | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Avatar refresh state
  const [avatarRefreshing, setAvatarRefreshing] = useState(false)
  const [avatarRefreshStatus, setAvatarRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [avatarRefreshMsg, setAvatarRefreshMsg] = useState('')

  // Delete account state
  const [deleteInput, setDeleteInput] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // SCRUM-81: Referral count
  const [referralCount, setReferralCount] = useState<number>(0)

  // SCRUM-117: Discogs collection import progress
  const [discogsImporting, setDiscogsImporting] = useState(false)
  const [discogsImportProgress, setDiscogsImportProgress] = useState<DiscogsImportProgress | null>(null)

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/')
  }, [user, authLoading, router])

  // SCRUM-117: Loop through paginated Discogs fetch until complete
  const runDiscogsImport = useCallback(async () => {
    setDiscogsImporting(true)
    setDiscogsImportProgress(null)
    let cursor: string | null = null

    try {
      while (true) {
        const res: Response = await fetch('/api/discogs/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cursor ? { cursor } : {}),
        })

        if (!res.ok) {
          console.error('Discogs import request failed:', res.status)
          break
        }

        const data = await res.json()

        setDiscogsImportProgress({
          fetched: data.releases_fetched,
          total: data.total_releases,
          status: data.status,
        })

        if (!data.has_more || data.status === 'complete') break

        cursor = data.next_url
        // Brief pause between pages (Discogs rate limit: 60 req/min)
        await new Promise(r => setTimeout(r, 400))
      }
    } catch (err) {
      console.error('Discogs import error:', err)
    } finally {
      setDiscogsImporting(false)
    }
  }, [])

  // Handle ?discogs= URL param set after OAuth redirect; auto-trigger import on connect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const discogsParam = params.get('discogs')
    if (discogsParam === 'connected') {
      setDiscogsFlash('connected')
      window.history.replaceState({}, '', '/settings')
      setTimeout(() => setDiscogsFlash(null), 5000)
      runDiscogsImport()
    } else if (discogsParam === 'error') {
      setDiscogsFlash('error')
      window.history.replaceState({}, '', '/settings')
    }
  }, [runDiscogsImport])

  // Load current settings
  useEffect(() => {
    if (!user) return
    const fetchSettings = async () => {
      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('username, bio, profile_visibility, spotify_connected, show_spotify_stats, discogs_connected, discogs_username')
        .eq('user_id', user.id)
        .single()

      if (fetchError || !data) {
        setError('Failed to load settings.')
        setPageLoading(false)
        return
      }

      const p = data as ProfileSettings
      setSettings(p)
      setBio(p.bio ?? '')
      setVisibility((p.profile_visibility ?? 'public') as typeof visibility)
      setShowSpotifyStats(p.show_spotify_stats ?? false)
      setDiscogsConnected(p.discogs_connected ?? false)

      // SCRUM-81: Fetch referral count in the same load cycle
      const { count: refCount } = await supabase
        .from('user_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('referred_by', user.id)
      setReferralCount(refCount ?? 0)

      setPageLoading(false)
    }
    fetchSettings()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    setError(null)
    setSaved(false)

    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        bio: bio.trim() || null,
        profile_visibility: visibility,
        show_spotify_stats: showSpotifyStats,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)

    setSaving(false)

    if (updateError) {
      setError('Failed to save settings. Please try again.')
    } else {
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const handleRefreshAvatar = async () => {
    setAvatarRefreshing(true)
    setAvatarRefreshStatus('idle')
    setAvatarRefreshMsg('')

    try {
      const res = await fetch('/api/user/refresh-spotify-avatar', { method: 'POST' })
      const data = await res.json()

      if (!res.ok) {
        setAvatarRefreshStatus('error')
        setAvatarRefreshMsg(data.error || 'Failed to refresh avatar.')
      } else {
        setAvatarRefreshStatus('success')
        setAvatarRefreshMsg('Avatar updated! Refresh the page to see it.')
        setTimeout(() => setAvatarRefreshStatus('idle'), 4000)
      }
    } catch {
      setAvatarRefreshStatus('error')
      setAvatarRefreshMsg('Network error. Please try again.')
    } finally {
      setAvatarRefreshing(false)
    }
  }

  const handleDeleteAccount = async () => {
    if (!settings || deleteInput !== settings.username) return
    setDeleting(true)
    setDeleteError(null)

    try {
      const res = await fetch('/api/user/delete-account', { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to delete account.')
      }
      await supabase.auth.signOut()
      router.push('/')
    } catch (err: any) {
      setDeleteError(err.message)
      setDeleting(false)
    }
  }

  if (authLoading || !user) return null

  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-5">
          <h1 className="text-3xl font-bold text-foreground">Settings</h1>

          {pageLoading ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : (
            <>
              {/* ── Profile section ── */}
              <section className="bg-card rounded-lg shadow p-5 space-y-5">
                <h2 className="text-base font-semibold text-foreground">Profile</h2>

                {/* Username — read only */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Username</label>
                  <div className="px-3 py-2 bg-background border border-border rounded-md text-sm text-muted-foreground">
                    {settings?.username}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Username changes are not supported yet.
                  </p>
                </div>

                {/* Bio */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">Bio</label>
                  <textarea
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    maxLength={200}
                    rows={3}
                    placeholder="Tell people about your concert history..."
                    className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors resize-none"
                  />
                  <p className="text-xs text-muted-foreground text-right tabular-nums">
                    {bio.length} / 200
                  </p>
                </div>

                {/* Profile visibility */}
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    Profile Visibility
                  </label>
                  <div className="flex rounded-lg border border-border overflow-hidden text-sm font-semibold">
                    {VISIBILITY_OPTIONS.map((opt, i) => (
                      <button
                        key={opt.value}
                        onClick={() => setVisibility(opt.value)}
                        className={`flex-1 px-3 py-2.5 transition-colors ${
                          i > 0 ? 'border-l border-border' : ''
                        } ${
                          visibility === opt.value
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {VISIBILITY_OPTIONS.find(o => o.value === visibility)?.description}
                  </p>
                </div>
              </section>

              {/* ── Spotify section — only when connected ── */}
              {settings?.spotify_connected && (
                <section className="bg-card rounded-lg shadow p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="#1DB954">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                    </svg>
                    <h2 className="text-base font-semibold text-foreground">Spotify</h2>
                  </div>

                  {/* Show Spotify stats toggle */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Show Spotify stats on profile
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Display your matched show count on your public profile
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSpotifyStats(v => !v)}
                      role="switch"
                      aria-checked={showSpotifyStats}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${
                        showSpotifyStats ? 'bg-primary' : 'bg-muted'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                          showSpotifyStats ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Avatar refresh */}
                  <div className="border-t border-border">
                    <div className="flex items-center justify-between gap-4 pt-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Profile picture</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Sync your avatar from Spotify
                        </p>
                      </div>
                      <button
                        onClick={handleRefreshAvatar}
                        disabled={avatarRefreshing}
                        className="px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary text-xs font-semibold rounded-lg hover:bg-primary/20 transition-colors disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                      >
                        {avatarRefreshing && (
                          <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current" />
                        )}
                        {avatarRefreshing ? 'Refreshing…' : 'Refresh from Spotify'}
                      </button>
                    </div>
                    {avatarRefreshStatus !== 'idle' && (
                      <p className={`mt-1.5 text-xs font-medium ${
                        avatarRefreshStatus === 'success' ? 'text-green-500' : 'text-destructive'
                      }`}>
                        {avatarRefreshMsg}
                      </p>
                    )}
                  </div>
                </section>
              )}

              {/* ── Discogs section (SCRUM-116 / SCRUM-117) ── */}
              <section className="bg-card rounded-lg shadow p-5 space-y-4">
                <div className="flex items-center gap-2">
                  {/* Vinyl record icon */}
                  <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0 text-foreground" fill="currentColor">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z" />
                  </svg>
                  <h2 className="text-base font-semibold text-foreground">Discogs</h2>
                  {discogsConnected && (
                    <span className="text-xs font-medium text-green-500">Connected</span>
                  )}
                </div>

                {/* Flash messages from OAuth redirect */}
                {discogsFlash === 'connected' && (
                  <p className="text-sm font-medium text-green-500">
                    Discogs connected successfully!
                  </p>
                )}
                {discogsFlash === 'error' && (
                  <p className="text-sm font-medium text-destructive">
                    Failed to connect Discogs. Please try again.
                  </p>
                )}

                {discogsConnected ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">Vinyl collection</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {settings?.discogs_username
                            ? `Connected as @${settings.discogs_username}`
                            : 'Your Discogs library is connected'}
                        </p>
                      </div>
                      <a
                        href="/api/auth/discogs"
                        className="px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary text-xs font-semibold rounded-lg hover:bg-primary/20 transition-colors flex-shrink-0"
                      >
                        Reconnect
                      </a>
                    </div>

                    {/* SCRUM-117: Import progress */}
                    {discogsImporting && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary flex-shrink-0" />
                        <span>
                          {discogsImportProgress
                            ? `Importing ${discogsImportProgress.fetched}${discogsImportProgress.total > 0 ? ` / ${discogsImportProgress.total}` : ''} releases…`
                            : 'Starting import…'}
                        </span>
                      </div>
                    )}
                    {!discogsImporting && discogsImportProgress?.status === 'complete' && (
                      <p className="text-xs font-medium text-green-500">
                        ✓ {discogsImportProgress.fetched} releases imported
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        Connect your vinyl collection
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Import your Discogs library to see your vinyl alongside concerts and Spotify
                      </p>
                    </div>
                    <a
                      href="/api/auth/discogs"
                      className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 transition-colors flex-shrink-0 whitespace-nowrap"
                    >
                      Connect Discogs
                    </a>
                  </div>
                )}
              </section>

              {/* ── SCRUM-81: Referrals section ── */}
              <section className="bg-card rounded-lg shadow p-5 space-y-3">
                <h2 className="text-base font-semibold text-foreground">Referrals</h2>
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">Users you've referred</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      People who signed up using your profile link
                    </p>
                  </div>
                  <span className="text-2xl font-bold text-primary tabular-nums flex-shrink-0">
                    {referralCount}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground border-t border-border pt-3">
                  Share your profile link from your{' '}
                  <a
                    href={`/profile/${settings?.username}`}
                    className="text-primary hover:underline transition-colors"
                  >
                    profile page
                  </a>{' '}
                  to refer new users.
                </p>
              </section>

              {/* ── Save button ── */}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:bg-primary/90 transition disabled:opacity-50 flex items-center gap-2"
                >
                  {saving && (
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current" />
                  )}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
                {saved && (
                  <span className="text-sm font-medium text-green-500">Saved!</span>
                )}
                {error && (
                  <span className="text-sm text-destructive">{error}</span>
                )}
              </div>

              {/* ── Danger Zone ── */}
              <section className="bg-card rounded-lg shadow border border-destructive/30 p-5 space-y-4">
                <h2 className="text-base font-semibold text-destructive">Danger Zone</h2>

                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Delete Account</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Permanently deletes your account, concert history, Spotify library data,
                      friend connections, and all associated information. This action is
                      irreversible and cannot be undone.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs text-muted-foreground">
                      Type{' '}
                      <span className="font-mono font-semibold text-foreground">
                        {settings?.username}
                      </span>{' '}
                      to confirm
                    </label>
                    <input
                      type="text"
                      value={deleteInput}
                      onChange={e => {
                        setDeleteInput(e.target.value)
                        setDeleteError(null)
                      }}
                      placeholder={settings?.username ?? ''}
                      disabled={deleting}
                      className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-destructive/50 transition-colors disabled:opacity-50"
                    />
                  </div>

                  {deleteError && (
                    <p className="text-xs text-destructive">{deleteError}</p>
                  )}

                  <button
                    onClick={handleDeleteAccount}
                    disabled={!settings || deleteInput !== settings.username || deleting}
                    className="px-4 py-2 bg-destructive text-white text-sm font-semibold rounded-lg hover:bg-destructive/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {deleting && (
                      <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-current" />
                    )}
                    {deleting ? 'Deleting account…' : 'Delete My Account'}
                  </button>
                </div>
              </section>

            </>
          )}
        </div>
      </main>
    </>
  )
}
