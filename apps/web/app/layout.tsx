import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { ServiceWorkerRegister } from "@/components/service-worker-register";

const inter = Inter({ subsets: ["latin", "latin-ext"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Scrapping auta",
  description: "Hlídání inzerátů s ojetými auty napříč bazary",
  appleWebApp: {
    capable: true,
    title: "Auta",
    statusBarStyle: "default",
  },
  other: {
    // Next.js's `appleWebApp.capable` only emits the newer unprefixed
    // `mobile-web-app-capable` tag, which Safari only honors from iOS 16.4+.
    // The Apple-prefixed tag is what makes "Přidat na plochu" open in
    // standalone (no browser chrome) mode on older iPhones, so add it
    // explicitly alongside it.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f6cf5",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" className={inter.variable}>
      <body className="font-sans">
        <ServiceWorkerRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
