import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from './providers/AuthProvider'
import { ThemeProvider } from '@/components/ThemeProvider'
import { Analytics } from '@vercel/analytics/next'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import Footer from './components/Footer'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Grooveprint',
  description: 'Track your musical footprint. 350,000+ concerts across North America since 1900.',
  openGraph: {
    title: 'Grooveprint',
    description: 'Track your musical footprint. 350,000+ concerts across North America since 1900.',
    url: 'https://www.grooveprint.app',
    siteName: 'Grooveprint',
    images: [{ url: 'https://www.grooveprint.app/og-image.png', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Grooveprint',
    description: 'Track your musical footprint. 350,000+ concerts across North America since 1900.',
    images: ['https://www.grooveprint.app/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <div className="flex flex-col min-h-screen">
              {children}
              <Footer />
            </div>
          </AuthProvider>
        </ThemeProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
