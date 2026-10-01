import type { Metadata } from 'next'
import { Fraunces, IBM_Plex_Mono, Instrument_Sans } from 'next/font/google'
import './globals.css'

// Three typefaces, each with one job.
//
// Fraunces carries product and company names — it has enough character to
// make a name read as a heading rather than as data. It is licensed under the
// SIL Open Font License, so shipping it is fine.
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

// Instrument Sans is everything else: body copy, labels, controls.
const instrumentSans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
})

// IBM Plex Mono is reserved for things that are literally numbers or codes —
// barcodes, counts, dates. Setting them in a monospace is not decoration: it
// tells a reader at a glance that this is a value copied from a record, not
// prose we wrote.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'Rootify',
    template: '%s · Rootify',
  },
  description:
    'Public records on what you buy: ingredients, recalls, certificates and who owns the brand — each one with a link to the record it came from and the date it was read.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrumentSans.variable} ${plexMono.variable} h-full`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
