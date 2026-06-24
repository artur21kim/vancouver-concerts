'use client'

import { useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'

// ── Types ────────────────────────────────────────────────────────────────────
export type ProvinceData = {
  state:   string
  country: string
  total:   number
  cities:  Array<{ city: string; show_count: number }>
}

// ── Population-center coordinates ─────────────────────────────────────────────
// Using city-area coords (not geographic centroids) so bubbles sit where the
// shows actually happened, not in the empty centre of a vast province/state.
const PROVINCE_COORDS: Record<string, [number, number]> = {
  // Canada
  BC: [49.25, -123.10],  // Vancouver area
  AB: [51.05, -114.07],  // Calgary / Edmonton midpoint
  MB: [49.90, -97.14],   // Winnipeg
  SK: [52.13, -106.67],  // Saskatoon
  ON: [43.65, -79.38],   // Toronto
  QC: [45.52, -73.57],   // Montreal
  NS: [44.65, -63.58],   // Halifax
  NB: [45.95, -66.64],   // Fredericton
  NL: [47.56, -52.71],   // St. John's
  PE: [46.24, -63.13],   // Charlottetown
  // USA
  WA: [47.61, -122.33],  // Seattle
  OR: [45.52, -122.68],  // Portland
  CA: [34.05, -118.24],  // Los Angeles
  NV: [36.17, -115.14],  // Las Vegas
  AZ: [33.45, -112.07],  // Phoenix
  CO: [39.74, -104.99],  // Denver
  TX: [29.76,  -95.37],  // Houston
  MN: [44.98,  -93.27],  // Minneapolis
  MO: [38.63,  -90.20],  // St. Louis
  IL: [41.88,  -87.63],  // Chicago
  TN: [36.16,  -86.78],  // Nashville
  GA: [33.75,  -84.39],  // Atlanta
  FL: [25.77,  -80.19],  // Miami
  OH: [39.96,  -82.00],  // Columbus
  MI: [42.33,  -83.05],  // Detroit
  PA: [39.95,  -75.17],  // Philadelphia
  NC: [35.23,  -80.84],  // Charlotte
  MA: [42.36,  -71.06],  // Boston
  NY: [40.71,  -74.01],  // New York City
}

const STATE_NAMES: Record<string, string> = {
  BC: 'British Columbia', AB: 'Alberta',         MB: 'Manitoba',
  SK: 'Saskatchewan',     ON: 'Ontario',         QC: 'Quebec',
  NS: 'Nova Scotia',      NB: 'New Brunswick',   NL: 'Newfoundland & Labrador',
  PE: 'Prince Edward Island',
  WA: 'Washington',  OR: 'Oregon',    CA: 'California',    NV: 'Nevada',
  AZ: 'Arizona',     CO: 'Colorado',  TX: 'Texas',         MN: 'Minnesota',
  MO: 'Missouri',    IL: 'Illinois',  TN: 'Tennessee',     GA: 'Georgia',
  FL: 'Florida',     OH: 'Ohio',      MI: 'Michigan',      PA: 'Pennsylvania',
  NC: 'North Carolina', MA: 'Massachusetts', NY: 'New York',
}

const COUNTRY_FLAGS: Record<string, string> = { CA: '🇨🇦', US: '🇺🇸' }

const NA_CENTER: [number, number] = [50, -93]
const NA_ZOOM = 3
const TEAL      = '#00BFA8'
const TEAL_DARK = 'rgba(0,159,140,0.95)'

// ── Log-scale bubble radius ───────────────────────────────────────────────────
function getRadius(total: number, minTotal: number, maxTotal: number): number {
  const logMin = Math.log(Math.max(1, minTotal))
  const logMax = Math.log(Math.max(1, maxTotal))
  const logVal = Math.log(Math.max(1, total))
  const normalized = logMax === logMin ? 0.5 : (logVal - logMin) / (logMax - logMin)
  return Math.round(18 + normalized * 32)  // 18–50 px radius → 36–100 px diameter
}

// ── Bubble divIcon ────────────────────────────────────────────────────────────
function makeBubbleIcon(showCount: number, radius: number) {
  const size = radius * 2
  const displayCount = showCount >= 1000
    ? `${Math.round(showCount / 1000)}k`
    : showCount.toString()
  const fontSize = size < 50 ? 10 : size < 72 ? 12 : 14

  return divIcon({
    className:   '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 6)],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(0,191,168,0.72);border:2.5px solid ${TEAL_DARK};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 10px rgba(0,191,168,0.35);cursor:pointer;user-select:none;
    "><span style="
      color:#fff;font-size:${fontSize}px;font-weight:700;
      font-family:system-ui,-apple-system,sans-serif;line-height:1;
    ">${displayCount}</span></div>`,
  })
}

// ── Popup content ─────────────────────────────────────────────────────────────
function ProvincePopup({
  province,
  isAuthenticated,
  onCtaClick,
}: {
  province:        ProvinceData
  isAuthenticated: boolean
  onCtaClick:      () => void
}) {
  const stateName   = STATE_NAMES[province.state] ?? province.state
  const flag        = province.country ? (COUNTRY_FLAGS[province.country] ?? '') : ''
  const sortedCities = [...province.cities].sort(
    (a, b) => Number(b.show_count) - Number(a.show_count)
  )

  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', padding: '2px 0', minWidth: 200, maxWidth: 260 }}>

      {/* Header */}
      <p style={{ fontWeight: 700, fontSize: 14, margin: '0 0 2px', color: '#0f172a' }}>
        {stateName} {flag}
      </p>
      <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>
        {province.total.toLocaleString()} shows
        {sortedCities.length > 1 && ` · ${sortedCities.length} cities`}
      </p>

      {/* City breakdown */}
      {sortedCities.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {sortedCities.map(city => (
            <div
              key={city.city}
              style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}
            >
              <span style={{ color: '#334155' }}>{city.city}</span>
              <span style={{ color: '#94a3b8', fontWeight: 600 }}>
                {Number(city.show_count).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={onCtaClick}
        style={{
          display: 'block', width: '100%', textAlign: 'center',
          background: TEAL, color: '#fff',
          padding: '7px 12px', borderRadius: 6,
          fontSize: 12, fontWeight: 700,
          border: 'none', cursor: 'pointer',
        }}
      >
        {isAuthenticated ? 'View your Grooveprint →' : 'Track concerts you\'ve seen →'}
      </button>
      {!isAuthenticated && (
        <p style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', margin: '5px 0 0' }}>
          Free to join · see venues &amp; Spotify matches
        </p>
      )}

    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProvinceMap({
  provinces,
  isAuthenticated = false,
  onCtaClick,
}: {
  provinces:        ProvinceData[]
  isAuthenticated?: boolean
  onCtaClick?:      () => void
}) {
  const { minTotal, maxTotal } = useMemo(() => {
    const totals = provinces.filter(p => p.total > 0).map(p => p.total)
    return {
      minTotal: totals.length ? Math.min(...totals) : 1,
      maxTotal: totals.length ? Math.max(...totals) : 1,
    }
  }, [provinces])

  const visibleProvinces = useMemo(
    () => provinces.filter(p => PROVINCE_COORDS[p.state]),
    [provinces]
  )

  if (visibleProvinces.length === 0) {
    return (
      <div
        className="flex items-center justify-center bg-card rounded-lg border border-border text-muted-foreground text-sm"
        style={{ height: '100%' }}
      >
        No province data available.
      </div>
    )
  }

  return (
    <MapContainer
      center={NA_CENTER}
      zoom={NA_ZOOM}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
      />

      {visibleProvinces.map(province => {
        const coords = PROVINCE_COORDS[province.state]
        const radius = getRadius(province.total, minTotal, maxTotal)

        return (
          <Marker
            key={province.state}
            position={coords}
            icon={makeBubbleIcon(province.total, radius)}
          >
            <Popup minWidth={210} maxWidth={270}>
              <ProvincePopup
                province={province}
                isAuthenticated={isAuthenticated}
                onCtaClick={onCtaClick ?? (() => {})}
              />
            </Popup>
          </Marker>
        )
      })}
    </MapContainer>
  )
}
