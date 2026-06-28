import { Geist, Geist_Mono, Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-inter'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", inter.variable)}
    >
      <body>
        {/*
          localhost:3000 을 쓰던 다른 프로젝트(pflow 등)의 서비스워커가 살아있으면
          /_next/static/ 청크를 Cache-First 로 가로채 옛(다른 프로젝트의) 번들을 서빙한다.
          → 에디터 단축키 등 최신 코드가 통째로 동작하지 않는 것처럼 보인다.
          SW 등록을 모두 해제하고 캐시를 비운 뒤 "한 번만" 새로고침해 깨끗한 번들을 받게 한다.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (rs) {
    if (rs.length === 0) return;
    Promise.all(rs.map(function (r) { return r.unregister(); }))
      .then(function () {
        return window.caches
          ? caches.keys().then(function (ks) {
              return Promise.all(ks.map(function (k) { return caches.delete(k); }));
            })
          : null;
      })
      .then(function () {
        if (!sessionStorage.getItem('__sw_purged')) {
          sessionStorage.setItem('__sw_purged', '1');
          location.reload();
        }
      });
  });
})();
`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          // React 19 hoists this stylesheet <link> into <head> automatically
          precedence="default"
          href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700;800&display=swap"
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
