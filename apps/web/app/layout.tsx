import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scrapping auta",
  description: "Hlídání inzerátů s ojetými auty napříč bazary",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body>
        <div className="min-h-screen">
          <header className="border-b border-gray-200 bg-white">
            <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
              <Link href="/" className="text-base font-semibold text-brand-700">
                🚗 Scrapping auta
              </Link>
              <Link href="/" className="text-gray-600 hover:text-gray-900">
                Přehled
              </Link>
              <Link href="/searches" className="text-gray-600 hover:text-gray-900">
                Hledání
              </Link>
              <Link href="/sources" className="text-gray-600 hover:text-gray-900">
                Stav zdrojů
              </Link>
            </nav>
          </header>
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
