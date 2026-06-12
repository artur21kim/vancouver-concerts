'use client'

import { useMemo, useState, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Show = {
  show_id:           number
  date:              string
  artist_name:       string
  venue_id:          number
  venue_name:        string
  capacity_category: string | null
  latitude:          number | null
  longitude:         number | null
  ticketmaster_url:  string | null
  is_spotify_match:  boolean
}

type VenuePin = {
  venue_id:          number
  venue_name:        string
  capacity_category: string | null
  latitude:          number
  longitude:         number
  shows:             Show[]
  hasSpotifyMatch:   boolean
}

const TEAL = '#00BFA8'
const VANCOUVER_CENTER: [number, number] = [49.2827, -123.1207]

// ── Capacity badge lookup ─────────────────────────────────────────────────────
const CAP_BADGE: Record<string, { bg: string; color: string; label: string }> = {
  'small (<500)':      { bg: 'rgba(139,92,246,0.18)', color: '#a78bfa', label: 'S'  },
  'medium (500-1.5k)': { bg: 'rgba(58,143,189,0.18)', color: '#3A8FBD', label: 'M'  },
  'large (1.5k-10k)':  { bg: 'rgba(234,88,12,0.18)',  color: '#f97316', label: 'L'  },
  'x-large (10k+)':    { bg: 'rgba(225,29,72,0.18)',  color: '#fb7185', label: 'XL' },
}

function getCapBadge(category: string | null) {
  if (!category) return null
  return CAP_BADGE[category.toLowerCase()] ?? null
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// ── Numbered DivIcon pin ──────────────────────────────────────────────────────
function makePinIcon(count: number, isMatch: boolean) {
  const size      = isMatch ? 30 : 24
  const bg        = isMatch ? '#00BFA8'                : 'rgba(148,163,184,0.70)'
  const border    = isMatch ? '#009f8c'                : 'rgba(100,116,139,0.85)'
  const textColor = isMatch ? '#ffffff'                : 'rgba(15,23,42,0.85)'
  const fontSize  = count >= 10 ? 10 : 12
  const shadow    = isMatch
    ? '0 2px 6px rgba(0,191,168,0.35)'
    : '0 1px 4px rgba(0,0,0,0.18)'

  return divIcon({
    className:   '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
    html: `
      <div style="
        width:${size}px;height:${size}px;border-radius:50%;
        background:${bg};border:2px solid ${border};
        display:flex;align-items:center;justify-content:center;
        color:${textColor};font-size:${fontSize}px;font-weight:700;
        font-family:system-ui,-apple-system,sans-serif;
        box-shadow:${shadow};cursor:pointer;user-select:none;
      ">${count}</div>
    `,
  })
}

// ── Expandable popup content ───────────────────────────────────────────────────
function VenuePopupContent({
  pin,
  onArtistClick,
}: {
  pin: VenuePin
  onArtistClick?: (name: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const PREVIEW   = 5
  const visible   = expanded ? pin.shows : pin.shows.slice(0, PREVIEW)
  const extra     = pin.shows.length - PREVIEW
  const capBadge  = getCapBadge(pin.capacity_category)
  const clickable = !!onArtistClick

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', padding: '2px 0', minWidth: 220, maxWidth: 290 }}>

      {/* Venue name + capacity badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 3px' }}>
        <p style={{ fontWeight: 700, fontSize: 13, margin: 0, color: '#0f172a', flex: 1 }}>
          {pin.venue_name}
        </p>
        {capBadge && (
          <span style={{
            background: capBadge.bg, color: capBadge.color,
            fontSize: 9, fontWeight: 700,
            padding: '1px 5px', borderRadius: 3,
            flexShrink: 0, lineHeight: '14px',
          }}>
            {capBadge.label}
          </span>
        )}
      </div>

      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>
        {pin.shows.length} upcoming {pin.shows.length === 1 ? 'show' : 'shows'}
        {clickable && (
          <span style={{ color: '#94a3b8', marginLeft: 4 }}>· click artist to filter</span>
        )}
      </p>

      {/* Show list — scrollable when expanded */}
      <div
        className="gp-popup-list"
        style={{
          display: 'flex', flexDirection: 'column', gap: 5,
          maxHeight: expanded ? 210 : 'none',
          overflowY: expanded ? 'auto' : 'visible',
          scrollbarWidth: 'thin',
          scrollbarColor: `rgba(0,191,168,0.3) transparent`,
          paddingRight: expanded ? 2 : 0,
        } as React.CSSProperties}
      >
        {visible.map(show => (
          <div key={show.show_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: '#94a3b8', flexShrink: 0, minWidth: 48 }}>
              {fmtDate(show.date)}
            </span>
            <span
              onClick={() => onArtistClick?.(show.artist_name)}
              style={{
                color:           show.is_spotify_match ? TEAL : '#334155',
                fontWeight:      show.is_spotify_match ? 600 : 400,
                overflow:        'hidden',
                textOverflow:    'ellipsis',
                whiteSpace:      'nowrap',
                flex:             1,
                cursor:           clickable ? 'pointer' : 'default',
                textDecoration:   clickable ? 'underline' : 'none',
                textDecorationColor: 'rgba(0,0,0,0.18)',
              }}
            >
              {show.artist_name}
            </span>
            {show.ticketmaster_url && (
              <a href={show.ticketmaster_url} target="_blank" rel="noopener noreferrer"
                title="Buy tickets" style={{ flexShrink: 0 }}>
                <img src="https://www.ticketmaster.ca/favicon.ico" alt="TM"
                  style={{ width: 12, height: 12, display: 'block' }} />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* Expand link */}
      {!expanded && extra > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{
            marginTop: 8, fontSize: 11, color: TEAL,
            background: 'none', border: 'none', padding: 0,
            cursor: 'pointer', textDecoration: 'underline', display: 'block',
          }}
        >
          +{extra} more
        </button>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function VenueMap({
  shows,
  height = 500,
  onArtistClick,
}: {
  shows:           Show[]
  height?:         number | string
  onArtistClick?:  (name: string) => void
}) {
  // Inject thin scrollbar CSS — works inside Leaflet's detached popup DOM
  useEffect(() => {
    const id = 'gp-venue-popup-styles'
    if (document.getElementById(id)) return
    const style = document.createElement('style')
    style.id = id
    style.innerHTML = `
      .gp-popup-list::-webkit-scrollbar { width: 3px; }
      .gp-popup-list::-webkit-scrollbar-track { background: transparent; }
      .gp-popup-list::-webkit-scrollbar-thumb {
        background: rgba(0,191,168,0.3); border-radius: 2px;
      }
      .gp-popup-list::-webkit-scrollbar-thumb:hover {
        background: rgba(0,191,168,0.55);
      }
    `
    document.head.appendChild(style)
  }, [])

  const venuePins = useMemo<VenuePin[]>(() => {
    const map = new Map<number, VenuePin>()
    for (const show of shows) {
      if (show.latitude == null || show.longitude == null) continue
      if (!map.has(show.venue_id)) {
        map.set(show.venue_id, {
          venue_id:          show.venue_id,
          venue_name:        show.venue_name,
          capacity_category: show.capacity_category,
          latitude:          show.latitude,
          longitude:         show.longitude,
          shows:             [],
          hasSpotifyMatch:   false,
        })
      }
      const pin = map.get(show.venue_id)!
      pin.shows.push(show)
      if (show.is_spotify_match) pin.hasSpotifyMatch = true
    }
    for (const pin of map.values()) {
      pin.shows.sort((a, b) => a.date.localeCompare(b.date))
    }
    return Array.from(map.values())
  }, [shows])

  if (venuePins.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-card rounded-lg border border-border text-muted-foreground text-sm"
        style={{ height }}
      >
        No venues with location data match the current filters.
      </div>
    )
  }

  return (
    <div style={{ height, width: '100%' }}>
      <MapContainer
        center={VANCOUVER_CENTER}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        {/* Non-match pins first, Spotify-match pins on top */}
        {[false, true].flatMap(matchFilter =>
          venuePins
            .filter(pin => pin.hasSpotifyMatch === matchFilter)
            .map(pin => (
              <Marker
                key={pin.venue_id}
                position={[pin.latitude, pin.longitude]}
                icon={makePinIcon(pin.shows.length, pin.hasSpotifyMatch)}
                zIndexOffset={pin.hasSpotifyMatch ? 1000 : 0}
              >
                <Popup>
                  <VenuePopupContent pin={pin} onArtistClick={onArtistClick} />
                </Popup>
              </Marker>
            ))
        )}
      </MapContainer>
    </div>
  )
}
