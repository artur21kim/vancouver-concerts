'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/app/providers/AuthProvider'
import Navigation from '@/app/components/Navigation'
import Avatar from '@/app/components/Avatar'

type SearchUser = {
  user_id: string
  username: string
  avatar_url: string | null
  friendship_status: string | null
  request_direction: string | null
}

type PendingRequest = {
  request_id: number
  from_user_id: string
  username: string
  avatar_url: string | null
  created_at: string
}

type Friend = {
  friend_id: string
  username: string
  avatar_url: string | null
}

export default function FriendsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const supabase = createClient()

  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([])
  const [friends, setFriends] = useState<Friend[]>([])
  const [dataLoading, setDataLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) router.replace('/')
  }, [user, authLoading, router])

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!user) return
    setDataLoading(true)
    try {
      const [{ data: pending }, { data: friendList }] = await Promise.all([
        supabase.rpc('get_pending_requests'),
        supabase.rpc('get_my_friends'),
      ])
      setPendingRequests(pending ?? [])
      setFriends(friendList ?? [])
    } catch (e) {
      console.error('Error loading friends data:', e)
    } finally {
      setDataLoading(false)
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) loadData()
  }, [user, loadData])

  // ── Debounced search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    if (searchTerm.length < 2) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    searchTimerRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_users_by_username', { search_term: searchTerm })
        setSearchResults(data ?? [])
      } catch (e) {
        console.error('Search error:', e)
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchTerm]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Action helpers ────────────────────────────────────────────────────────
  const setLoad = (key: string, val: boolean) =>
    setActionLoading(prev => ({ ...prev, [key]: val }))

  const patchSearch = (userId: string, patch: Partial<SearchUser>) =>
    setSearchResults(prev => prev.map(r => r.user_id === userId ? { ...r, ...patch } : r))

  const handleSendRequest = async (targetUserId: string) => {
    setLoad(targetUserId, true)
    try {
      await supabase.rpc('send_friend_request', { target_user_id: targetUserId })
      patchSearch(targetUserId, { friendship_status: 'pending', request_direction: 'outgoing' })
    } catch (e) {
      console.error('Error sending request:', e)
    } finally {
      setLoad(targetUserId, false)
    }
  }

  const handleCancelRequest = async (targetUserId: string) => {
    const key = `${targetUserId}_cancel`
    setLoad(key, true)
    try {
      await supabase.from('user_friends').delete()
        .eq('friend_id', targetUserId)
        .eq('status', 'pending')
      patchSearch(targetUserId, { friendship_status: null, request_direction: null })
    } catch (e) {
      console.error('Error canceling request:', e)
    } finally {
      setLoad(key, false)
    }
  }

  const handleRespond = async (req: PendingRequest, status: 'accepted' | 'rejected') => {
    const key = `${req.request_id}_respond`
    setLoad(key, true)
    try {
      await supabase.rpc('respond_to_friend_request', {
        request_id: req.request_id,
        new_status: status,
      })
      setPendingRequests(prev => prev.filter(r => r.request_id !== req.request_id))
      patchSearch(req.from_user_id, {
        friendship_status: status === 'accepted' ? 'accepted' : null,
        request_direction: null,
      })
      if (status === 'accepted') {
        const { data } = await supabase.rpc('get_my_friends')
        setFriends(data ?? [])
      }
    } catch (e) {
      console.error('Error responding to request:', e)
    } finally {
      setLoad(key, false)
    }
  }

  const handleRespondFromSearch = async (result: SearchUser, status: 'accepted' | 'rejected') => {
    const pending = pendingRequests.find(r => r.from_user_id === result.user_id)
    if (!pending) return
    await handleRespond(pending, status)
  }

  // ── Render guards ─────────────────────────────────────────────────────────
  if (authLoading || !user) return null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Navigation />
      <main className="min-h-screen bg-background py-8 px-4">
        <div className="max-w-2xl mx-auto space-y-5">
          <h1 className="text-3xl font-bold text-foreground">Friends</h1>

          {/* ── Search ── */}
          <section className="bg-card rounded-lg shadow p-4 md:p-5 space-y-3">
            <h2 className="text-base font-semibold text-foreground">Find People</h2>
            <input
              type="text"
              placeholder="Search by username…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-colors"
            />

            {searchLoading && (
              <div className="flex justify-center py-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
              </div>
            )}

            {!searchLoading && searchTerm.length >= 2 && searchResults.length === 0 && (
              <p className="text-sm text-muted-foreground">No users found.</p>
            )}

            {searchResults.length > 0 && (
              <div className="divide-y divide-border">
                {searchResults.map(result => {
                  const pending = pendingRequests.find(r => r.from_user_id === result.user_id)
                  const respondKey = `${pending?.request_id}_respond`
                  return (
                    <div key={result.user_id} className="flex items-center gap-3 py-2.5">
                      <Avatar avatarUrl={result.avatar_url} username={result.username} size="sm" />
                      <span className="flex-1 text-sm font-medium text-foreground min-w-0 truncate">
                        {result.username}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">

                        {!result.friendship_status && (
                          <button
                            onClick={() => handleSendRequest(result.user_id)}
                            disabled={actionLoading[result.user_id]}
                            className="px-3 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition disabled:opacity-50"
                          >
                            Add Friend
                          </button>
                        )}

                        {result.friendship_status === 'pending' && result.request_direction === 'outgoing' && (
                          <>
                            <span className="text-xs text-muted-foreground">Request Sent</span>
                            <button
                              onClick={() => handleCancelRequest(result.user_id)}
                              disabled={actionLoading[`${result.user_id}_cancel`]}
                              className="px-3 py-1 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:text-foreground transition disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        )}

                        {result.friendship_status === 'pending' && result.request_direction === 'incoming' && (
                          <>
                            <button
                              onClick={() => handleRespondFromSearch(result, 'accepted')}
                              disabled={actionLoading[respondKey]}
                              className="px-3 py-1 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50"
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => handleRespondFromSearch(result, 'rejected')}
                              disabled={actionLoading[respondKey]}
                              className="px-3 py-1 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive transition disabled:opacity-50"
                            >
                              Reject
                            </button>
                          </>
                        )}

                        {result.friendship_status === 'accepted' && (
                          <>
                            <span className="text-xs text-primary font-medium">Friends ✓</span>
                            <a
                              href={`/profile/${result.username}/shows`}
                              className="px-3 py-1 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:text-foreground transition"
                            >
                              View Profile
                            </a>
                          </>
                        )}

                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* ── Pending Requests ── */}
          {!dataLoading && pendingRequests.length > 0 && (
            <section className="bg-card rounded-lg shadow p-4 md:p-5 space-y-3">
              <h2 className="text-base font-semibold text-foreground">
                Friend Requests
                <span className="ml-2 text-sm font-normal text-muted-foreground">({pendingRequests.length})</span>
              </h2>
              <div className="divide-y divide-border">
                {pendingRequests.map(req => (
                  <div key={req.request_id} className="flex items-center gap-3 py-2.5">
                    <Avatar avatarUrl={req.avatar_url} username={req.username} size="sm" />
                    <span className="flex-1 text-sm font-medium text-foreground min-w-0 truncate">
                      {req.username}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleRespond(req, 'accepted')}
                        disabled={actionLoading[`${req.request_id}_respond`]}
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 transition disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleRespond(req, 'rejected')}
                        disabled={actionLoading[`${req.request_id}_respond`]}
                        className="px-3 py-1 text-xs font-semibold rounded-md border border-border text-muted-foreground hover:text-destructive hover:border-destructive transition disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── My Friends ── */}
          <section className="bg-card rounded-lg shadow p-4 md:p-5 space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              My Friends
              {!dataLoading && friends.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({friends.length})</span>
              )}
            </h2>

            {dataLoading ? (
              <div className="flex justify-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
              </div>
            ) : friends.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No friends yet. Search for users above to add them!
              </p>
            ) : (
              <div className="divide-y divide-border">
                {friends.map(friend => (
                  <div key={friend.friend_id} className="flex items-center gap-3 py-2.5">
                    <Avatar avatarUrl={friend.avatar_url} username={friend.username} size="sm" />
                    <span className="flex-1 text-sm font-medium text-foreground min-w-0 truncate">
                      {friend.username}
                    </span>
                    {/* GP-122: Profile button removed; Shows → Grooveprint */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <a
                        href={`/profile/${friend.username}/shows`}
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-muted text-foreground hover:bg-muted/70 transition"
                      >
                        Grooveprint
                      </a>
                      <a
                        href={`/profile/${friend.username}/shows?compare=true`}
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition"
                      >
                        Compare
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

        </div>
      </main>
    </>
  )
}
