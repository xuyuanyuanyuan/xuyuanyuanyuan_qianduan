import type { Metadata } from 'next'
import { Noto_Sans_SC, Press_Start_2P } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

// 现代可读中文字体
const notoSansSC = Noto_Sans_SC({ 
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  variable: '--font-sans-cn'
});

// 像素字体仅用于特殊装饰
const pressStart2P = Press_Start_2P({ 
  weight: "400",
  subsets: ["latin"],
  variable: '--font-pixel'
});

export const metadata: Metadata = {
  title: '工程智能助手 - Pixel AI Chat',
  description: '像素风格的AI智能对话助手，专注于工程问题解答',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${notoSansSC.variable} ${pressStart2P.variable} font-sans antialiased`}>
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
