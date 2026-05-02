'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

// ─── Locked ──────────────────────────────────────────────────────────────────
const TEAL    = '#00BFA8';
const CREAM   = '#FAF3E8';
const CREAM_D = '#F5EEE0';
const CREAM_B = '#DDD4C4';
const CREAM_M = '#EAE0CE';
const NAVY    = '#070F1C';
const MEDIUM  = '#3A8FBD';
const SMALL   = '#8B5CF6';
const LARGE   = '#F97316';
const XLARGE  = '#F43F5E';
const UNKNOWN = '#6B7280';

// ─── Hue variants — chroma fixed at 0.03, only hue angle changes ─────────────
const VARIANTS = [
  {
    name: 'H 260',
    desc: 'Current — blue-grey',
    bg:        'oklch(0.168 0.03 260)',
    card:      'oklch(0.251 0.03 260)',
    muted:     'oklch(0.284 0.03 260)',
    border:    'oklch(0.326 0.03 260)',
    textMuted: '#7FA8B8',
  },
  {
    name: 'H 255',
    desc: 'Mid — blue-violet lean',
    bg:        'oklch(0.168 0.03 255)',
    card:      'oklch(0.251 0.03 255)',
    muted:     'oklch(0.284 0.03 255)',
    border:    'oklch(0.326 0.03 255)',
    textMuted: '#7FA8B8',
  },
  {
    name: 'H 250',
    desc: 'Most navy — violet-blue',
    bg:        'oklch(0.168 0.03 250)',
    card:      'oklch(0.251 0.03 250)',
    muted:     'oklch(0.284 0.03 250)',
    border:    'oklch(0.326 0.03 250)',
    textMuted: '#7FA8B8',
  },
];

const decadeData = [
  { decade: 'Pre-1960s', Small: 120,  Medium: 80,   Large: 20,   XLarge: 5,   Unknown: 40   },
  { decade: '1960s',     Small: 280,  Medium: 220,  Large: 80,   XLarge: 20,  Unknown: 120  },
  { decade: '1970s',     Small: 420,  Medium: 380,  Large: 180,  XLarge: 60,  Unknown: 280  },
  { decade: '1980s',     Small: 580,  Medium: 520,  Large: 280,  XLarge: 120, Unknown: 340  },
  { decade: '1990s',     Small: 820,  Medium: 780,  Large: 480,  XLarge: 220, Unknown: 480  },
  { decade: '2000s',     Small: 1200, Medium: 1100, Large: 680,  XLarge: 340, Unknown: 780  },
  { decade: '2010s',     Small: 2400, Medium: 3800, Large: 1800, XLarge: 980, Unknown: 1200 },
  { decade: '2020s',     Small: 1200, Medium: 2800, Large: 980,  XLarge: 480, Unknown: 1800 },
];

const shows = [
  { artist: 'Ty Segall',         venue: 'Commodore Ballroom', date: 'Mar 15, 2019', size: 'Medium'  },
  { artist: 'Tame Impala',       venue: 'PNE Amphitheatre',   date: 'Aug 3, 2019',  size: 'Large'   },
  { artist: 'Khruangbin',        venue: 'Orpheum Theatre',    date: 'Nov 22, 2019', size: 'Medium'  },
  { artist: 'Various Artists',   venue: 'Main Stage',         date: 'Jul 6, 2019',  size: 'Large'   },
  { artist: 'Car Seat Headrest', venue: 'Imperial',           date: 'May 11, 2019', size: 'Small'   },
  { artist: 'Radiohead',         venue: 'BC Place',           date: 'Jul 14, 2008', size: 'X-Large' },
];

const sizeColor = (size: string) => ({
  Small: SMALL, Medium: MEDIUM, Large: LARGE, 'X-Large': XLARGE,
}[size] ?? UNKNOWN);

