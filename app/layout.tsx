import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'DumpSite.io — Get Paid to Dump',
  description: 'Stop paying to dump. Start getting paid to haul. The DFW dirt logistics platform connecting dump truck drivers with active delivery jobs. Get paid $20-$35 per load.',
  keywords: 'dump truck jobs, get paid to dump dirt, DFW dump sites, dirt hauling jobs, dump truck driver pay',
  openGraph: {
    title: 'DumpSite.io — Get Paid to Dump',
    description: 'Stop paying to dump. Start getting paid to haul.',
    url: 'https://dumpsite.io',
    siteName: 'DumpSite.io',
  }
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
