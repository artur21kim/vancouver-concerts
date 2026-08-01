'use client'

import { useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { divIcon } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import CountryFlag from './components/CountryFlag'

// ── Types ────────────────────────────────────────────────────────────────────
export type ProvinceData = {
  state:   string
  country: string
  total:   number
  cities:  Array<{ city: string; show_count: number; latitude: number | null; longitude: number | null }>
}

// ── Province label positions ──────────────────────────────────────────────────
// Where the province/state abbreviation appears on a typical North America atlas —
// not city-area positions, not geographic centroids, but readable label zones.
const PROVINCE_COORDS: Record<string, [number, number]> = {
  BC: [54.5, -126.5],  AB: [54.5, -114.5],  SK: [54.5, -106.0],  MB: [54.0,  -97.5],
  ON: [49.5,  -84.0],  QC: [52.0,  -72.0],  NS: [45.0,  -63.0],  NB: [46.5,  -66.5],
  NL: [53.0,  -59.0],  PE: [46.5,  -63.3],  NT: [64.0, -118.0],  YT: [63.0, -135.0],
  NU: [70.0,  -86.0],
  WA: [47.3, -120.5],  OR: [44.0, -120.5],  CA: [37.5, -119.5],  NV: [39.5, -116.5],
  AZ: [34.3, -111.7],  CO: [39.0, -105.5],  TX: [31.5,  -99.5],  OK: [35.5,  -97.5],
  UT: [39.5, -111.5],  ID: [44.5, -114.0],  NM: [34.5, -106.5],
  MN: [46.5,  -94.0],  IA: [42.0,  -93.5],  NE: [41.5,  -99.5],  WI: [44.5,  -90.0],
  MO: [38.5,  -92.5],  IL: [40.0,  -89.0],  IN: [40.0,  -86.5],  TN: [35.8,  -86.0],
  KY: [37.5,  -85.5],  GA: [32.7,  -83.5],  AL: [32.5,  -86.5],  FL: [28.5,  -82.0],
  LA: [31.0,  -91.5],  OH: [40.5,  -82.5],  MI: [44.5,  -85.5],  PA: [41.0,  -77.5],
  NC: [35.5,  -79.5],  SC: [34.0,  -81.0],  MA: [42.3,  -71.8],  NY: [42.9,  -75.5],
  MD: [39.2,  -76.8],  DC: [38.9,  -77.1],
}

// City coordinates now sourced from dim_city via get_overview_city_stats (GP-153)

const STATE_NAMES: Record<string, string> = {
  BC: 'British Columbia', AB: 'Alberta',         MB: 'Manitoba',
  SK: 'Saskatchewan',     ON: 'Ontario',         QC: 'Quebec',
  NS: 'Nova Scotia',      NB: 'New Brunswick',   NL: 'Newfoundland & Labrador',
  PE: 'Prince Edward Island',
  WA: 'Washington',  OR: 'Oregon',    CA: 'California',    NV: 'Nevada',
  AZ: 'Arizona',     CO: 'Colorado',  TX: 'Texas',         OK: 'Oklahoma',
  UT: 'Utah',        ID: 'Idaho',     NM: 'New Mexico',
  MN: 'Minnesota',   IA: 'Iowa',      NE: 'Nebraska',      WI: 'Wisconsin',
  MO: 'Missouri',    IL: 'Illinois',  IN: 'Indiana',       TN: 'Tennessee',
  KY: 'Kentucky',    GA: 'Georgia',   AL: 'Alabama',       FL: 'Florida',
  LA: 'Louisiana',   OH: 'Ohio',      MI: 'Michigan',      PA: 'Pennsylvania',
  NC: 'North Carolina', SC: 'South Carolina', MA: 'Massachusetts', NY: 'New York',
  MD: 'Maryland',    DC: 'Washington D.C.',
}

const NA_CENTER: [number, number] = [44, -96]
const NA_ZOOM   = 4
const TEAL      = '#00BFA8'
const TEAL_DARK = 'rgba(0,159,140,0.95)'

// ── Log-scale radius ──────────────────────────────────────────────────────────
function getRadius(total: number, minTotal: number, maxTotal: number): number {
  const logMin     = Math.log(Math.max(1, minTotal))
  const logMax     = Math.log(Math.max(1, maxTotal))
  const logVal     = Math.log(Math.max(1, total))
  const normalized = logMax === logMin ? 0.5 : (logVal - logMin) / (logMax - logMin)
  return Math.round(8 + normalized * 18)   // 8–26 px radius → 16–52 px diameter
}

// ── Province bubble icon ──────────────────────────────────────────────────────
function makeBubbleIcon(showCount: number, radius: number) {
  const size    = radius * 2
  const display = showCount >= 1000 ? `${Math.round(showCount / 1000)}k` : String(showCount)
  const fs      = size < 28 ? 9 : size < 40 ? 11 : 13

  return divIcon({
    className:   '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(0,191,168,0.72);border:2px solid ${TEAL_DARK};
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,191,168,0.30);cursor:pointer;user-select:none;
    "><span style="color:#fff;font-size:${fs}px;font-weight:700;
      font-family:system-ui,-apple-system,sans-serif;line-height:1;
    ">${display}</span></div>`,
  })
}

