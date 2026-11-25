import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Serif_4 } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const serif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Spend Intelligence",
  description: "Pacing, not caps: fix it or fund it.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${serif.variable}`}>
      <body className="antialiased">
        {children}
        {/* Vercel Web Analytics: page views and the steps visitors reach (src/lib/track.ts). Served by Vercel only, so it
            does nothing locally. Cookieless; no personal data. */}
        {process.env.VERCEL && (
          <>
            <Script id="va-queue" strategy="beforeInteractive">{"window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };"}</Script>
            <Script src="/_vercel/insights/script.js" strategy="afterInteractive" />
          </>
        )}
      </body>
    </html>
  );
}
