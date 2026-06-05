'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Navigation from '@/app/components/Navigation'
import { QRCodeSVG } from 'qrcode.react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TopArtist = {
  artist_id: number
  artist_name: string
  spotify_artist_id: string | null
  show_count: number
}

type TopVenue = {
  venue_id: number
  venue_name: string
  capacity_category: string | null
  capacity: number | null
  show_count: number
}

type FullProfile = {
  user_id: string
  username: string
  bio: string | null
  avatar_url: string | null
  profile_visibility: string
  spotify_connected: boolean
  show_spotify_stats: boolean
  spotify_matched_shows: number | null
  first_concert_year: number | null
  is_own_profile: boolean
  friendship_status: 'accepted' | 'pending' | null
  request_direction: 'incoming' | 'outgoing' | null
  request_id: number | null
  confirmed_shows: number
  unique_artists: number
  unique_venues: number
  festival_count: number
  first_show_year: number | null
  last_show_year: number | null
  spotify_song_count: number | null
  spotify_artist_count: number | null
  top_artists: TopArtist[]
  top_venues: TopVenue[]
}

type RestrictedProfile = {
  username: string
  avatar_url: string | null
  visibility: 'private' | 'friends'
}

type ProfileData = FullProfile | RestrictedProfile

type SharedArtist = {
  artist_id: number
  artist_name: string
  spotify_artist_id: string | null
  my_show_count: number
  their_show_count: number
}

// ─── Capacity helpers ─────────────────────────────────────────────────────────

function getCapacityKey(category: string | null): string {
  if (!category) return 'unknown'
  const c = category.toLowerCase()
  if (c.includes('x-large') || c.includes('10k')) return 'xlarge'
  if (c.includes('large'))  return 'large'
  if (c.includes('medium')) return 'medium'
  if (c.includes('small'))  return 'small'
  return 'unknown'
}

// Inline styles required — Tailwind JIT purges dynamic class names
const CAPACITY_STYLES: Record<string, { bg: string; text: string; letter: string }> = {
  small:   { bg: 'rgba(139,92,246,0.15)',  text: '#a78bfa', letter: 'S'  },
  medium:  { bg: 'rgba(58,143,189,0.15)',  text: '#3A8FBD', letter: 'M'  },
  large:   { bg: 'rgba(234,88,12,0.15)',   text: '#f97316', letter: 'L'  },
  xlarge:  { bg: 'rgba(225,29,72,0.15)',   text: '#fb7185', letter: 'XL' },
  unknown: { bg: 'rgba(156,163,175,0.10)', text: '#9ca3af', letter: '?'  },
}

function isRestricted(p: ProfileData): p is RestrictedProfile {
  return 'visibility' in p
}

// ─── Spotify icon ─────────────────────────────────────────────────────────────