// ── City bubble icon ──────────────────────────────────────────────────────────
function makeCityIcon(showCount: number, radius: number) {
  const size    = radius * 2
  const display = showCount >= 1000 ? `${Math.round(showCount / 1000)}k` : String(showCount)
  const fs      = size < 24 ? 8 : size < 36 ? 10 : 12

  return divIcon({
    className:   '',
    iconSize:    [size, size],
    iconAnchor:  [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 4)],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(0,191,168,0.60);border:2px solid rgba(0,159,140,0.80);
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 1px 6px rgba(0,191,168,0.22);cursor:pointer;user-select:none;
    "><span style="color:#fff;font-size:${fs}px;font-weight:700;
      font-family:system-ui,-apple-system,sans-serif;line-height:1;
    ">${display}</span></div>`,
  })
}

// ── MapController — handles animated fly-to on state change ──────────────────
function MapController({
  selectedState,
  selectedProvince,
}: {
  selectedState:    string | null
  selectedProvince: ProvinceData | undefined
}) {
  const map = useMap()

  useEffect(() => {
    if (!selectedState) {
      map.setView(NA_CENTER, NA_ZOOM, { animate: true })
      return
    }

    const positions: [number, number][] = (selectedProvince?.cities ?? [])
      .map(c => (c.latitude != null && c.longitude != null
        ? [c.latitude, c.longitude] as [number, number]
        : null))
      .filter(Boolean) as [number, number][]

    if (positions.length >= 2) {
      map.fitBounds(positions, { padding: [60, 60], maxZoom: 10, animate: true })
    } else if (positions.length === 1) {
      map.setView(positions[0], 9, { animate: true })
    } else if (PROVINCE_COORDS[selectedState]) {
      map.setView(PROVINCE_COORDS[selectedState], 7, { animate: true })
    }
  }, [selectedState]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

// ── City popup ────────────────────────────────────────────────────────────────
function CityPopup({
  cityName,
  showCount,
  isAuthenticated,
  onCtaClick,
}: {
  cityName:        string
  showCount:       number
  isAuthenticated: boolean
  onCtaClick:      () => void
}) {
  return (
    <div style={{ fontFamily: 'system-ui,-apple-system,sans-serif', padding: '2px 0', minWidth: 160 }}>
      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 2px', color: '#0f172a' }}>{cityName}</p>
      <p style={{ fontSize: 11, color: '#64748b', margin: '0 0 10px' }}>
        {showCount.toLocaleString()} shows
      </p>
      <button
        onClick={onCtaClick}
        style={{
          display: 'block', width: '100%', textAlign: 'center',
          background: TEAL, color: '#fff',
          padding: '6px 10px', borderRadius: 5,
          fontSize: 11, fontWeight: 700,
          border: 'none', cursor: 'pointer',
        }}
      >
        {isAuthenticated ? 'View your Grooveprint →' : 'Track concerts here →'}
      </button>
      {!isAuthenticated && (
        <p style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', margin: '4px 0 0' }}>
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
  selectedState,
  onStateChange,
}: {
  provinces:        ProvinceData[]
  isAuthenticated?: boolean
  onCtaClick?:      () => void
  selectedState:    string | null
  onStateChange:    (s: string | null) => void
}) {

  // Province bubble sizing
  const { minTotal, maxTotal } = useMemo(() => {
    const totals = provinces.filter(p => p.total > 0).map(p => p.total)
    return { minTotal: Math.min(...totals, 1), maxTotal: Math.max(...totals, 1) }
  }, [provinces])

  const visibleProvinces = useMemo(
    () => provinces.filter(p => PROVINCE_COORDS[p.state]),
    [provinces]
  )

  const selectedProvince = useMemo(
    () => provinces.find(p => p.state === selectedState),
    [provinces, selectedState]
  )

  // City bubble sizing within the selected province
  const { cityMin, cityMax } = useMemo(() => {
    if (!selectedProvince) return { cityMin: 1, cityMax: 1 }
    const counts = selectedProvince.cities.map(c => Number(c.show_count))
    return { cityMin: Math.min(...counts, 1), cityMax: Math.max(...counts, 1) }
  }, [selectedProvince])

  const stateName = selectedState ? (STATE_NAMES[selectedState] ?? selectedState) : ''

  if (visibleProvinces.length === 0) {
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm h-full">
        No province data available.
      </div>
    )
  }

  return (
    <div className="relative h-full">

      {/* Back button + province label — overlaid on map when drilled in */}
      {selectedState && (
        <div
          style={{ position: 'absolute', top: 10, right: 10, zIndex: 500,
            display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'auto' }}
        >
          <span style={{
            background: 'rgba(15,23,42,0.72)', color: '#e2e8f0',
            borderRadius: 5, padding: '4px 9px', fontSize: 12, fontWeight: 600,
            backdropFilter: 'blur(4px)',
          }}>
            {stateName}
            {selectedProvince?.country && (
              <CountryFlag
                code={selectedProvince.country}
                className="inline-block w-3.5 h-auto rounded-[1px] align-[-1px] ml-1.5"
              />
            )}
          </span>
          <button
            onClick={() => onStateChange(null)}
            style={{
              background: TEAL, color: '#fff', border: 'none',
              borderRadius: 5, padding: '4px 10px',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
            }}
          >
            ← All Regions
          </button>
        </div>
      )}

      <MapContainer
        center={NA_CENTER}
        zoom={NA_ZOOM}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        />

        <MapController selectedState={selectedState} selectedProvince={selectedProvince} />

        {/* Province view — bubbles at label positions, click to drill in */}
        {!selectedState && visibleProvinces.map(province => (
          <Marker
            key={province.state}
            position={PROVINCE_COORDS[province.state]}
            icon={makeBubbleIcon(province.total, getRadius(province.total, minTotal, maxTotal))}
            eventHandlers={{ click: () => onStateChange(province.state) }}
          />
        ))}

        {/* City view — shown when a province is selected */}
        {selectedState && selectedProvince && selectedProvince.cities
          .filter(c => c.latitude != null && c.longitude != null)
          .map(city => (
            <Marker
              key={city.city}
              position={[city.latitude as number, city.longitude as number]}
              icon={makeCityIcon(
                Number(city.show_count),
                getRadius(Number(city.show_count), cityMin, cityMax)
              )}
            >
              <Popup minWidth={170} maxWidth={220}>
                <CityPopup
                  cityName={city.city}
                  showCount={Number(city.show_count)}
                  isAuthenticated={isAuthenticated}
                  onCtaClick={onCtaClick ?? (() => {})}
                />
              </Popup>
            </Marker>
          ))
        }

      </MapContainer>
    </div>
  )
}