// ─── Dark panel ───────────────────────────────────────────────────────────────
function DarkPanel({ v }: { v: typeof VARIANTS[0] }) {
  const [tab, setTab] = useState<'home' | 'browse'>('home');
  return (
    <div style={{ background: v.bg, height: '100%', overflowY: 'auto', flex: 1, borderRight: `1px solid ${v.border}` }}>
      {/* Label */}
      <div style={{ background: v.card, borderBottom: `1px solid ${v.border}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: TEAL }}>{v.name}</span>
        <span style={{ fontSize: 11, color: v.textMuted }}>{v.desc}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: v.textMuted }}>bg / card / muted / border:</span>
          {[v.bg, v.card, v.muted, v.border].map((c, i) => (
            <div key={i} style={{ width: 18, height: 18, borderRadius: 3, background: c, border: `1px solid ${v.border}` }} />
          ))}
        </div>
      </div>

      {/* Nav */}
      <nav style={{ background: v.bg, borderBottom: `1px solid ${v.border}`, padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: '#FFFFFF' }}>Vancouver Concert History</span>
        <button style={{ background: TEAL, color: CREAM, border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 11 }}>Sign In</button>
      </nav>

      {/* Tabs */}
      <div style={{ padding: '6px 16px 0', display: 'flex', gap: 8, borderBottom: `1px solid ${v.border}` }}>
        {(['home', 'browse'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none',
            borderBottom: tab === t ? `2px solid ${TEAL}` : '2px solid transparent',
            color: tab === t ? TEAL : v.textMuted,
            padding: '5px 10px', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>

      {tab === 'home' ? (
        <div style={{ padding: '16px' }}>
          {/* Hero */}
          <div style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 10, padding: '20px', marginBottom: 12, position: 'relative', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle, ${TEAL}18 0%, transparent 70%)` }} />
            <div style={{ display: 'inline-block', background: `${TEAL}20`, border: `1px solid ${TEAL}40`, borderRadius: 20, padding: '2px 8px', fontSize: 9, fontWeight: 600, color: TEAL, marginBottom: 8, textTransform: 'uppercase' as const }}>Beta</div>
            <h1 style={{ fontSize: 18, fontWeight: 900, color: '#FFFFFF', margin: '0 0 6px' }}>Vancouver's Concert Archive</h1>
            <p style={{ fontSize: 11, color: v.textMuted, margin: '0 0 12px' }}>35,000+ shows from 1900 to today.</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ background: TEAL, color: CREAM, border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 700, fontSize: 11 }}>Discover My Shows</button>
              <button style={{ background: 'transparent', color: '#FFFFFF', border: `1.5px solid ${v.border}`, borderRadius: 6, padding: '6px 12px', fontWeight: 600, fontSize: 11 }}>Browse Archive</button>
            </div>
          </div>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['35,241', 'Shows'], ['487', 'Venues'], ['12,830', 'Artists']].map(([val, lbl]) => (
              <div key={lbl} style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 8, padding: '10px 12px', flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEAL }}>{val}</div>
                <div style={{ fontSize: 10, color: v.textMuted }}>{lbl}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 10, padding: '12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#FFFFFF', marginBottom: 10 }}>Shows by Decade</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={decadeData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={v.border} />
                <XAxis dataKey="decade" tick={{ fill: v.textMuted, fontSize: 8 }} />
                <YAxis tick={{ fill: v.textMuted, fontSize: 8 }} />
                <Tooltip contentStyle={{ background: v.card, border: `1px solid ${v.border}`, fontSize: 10, color: '#FFFFFF' }} />
                <Legend wrapperStyle={{ fontSize: 9, color: v.textMuted }} />
                <Bar dataKey="Small"   stackId="a" fill={SMALL}   name="Small" />
                <Bar dataKey="Medium"  stackId="a" fill={MEDIUM}  name="Medium" />
                <Bar dataKey="Large"   stackId="a" fill={LARGE}   name="Large" />
                <Bar dataKey="XLarge"  stackId="a" fill={XLARGE}  name="X-Large" />
                <Bar dataKey="Unknown" stackId="a" fill={UNKNOWN} name="Unknown" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px' }}>
          {/* Filter bar */}
          <div style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' as const }}>
              <span style={{ fontSize: 10, color: v.textMuted, fontWeight: 600 }}>Size:</span>
              {['All', 'S', 'M', 'L', 'XL', '?'].map((f, i) => (
                <button key={f} style={{ background: i === 0 ? TEAL : 'transparent', color: i === 0 ? CREAM : v.textMuted, border: `1px solid ${i === 0 ? TEAL : v.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>{f}</button>
              ))}
              <span style={{ fontSize: 10, color: v.textMuted, marginLeft: 8, fontWeight: 600 }}>Status:</span>
              {['All', 'Open', 'Closed'].map((f, i) => (
                <button key={f} style={{ background: i === 0 ? TEAL : 'transparent', color: i === 0 ? CREAM : v.textMuted, border: `1px solid ${i === 0 ? TEAL : v.border}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>{f}</button>
              ))}
            </div>
          </div>

          {/* Dropdown mockup */}
          <div style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 8, padding: '8px 12px', marginBottom: 10, display: 'flex', gap: 8 }}>
            {['All artists...', 'All venues...', 'All festivals...'].map(p => (
              <div key={p} style={{ flex: 1, background: v.bg, border: `1px solid ${v.border}`, borderRadius: 4, padding: '5px 8px', fontSize: 10, color: v.textMuted }}>{p} ▾</div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: v.card, border: `1px solid ${v.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 8, padding: '6px 12px', fontSize: 9, fontWeight: 700, color: v.textMuted, textTransform: 'uppercase' as const, background: v.muted, borderBottom: `1px solid ${v.border}` }}>
              <span>Artist</span><span>Venue</span><span>Date</span><span>Size</span>
            </div>
            {shows.map((show, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 8, padding: '8px 12px', borderBottom: i < shows.length - 1 ? `1px solid ${v.border}` : 'none', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: TEAL, fontSize: 11 }}>{show.artist}</span>
                <span style={{ color: v.textMuted, fontSize: 11 }}>{show.venue}</span>
                <span style={{ color: v.textMuted, fontSize: 10 }}>{show.date}</span>
                <span style={{ background: `${sizeColor(show.size)}20`, color: sizeColor(show.size), border: `1px solid ${sizeColor(show.size)}50`, borderRadius: 20, padding: '1px 6px', fontSize: 9, fontWeight: 600, display: 'inline-block' }}>{show.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Light panel ──────────────────────────────────────────────────────────────
function LightPanel() {
  const [tab, setTab] = useState<'home' | 'browse'>('browse');
  return (
    <div style={{ background: CREAM, height: '100%', overflowY: 'auto', flex: 1 }}>
      <div style={{ background: CREAM_D, borderBottom: `1px solid ${CREAM_B}`, padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#4A6580' }}>Light mode</span>
        <span style={{ fontSize: 11, color: '#6B7F8F' }}>cream #FAF3E8 — reference</span>
      </div>
      <nav style={{ background: CREAM, borderBottom: `1px solid ${CREAM_B}`, padding: '0 16px', height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontWeight: 800, fontSize: 12, color: NAVY }}>Vancouver Concert History</span>
        <button style={{ background: TEAL, color: CREAM, border: 'none', borderRadius: 6, padding: '4px 10px', fontWeight: 700, fontSize: 11 }}>Sign In</button>
      </nav>
      <div style={{ padding: '6px 16px 0', display: 'flex', gap: 8, borderBottom: `1px solid ${CREAM_B}` }}>
        {(['home', 'browse'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background: 'transparent', border: 'none',
            borderBottom: tab === t ? `2px solid ${TEAL}` : '2px solid transparent',
            color: tab === t ? TEAL : '#6B7F8F',
            padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1,
          }}>{t}</button>
        ))}
      </div>
      {tab === 'home' ? (
        <div style={{ padding: '16px' }}>
          <div style={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, borderRadius: 10, padding: '20px', marginBottom: 12 }}>
            <h1 style={{ fontSize: 18, fontWeight: 900, color: NAVY, margin: '0 0 6px' }}>Vancouver's Concert Archive</h1>
            <p style={{ fontSize: 11, color: '#6B7F8F', margin: '0 0 12px' }}>35,000+ shows from 1900 to today.</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <button style={{ background: TEAL, color: CREAM, border: 'none', borderRadius: 6, padding: '6px 12px', fontWeight: 700, fontSize: 11 }}>Discover My Shows</button>
              <button style={{ background: 'transparent', color: NAVY, border: `1.5px solid ${CREAM_B}`, borderRadius: 6, padding: '6px 12px', fontWeight: 600, fontSize: 11 }}>Browse Archive</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[['35,241', 'Shows'], ['487', 'Venues'], ['12,830', 'Artists']].map(([val, lbl]) => (
              <div key={lbl} style={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, borderRadius: 8, padding: '10px 12px', flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: TEAL }}>{val}</div>
                <div style={{ fontSize: 10, color: '#6B7F8F' }}>{lbl}</div>
              </div>
            ))}
          </div>
          <div style={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, borderRadius: 10, padding: '12px' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 10 }}>Shows by Decade</div>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={decadeData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CREAM_B} />
                <XAxis dataKey="decade" tick={{ fill: '#6B7F8F', fontSize: 8 }} />
                <YAxis tick={{ fill: '#6B7F8F', fontSize: 8 }} />
                <Tooltip contentStyle={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, fontSize: 10 }} />
                <Legend wrapperStyle={{ fontSize: 9 }} />
                <Bar dataKey="Small"   stackId="a" fill={SMALL}   name="Small" />
                <Bar dataKey="Medium"  stackId="a" fill={MEDIUM}  name="Medium" />
                <Bar dataKey="Large"   stackId="a" fill={LARGE}   name="Large" />
                <Bar dataKey="XLarge"  stackId="a" fill={XLARGE}  name="X-Large" />
                <Bar dataKey="Unknown" stackId="a" fill={UNKNOWN} name="Unknown" radius={[2,2,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px' }}>
          <div style={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#6B7F8F', fontWeight: 600 }}>Size:</span>
              {['All', 'S', 'M', 'L', 'XL', '?'].map((f, i) => (
                <button key={f} style={{ background: i === 0 ? TEAL : 'transparent', color: i === 0 ? CREAM : '#6B7F8F', border: `1px solid ${i === 0 ? TEAL : CREAM_B}`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>{f}</button>
              ))}
            </div>
          </div>
          <div style={{ background: CREAM_D, border: `1px solid ${CREAM_B}`, borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 8, padding: '6px 12px', fontSize: 9, fontWeight: 700, color: '#6B7F8F', textTransform: 'uppercase' as const, background: CREAM_M, borderBottom: `1px solid ${CREAM_B}` }}>
              <span>Artist</span><span>Venue</span><span>Date</span><span>Size</span>
            </div>
            {shows.map((show, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 8, padding: '8px 12px', borderBottom: i < shows.length - 1 ? `1px solid ${CREAM_B}` : 'none', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, color: TEAL, fontSize: 11 }}>{show.artist}</span>
                <span style={{ color: '#6B7F8F', fontSize: 11 }}>{show.venue}</span>
                <span style={{ color: '#6B7F8F', fontSize: 10 }}>{show.date}</span>
                <span style={{ background: `${sizeColor(show.size)}20`, color: sizeColor(show.size), border: `1px solid ${sizeColor(show.size)}50`, borderRadius: 20, padding: '1px 6px', fontSize: 9, fontWeight: 600, display: 'inline-block' }}>{show.size}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default function TestThemePage() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {VARIANTS.map(v => <DarkPanel key={v.name} v={v} />)}
      <LightPanel />
    </div>
  );
}
