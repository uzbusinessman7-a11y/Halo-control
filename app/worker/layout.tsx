import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HALO Xodim",
  description: "HALO xodimlari uchun savdo, minus mahsulot va xarajat kiritish dasturi.",
  applicationName: "HALO Xodim",
  manifest: "/xodim-manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HALO Xodim",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "HALO Xodim",
    "mobile-web-app-capable": "yes",
  },
  icons: {
    icon: [
      { url: "/icons/halo-xodim-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/halo-xodim-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/icons/halo-xodim-192.png",
    apple: [{ url: "/icons/halo-xodim-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default function WorkerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
