'use client'

import { useState, useEffect } from 'react'
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
  const [pageLoading, setPageLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Avatar refresh state
  const [avatarRefreshing, setAvatarRefreshing] = useState(false)
  const [avatarRefreshStatus, setAvatarRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [avatarRefreshMsg, setAvatarRefreshMsg] = useState('')

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/')
  }, [user, authLoading, router])

  // Load current settings
  useEffect(() => {
    if (!user) return
    const fetchSettings = async () => {
      const { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('username, bio, profile_visibility, spotify_connected, show_spotify_stats')
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
            </>
          )}
        </div>
      </main>
    </>
  )
}
