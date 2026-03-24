import type { Metadata } from 'next'
import './globals.css'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import PostHogProvider from '@/components/PostHogProvider'
import SupportWidget from '@/components/SupportWidget'

export const metadata: Metadata = {
  title: { default: 'DumpSite.io — Get Paid to Dump', template: '%s | DumpSite.io' },
  description: 'Stop paying to dump. Start getting paid to haul. DFW\'s fastest growing dirt logistics platform connecting dump truck drivers with active delivery jobs paying $35-$55 per load.',
  keywords: 'dump truck jobs DFW, get paid to dump dirt Dallas, dump site Fort Worth, dirt hauling jobs Texas, dump truck driver pay, excavation company DFW',
  metadataBase: new URL('https://dumpsite.io'),
  openGraph: {
    title: 'DumpSite.io — Get Paid to Dump',
    description: 'DFW\'s fastest growing dirt logistics platform. Drivers earn $35-$55 per load.',
    url: 'https://dumpsite.io',
    siteName: 'DumpSite.io',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DumpSite.io — Get Paid to Dump',
    description: 'DFW\'s fastest growing dirt logistics platform.',
  },
  manifest: '/manifest.json',
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'apple-mobile-web-app-title': 'DumpSite',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#F5A623" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: 'DumpSite.io',
            description: 'Dirt logistics marketplace connecting dump truck drivers with active delivery jobs across DFW.',
            url: 'https://dumpsite.io',
            areaServed: { '@type': 'Place', name: 'Dallas-Fort Worth Metroplex, Texas' },
            priceRange: '$35-$55 per load',
          })}}
        />
      </head>
      <body>
        {children}
        <SupportWidget />
        <PostHogProvider />
        <Analytics />
        <SpeedInsights />
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}` }} />
      </body>
    </html>
  )
}
