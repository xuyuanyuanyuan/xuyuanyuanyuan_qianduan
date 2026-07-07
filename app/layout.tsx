import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRANDING_ASSETS,
} from '@/lib/branding'
import './globals.css'

const faviconHref = `${BRANDING_ASSETS.favicon}?v=20260416`

export const metadata: Metadata = {
  title: BRAND_NAME,
  description: BRAND_DESCRIPTION,
  applicationName: BRAND_NAME,
  generator: BRAND_NAME,
  openGraph: {
    title: BRAND_NAME,
    description: BRAND_DESCRIPTION,
    siteName: BRAND_NAME,
  },
  icons: {
    icon: [
      {
        url: faviconHref,
        type: 'image/jpeg',
      },
    ],
    shortcut: faviconHref,
    apple: faviconHref,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href={faviconHref} type="image/jpeg" />
        <link rel="shortcut icon" href={faviconHref} type="image/jpeg" />
        <link rel="apple-touch-icon" href={faviconHref} />
      </head>
      <body className="font-sans antialiased">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