function SpotifyLink({ artistId }: { artistId: string }) {
  return (
    <a
      href={`https://open.spotify.com/artist/${artistId}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in Spotify"
      onClick={e => e.stopPropagation()}
      className="flex-shrink-0 hover:opacity-70 transition-opacity"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="#1DB954">
        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
      </svg>
    </a>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function AvatarDisplay({
  username,
  avatarUrl,
  sizePx = 80,
}: {
  username: string
  avatarUrl: string | null
  sizePx?: number
}) {
  const [imgError, setImgError] = useState(false)
  const initial = username?.[0]?.toUpperCase() ?? '?'

  const baseStyle = {
    width: sizePx,
    height: sizePx,
    borderRadius: '50%',
    flexShrink: 0,
  }

  if (avatarUrl && !imgError) {
    return (
      <img
        src={avatarUrl}
        alt={username}
        onError={() => setImgError(true)}
        style={{ ...baseStyle, objectFit: 'cover' as const }}
        className="ring-2 ring-white/10"
      />
    )
  }

  return (
    <div
      style={{
        ...baseStyle,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(20,184,166,0.15)',
        border: '2px solid rgba(20,184,166,0.3)',
        fontSize: Math.round(sizePx * 0.36),
        fontWeight: 700,
        color: '#2dd4bf',
      }}
    >
      {initial}
    </div>
  )
}

// ─── Comparison Modal ─────────────────────────────────────────────────────────

function ComparisonModal({
  profile,
  viewerUsername,
  viewerAvatarUrl,
  onClose,
}: {
  profile: FullProfile
  viewerUsername: string
  viewerAvatarUrl: string | null
  onClose: () => void
}) {
  const [artists, setArtists] = useState<SharedArtist[]>([])
  const [spotifyStats, setSpotifyStats] = useState<{ shared_songs: number; shared_artists: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    async function fetchShared() {
      const { data: { user } } = await supabase.auth.getUser()
      const viewerId = user?.id ?? null

      const [artistsResult, spotifyResult] = await Promise.all([
        supabase.rpc('get_shared_artists', {
          friend_user_id: profile.user_id,
          viewer_user_id: viewerId,
        }),
        supabase.rpc('get_shared_spotify_stats', {
          friend_user_id: profile.user_id,
          viewer_user_id: viewerId,
        }),
      ])

      if (!artistsResult.error && artistsResult.data) {
        setArtists(artistsResult.data as SharedArtist[])
      }
      if (!spotifyResult.error && spotifyResult.data) {
        const stats = spotifyResult.data as { shared_songs: number; shared_artists: number }
        if (stats.shared_songs > 0 || stats.shared_artists > 0) {
          setSpotifyStats(stats)
        }
      }
      setLoading(false)
    }
    fetchShared()
  }, [profile.user_id])

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div className="bg-card border border-white/10 rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex">
              <div style={{ zIndex: 1 }}>
                <AvatarDisplay username={viewerUsername} avatarUrl={viewerAvatarUrl} sizePx={32} />
              </div>
              <div style={{ marginLeft: -8 }}>
                <AvatarDisplay username={profile.username} avatarUrl={profile.avatar_url} sizePx={32} />
              </div>
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">
                You &amp; {profile.username}
              </p>
              {spotifyStats && (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="#1DB954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                  <span className="text-xs text-primary font-medium tabular-nums">
                    {spotifyStats.shared_songs.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">songs</span>
                  <span className="text-white/20 text-xs">·</span>
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="#1DB954">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                  </svg>
                  <span className="text-xs text-primary font-medium tabular-nums">
                    {spotifyStats.shared_artists.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground">artists</span>
                </div>
              )}
              {!loading && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {artists.length} shared artist{artists.length !== 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-white/5 text-sm"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 py-3">
          {loading ? (
            <div className="flex justify-center py-10">
              <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : artists.length === 0 ? (
            <div className="text-center py-10 px-6">
              <p className="text-2xl mb-2">🎵</p>
              <p className="text-muted-foreground text-sm">No shared artists yet — attend some shows together!</p>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2 px-5 pb-2">
                <span className="w-6 shrink-0" />
                <span className="flex-1 text-xs text-muted-foreground">Artist</span>
                <span className="w-10 text-center text-xs font-medium text-primary">You</span>
                <span className="w-14 text-center text-xs text-muted-foreground">{profile.username}</span>
              </div>
              {artists.map((a, i) => (
                <div
                  key={a.artist_id}
                  className="flex items-center gap-2 px-5 py-2.5 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-bold text-teal-400 w-6 shrink-0">
                    #{i + 1}
                  </span>
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm text-primary truncate">
                      {a.artist_name}
                    </span>
                    {a.spotify_artist_id && (
                      <SpotifyLink artistId={a.spotify_artist_id} />
                    )}
                  </div>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums text-primary">
                    {a.my_show_count}
                  </span>
                  <span className="w-14 text-center text-sm tabular-nums text-muted-foreground">
                    {a.their_show_count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="w-5 h-5 border-2 border-teal-400 border-t-transparent rounded-full animate-spin" />
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const params = useParams()
  const username = params?.username as string

  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [pageLoading, setPageLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [viewerUsername, setViewerUsername] = useState('')
  const [viewerAvatarUrl, setViewerAvatarUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const supabase = createClient()

  const fetchProfile = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_user_profile', {
      target_username: username,
    })
    if (error || data === null) {
      setNotFound(true)
    } else {
      setProfile(data as ProfileData)
    }
    setPageLoading(false)
  }, [username])

  useEffect(() => {
    fetchProfile()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      supabase
        .from('user_profiles')
        .select('username, avatar_url')
        .eq('user_id', user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setViewerUsername(data.username ?? '')
            setViewerAvatarUrl(data.avatar_url ?? null)
          }
        })
    })
  }, [fetchProfile])

  // ─── Friendship actions ────────────────────────────────────────────────────

  const handleAddFriend = async (targetUserId: string) => {
    setActionLoading(true)
    await supabase.rpc('send_friend_request', { target_user_id: targetUserId })
    await fetchProfile()
    setActionLoading(false)
  }

  const handleCancelRequest = async (targetUserId: string) => {
    setActionLoading(true)
    await supabase.rpc('cancel_friend_request', { target_user_id: targetUserId })
    await fetchProfile()
    setActionLoading(false)
  }

  const handleRespond = async (requestId: number, action: 'accept' | 'reject') => {
    setActionLoading(true)
    await supabase.rpc('respond_to_friend_request', {
      request_id: requestId,
      new_status: action === 'accept' ? 'accepted' : 'rejected',
    })
    await fetchProfile()
    setActionLoading(false)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(`https://grooveprint.app/profile/${username}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ─── Render: loading ───────────────────────────────────────────────────────

  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="flex items-center justify-center min-h-[60vh]">
          <Spinner />
        </div>
      </div>
    )
  }

  // ─── Render: not found ─────────────────────────────────────────────────────

  if (notFound || !profile) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="max-w-2xl mx-auto px-4 py-20 text-center">
          <p className="text-4xl mb-4">👤</p>
          <h1 className="text-xl font-semibold text-primary mb-2">User not found</h1>
          <p className="text-sm text-muted-foreground">
            No Grooveprint user exists with the username{' '}
            <span className="font-mono text-primary">@{username}</span>.
          </p>
        </div>
      </div>
    )
  }

  // ─── Render: restricted profile ────────────────────────────────────────────

  if (isRestricted(profile)) {
    return (
      <div className="min-h-screen bg-background">
        <Navigation />
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="bg-card border border-white/10 rounded-2xl p-10 flex flex-col items-center text-center gap-4">
            <AvatarDisplay username={profile.username} avatarUrl={profile.avatar_url} sizePx={80} />
            <h1 className="text-xl font-semibold text-primary">@{profile.username}</h1>
            <p className="text-3xl">
              {profile.visibility === 'private' ? '🔒' : '👥'}
            </p>
            <p className="text-sm text-muted-foreground max-w-xs">
              {profile.visibility === 'private'
                ? 'This profile is private.'
                : `Add ${profile.username} as a friend to view their profile.`}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ─── Render: full profile ──────────────────────────────────────────────────

  const p = profile as FullProfile

  const yearRange = p.first_show_year
    ? p.first_show_year === p.last_show_year
      ? String(p.first_show_year)
      : `${p.first_show_year}–${p.last_show_year}`
    : null

  const showSpotifyCard =
    p.show_spotify_stats &&
    p.spotify_connected &&
    (p.spotify_song_count != null && p.spotify_song_count > 0)

  return (
    <div className="min-h-screen bg-background">
      <Navigation />

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">

        {/* ── Header card ─────────────────────────────────────────────────── */}
        <div className="bg-card border border-white/10 rounded-2xl p-6">
          <div className="flex items-start gap-5 flex-wrap sm:flex-nowrap">

            {/* Left column: avatar always, QR below on mobile */}
            <div className="shrink-0 flex flex-col items-center gap-3">
              <AvatarDisplay username={p.username} avatarUrl={p.avatar_url} sizePx={80} />
              {p.is_own_profile && (
                <div className="sm:hidden bg-white rounded-xl p-1.5">
                  <QRCodeSVG
                    value={`https://grooveprint.app/profile/${username}`}
                    size={72}
                    bgColor="#ffffff"
                    fgColor="#0f172a"
                  />
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">

                {/* Name + bio + stats */}
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold text-primary truncate">
                    @{p.username}
                  </h1>
                  {p.bio && (
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm leading-relaxed">
                      {p.bio}
                    </p>
                  )}

                  {/* Stats summary: X shows · Y artists · Z venues · N festivals */}
                  <div className="flex items-center gap-1.5 mt-2 text-sm flex-wrap">
                    <span className="font-semibold text-primary">{p.confirmed_shows}</span>
                    <span className="text-muted-foreground">shows</span>
                    <span className="text-white/30">·</span>
                    <span className="font-semibold text-primary">{p.unique_artists}</span>
                    <span className="text-muted-foreground">artists</span>
                    <span className="text-white/30">·</span>
                    <span className="font-semibold text-primary">{p.unique_venues}</span>
                    <span className="text-muted-foreground">venues</span>
                    {p.festival_count > 0 && (
                      <>
                        <span className="text-white/30">·</span>
                        <span className="font-semibold text-primary">{p.festival_count}</span>
                        <span className="text-muted-foreground">
                          {p.festival_count === 1 ? 'festival' : 'festivals'}
                        </span>
                      </>
                    )}
                    {yearRange && (
                      <>
                        <span className="text-white/30">·</span>
                        <span className="text-primary font-medium">{yearRange}</span>
                      </>
                    )}
                  </div>

                  {/* Spotify library summary — separated from concert stats */}
                  {showSpotifyCard && (
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/10 text-sm flex-wrap">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 shrink-0" fill="#1DB954">
                        <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
                      </svg>
                      <span className="font-semibold text-primary">
                        {p.spotify_song_count?.toLocaleString()}
                      </span>
                      <span className="text-muted-foreground">songs</span>
                      {p.spotify_artist_count != null && p.spotify_artist_count > 0 && (
                        <>
                          <span className="text-white/30">·</span>
                          <span className="font-semibold text-primary">
                            {p.spotify_artist_count.toLocaleString()}
                          </span>
                          <span className="text-muted-foreground">artists</span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Right panel — QR share (own profile) or friendship buttons (others) */}
                {p.is_own_profile ? (
                  <div className="shrink-0 flex flex-col items-center gap-2">
                    {/* Desktop: QR code + Copy Link */}
                    <div className="hidden sm:flex flex-col items-center gap-2">
                      <div className="bg-white rounded-xl p-1.5 inline-block">
                        <QRCodeSVG
                          value={`https://grooveprint.app/profile/${username}`}
                          size={72}
                          bgColor="#ffffff"
                          fgColor="#0f172a"
                        />
                      </div>
                      <button
                        onClick={handleCopy}
                        className="w-full px-3 py-1.5 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 text-xs font-medium rounded-xl transition-colors border border-teal-500/20"
                      >
                        {copied ? 'Copied!' : 'Copy Link'}
                      </button>
                    </div>
                    {/* Mobile: Copy Link button only — QR not useful on own device */}
                    <button
                      onClick={handleCopy}
                      className="sm:hidden px-4 py-2 bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 text-sm font-medium rounded-xl transition-colors border border-teal-500/20"
                    >
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap shrink-0">

                    {p.friendship_status === null && (
                      <button
                        onClick={() => handleAddFriend(p.user_id)}
                        disabled={actionLoading}
                        className="px-4 py-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                      >
                        {actionLoading ? <Spinner /> : '+ Add Friend'}
                      </button>
                    )}

                    {p.friendship_status === 'pending' && p.request_direction === 'outgoing' && (
                      <>
                        <span className="px-4 py-2 bg-white/5 text-muted-foreground text-sm font-medium rounded-xl">
                          Request Sent
                        </span>
                        <button
                          onClick={() => handleCancelRequest(p.user_id)}
                          disabled={actionLoading}
                          className="px-3 py-2 border border-white/10 hover:bg-white/5 text-muted-foreground text-sm rounded-xl transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {p.friendship_status === 'pending' &&
                      p.request_direction === 'incoming' &&
                      p.request_id !== null && (
                        <>
                          <button
                            onClick={() => handleRespond(p.request_id!, 'accept')}
                            disabled={actionLoading}
                            className="px-4 py-2 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => handleRespond(p.request_id!, 'reject')}
                            disabled={actionLoading}
                            className="px-3 py-2 border border-white/10 hover:bg-white/5 text-muted-foreground text-sm rounded-xl transition-colors disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      )}

                    {p.friendship_status === 'accepted' && (
                      <>
                        <span className="px-4 py-2 bg-teal-500/10 text-teal-400 text-sm font-medium rounded-xl border border-teal-500/20">
                          Friends ✓
                        </span>
                        <button
                          onClick={() => setShowModal(true)}
                          className="px-4 py-2 bg-white/5 hover:bg-white/10 text-primary text-sm font-medium rounded-xl transition-colors border border-white/10"
                        >
                          Compare
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Top Artists + Top Venues ─────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Top Artists */}
          <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-sm font-semibold text-primary">Top Artists</h2>
            </div>
            {!p.top_artists || p.top_artists.length === 0 ? (
              <p className="text-sm text-muted-foreground px-5 py-6">No confirmed shows yet.</p>
            ) : (
              p.top_artists.map((artist, i) => (
                <div
                  key={artist.artist_id}
                  className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                >
                  <span className="text-xs font-bold text-teal-400 w-6 shrink-0 tabular-nums">
                    #{i + 1}
                  </span>
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="text-sm text-primary truncate">
                      {artist.artist_name}
                    </span>
                    {artist.spotify_artist_id && (
                      <SpotifyLink artistId={artist.spotify_artist_id} />
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {artist.show_count} {artist.show_count === 1 ? 'show' : 'shows'}
                  </span>
                  <span className="text-white/20 text-xs">›</span>
                </div>
              ))
            )}
          </div>

          {/* Top Venues */}
          <div className="bg-card border border-white/10 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10">
              <h2 className="text-sm font-semibold text-primary">Top Venues</h2>
            </div>
            {!p.top_venues || p.top_venues.length === 0 ? (
              <p className="text-sm text-muted-foreground px-5 py-6">No confirmed shows yet.</p>
            ) : (
              p.top_venues.map((venue, i) => {
                const capKey = getCapacityKey(venue.capacity_category)
                const capStyle = CAPACITY_STYLES[capKey]
                const capLabel = venue.capacity
                  ? `${capStyle.letter} · ${venue.capacity.toLocaleString()}`
                  : capStyle.letter

                return (
                  <div
                    key={venue.venue_id}
                    className="flex items-center gap-3 px-5 py-3 border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors"
                  >
                    <span className="text-xs font-bold text-teal-400 w-6 shrink-0 tabular-nums">
                      #{i + 1}
                    </span>
                    <div className="flex items-center gap-1.5 flex-1 min-w-0">
                      <span className="text-sm text-primary truncate">
                        {venue.venue_name}
                      </span>
                      <span
                        style={{ backgroundColor: capStyle.bg, color: capStyle.text }}
                        className="text-xs font-medium px-1.5 py-0.5 rounded-full shrink-0 tabular-nums"
                      >
                        {capLabel}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {venue.show_count} {venue.show_count === 1 ? 'show' : 'shows'}
                    </span>
                    <span className="text-white/20 text-xs">›</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

      </div>

      {/* ── Comparison modal ───────────────────────────────────────────────── */}
      {showModal && (
        <ComparisonModal
          profile={p}
          viewerUsername={viewerUsername}
          viewerAvatarUrl={viewerAvatarUrl}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
