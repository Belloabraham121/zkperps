import type { Metadata } from "next";
import { Geist, Geist_Mono, Syne } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "ZK Perps — Private perpetuals on Uniswap V4",
  description:
    "Perpetual futures with privacy-preserving batch execution. Trade ETH/USD with commit-reveal and zero-knowledge proofs.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${syne.variable} antialiased`}
        suppressHydrationWarning
      >
        <Providers>{children}</Providers>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
