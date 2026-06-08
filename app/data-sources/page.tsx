import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Data Sources — Grooveprint',
  description: 'The data sources and third-party services that power Grooveprint.',
}

interface Source {
  name: string
  domain: string
  category: string
  description: string
  licence?: string
  licenceUrl?: string
  url: string
  note?: string
}

const sources: Source[] = [
  {
    name: 'setlist.fm',
    domain: 'setlist.fm',
    category: 'Concert Data',
    description:
      'Concert and setlist data used to power show matching, discovery, and history features across all supported cities.',
    licence: 'CC BY-NC-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
    url: 'https://www.setlist.fm',
    note: 'Attribution required by licence. Data used under the Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International licence.',
  },
  {
    name: 'Spotify',
    domain: 'spotify.com',
    category: 'Music Library',
    description:
      'Liked songs and artist data accessed via the Spotify Web API when you connect your Spotify account. Used exclusively for matching your music library against our concert database.',
    url: 'https://developer.spotify.com',
  },
  {
    name: 'Google OAuth',
    domain: 'google.com',
    category: 'Authentication',
    description:
      'Sign-in via Google. When you authenticate with Google, we receive your email address to create and manage your Grooveprint account.',
    url: 'https://developers.google.com/identity',
  },
  {
    name: 'Supabase',
    domain: 'supabase.com',
    category: 'Database & Auth Infrastructure',
    description:
      'Database hosting and authentication infrastructure. Your personal data — including concert history, Spotify library data, and account information — is stored on Supabase servers located in the United States.',
    url: 'https://supabase.com',
  },
  {
    name: 'Vercel',
    domain: 'vercel.com',
    category: 'Web Infrastructure',
    description:
      'Hosting and delivery infrastructure for the Grooveprint web application. Vercel processes network request data including IP addresses and performance metrics as part of serving the Service.',
    url: 'https://vercel.com',
  },
]

export default function DataSourcesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Header */}
        <h1 className="text-3xl font-bold text-foreground mb-2">Data Sources</h1>
        <p className="text-sm text-muted-foreground mb-10">
          Grooveprint is built on data from the following sources and third-party services.
          We&apos;re committed to transparency about where data comes from and how it&apos;s used.
        </p>

        {/* Source cards */}
        <div className="space-y-4">
          {sources.map((source) => (
            <div
              key={source.name}
              className="rounded-lg border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <div className="flex items-center gap-2.5">
                  {/* Brand favicon via Google's favicon service */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${source.domain}&sz=32`}
                    width={16}
                    height={16}
                    alt=""
                    className="rounded-sm flex-shrink-0"
                  />
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-semibold text-foreground underline-offset-2 hover:underline"
                  >
                    {source.name}
                  </a>
                  <span className="text-xs text-muted-foreground">{source.category}</span>
                </div>
                {source.licence && (
                  <a
                    href={source.licenceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs px-2 py-0.5 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {source.licence}
                  </a>
                )}
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed pl-[26px]">
                {source.description}
              </p>
              {source.note && (
                <p className="mt-2 text-xs text-muted-foreground opacity-75 leading-relaxed pl-[26px]">
                  {source.note}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="mt-10 text-xs text-muted-foreground leading-relaxed">
          For questions about data sources or to make a privacy request, contact us at{' '}
          <a
            href="mailto:artur@grooveprint.app"
            className="underline hover:text-foreground transition-colors"
          >
            artur@grooveprint.app
          </a>
          . See our{' '}
          <a href="/privacy" className="underline hover:text-foreground transition-colors">
            Privacy Policy
          </a>
          {' '}for full details on how data is collected and used.
        </p>

      </div>
    </div>
  )
}
