'use client'

import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

// Minimal Show shape needed by the map — must match the Show type in page.tsx
type Show = {
  show_id: number
  date: string
  artist_name: string
  venue_id: number
  venue_name: string
  latitude: number | null
  longitude: number | null
  ticketmaster_url: string | null
  is_spotify_match: boolean
}

type VenuePin = {
  venue_id: number
  venue_name: string
  latitude: number
  longitude: number
  shows: Show[]
  hasSpotifyMatch: boolean
}

const TEAL = '#00BFA8'
const GRAY = 'rgba(156,163,175,0.8)'
const VANCOUVER_CENTER: [number, number] = [49.2827, -123.1207]

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export default function VenueMap({ shows }: { shows: Show[] }) {
  const venuePins = useMemo<VenuePin[]>(() => {
    const map = new Map<number, VenuePin>()
    for (const show of shows) {
      if (show.latitude == null || show.longitude == null) continue
      if (!map.has(show.venue_id)) {
        map.set(show.venue_id, {
          venue_id: show.venue_id,
          venue_name: show.venue_name,
          latitude: show.latitude,
          longitude: show.longitude,
          shows: [],
          hasSpotifyMatch: false,
        })
      }
      const pin = map.get(show.venue_id)!
      pin.shows.push(show)
      if (show.is_spotify_match) pin.hasSpotifyMatch = true
    }
    // Sort shows within each pin by date ascending
    for (const pin of map.values()) {
      pin.shows.sort((a, b) => a.date.localeCompare(b.date))
    }
    return Array.from(map.values())
  }, [shows])

  if (venuePins.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-card rounded-lg border border-border text-muted-foreground text-sm mb-6"
        style={{ height: 500 }}
      >
        No venues with location data match the current filters.
      </div>
    )
  }

  return (
    <div
      className="rounded-lg overflow-hidden border border-border shadow-sm mb-6"
      style={{ height: 500 }}
    >
      <MapContainer
        center={VANCOUVER_CENTER}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {venuePins.map(pin => {
          const color   = pin.hasSpotifyMatch ? TEAL : GRAY
          const preview = pin.shows.slice(0, 5)
          const extra   = pin.shows.length - preview.length

          return (
            <CircleMarker
              key={pin.venue_id}
              center={[pin.latitude, pin.longitude]}
              radius={pin.hasSpotifyMatch ? 10 : 7}
              pathOptions={{
                fillColor:   color,
                fillOpacity: pin.hasSpotifyMatch ? 0.9 : 0.55,
                color:       pin.hasSpotifyMatch ? '#00a896' : 'rgba(156,163,175,0.9)',
                weight:      2,
              }}
            >
              <Popup minWidth={210} maxWidth={280}>
                {/* Inline styles throughout — Tailwind classes aren't guaranteed
                    inside Leaflet's detached popup DOM node */}
                <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', padding: '2px 0' }}>
                  <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 4px', color: '#0f172a' }}>
                    {pin.venue_name}
                  </p>
                  <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>
                    {pin.shows.length} upcoming {pin.shows.length === 1 ? 'show' : 'shows'}
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {preview.map(show => (
                      <div
                        key={show.show_id}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                      >
                        <span style={{ color: '#94a3b8', flexShrink: 0, minWidth: 48 }}>
                          {fmtDate(show.date)}
                        </span>
                        <span style={{
                          color:        show.is_spotify_match ? TEAL : '#334155',
                          fontWeight:   show.is_spotify_match ? 600 : 400,
                          overflow:     'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace:   'nowrap',
                          flex:         1,
                        }}>
                          {show.artist_name}
                        </span>
                        {show.ticketmaster_url && (
                          <a
                            href={show.ticketmaster_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Buy tickets"
                            style={{ flexShrink: 0 }}
                          >
                            <img
                              src="https://www.ticketmaster.ca/favicon.ico"
                              alt="Ticketmaster"
                              style={{ width: 12, height: 12, display: 'block' }}
                            />
                          </a>
                        )}
                      </div>
                    ))}
                    {extra > 0 && (
                      <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0' }}>
                        +{extra} more
                      </p>
                    )}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}
