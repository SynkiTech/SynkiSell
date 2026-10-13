import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SynkiSell — Pharmacy & Supermarket Management",
  description:
    "SynkiSell is a multi-tenant SaaS for Nigerian businesses running a pharmacy and supermarket together: one shared POS, batch/FEFO inventory, purchasing, reports and AI insights.",
  keywords: ["SynkiSell", "pharmacy POS", "supermarket management", "Nigeria", "inventory", "FEFO"],
  authors: [{ name: "SynkiTech" }],
  icons: { icon: "/branding/synkisell-logo.png" },
  openGraph: {
    title: "SynkiSell — Pharmacy & Supermarket Management",
    description: "One business account. One shared POS. One consolidated dashboard.",
    siteName: "SynkiSell",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
