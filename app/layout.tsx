import type { Metadata } from 'next'
import { Noto_Sans_SC, Press_Start_2P } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import {
  BRAND_DESCRIPTION,
  BRAND_NAME,
  BRANDING_ASSETS,
} from '@/lib/branding'
import './globals.css'

const notoSansSC = Noto_Sans_SC({
  weight: ['400', '500', '700'],
  subsets: ['latin'],
  variable: '--font-sans-cn',
})

const pressStart2P = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
})

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
      <body className={`${notoSansSC.variable} ${pressStart2P.variable} font-sans antialiased`}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
