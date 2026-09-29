import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "HALO HISOB — Naqd, hisob-raqam va delivery savdosi",
  description: "HALO POS ekranidan naqd, hisob-raqam savdosi va oshxonada yeyilgan ovqatni parolsiz kiritish oynasi.",
  applicationName: "HALO HISOB",
  manifest: "/halo-hisob-manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icons/halo-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/icons/halo-192.png",
  },
};

export default function HaloHisobLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
