import type { Metadata, Viewport } from "next";
import { Outfit, Fraunces } from "next/font/google";
import "./globals.css";

const sans = Outfit({ subsets: ["latin"], variable: "--font-sans" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: {
    default: "CallNBarb — Your barber, wherever you are",
    template: "%s · CallNBarb",
  },
  description:
    "Book a professional barber to your doorstep. Pay securely, get a QR appointment code, and get fresh wherever you are.",
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "CallNBarb — Call a Barber. Get Fresh.",
    description: "On-demand home barbing. Discover barbers, book, pay, and verify with QR.",
    type: "website",
  },
  robots: { index: true, follow: true },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#16130f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body className="min-h-screen bg-ink-950 text-cream antialiased">{children}</body>
    </html>
  );
}
