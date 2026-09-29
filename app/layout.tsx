import type { Metadata, Viewport } from "next";
import "./globals.css";
import ZoomLock from "./zoom-lock";

export const metadata: Metadata = {
  title: "HALO Control — Ombor va marja nazorati",
  description: "HALO restoranining ombori, retseptlari, marjasi va yetkazib beruvchilar hisobini boshqarish.",
  applicationName: "HALO Control",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HALO Control",
  },
  formatDetection: {
    telephone: false,
  },
  other: {
    "codex-preview": "development",
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "HALO Control",
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/halo-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/halo-192.png",
    apple: [
      { url: "/icons/halo-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0b0d0f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz">
      <body className="antialiased">
        <ZoomLock />
        {children}
      </body>
    </html>
  );
}
