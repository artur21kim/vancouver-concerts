import type { Metadata } from 'next'
import './globals.css'
import { AuthProvider } from './providers/AuthProvider'
import { Analytics } from '@vercel/analytics/next'

export const metadata: Metadata = {
  title: 'Vancouver Concert History',
  description: 'Browse 35,000+ concerts in Vancouver since 1900',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
