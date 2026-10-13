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

/**
 * Some environments (browser extensions, embedded preview iframes) inject
 * instrumentation attributes (bis_size, bis_frame_id, __processed_*, …) onto
 * arbitrary DOM elements before React hydrates, causing hydration mismatch
 * warnings. suppressHydrationWarning only works one level deep, so instead we
 * strip those attributes as early as possible and keep watching for new ones
 * via a MutationObserver. React then never sees them.
 */
const stripInstrumentationScript = `(function () {
  try {
    var RX = /^(__processed_|bis_)/;
    function strip(el) {
      if (!el || !el.attributes) return;
      for (var i = el.attributes.length - 1; i >= 0; i--) {
        var name = el.attributes[i].name;
        if (RX.test(name)) el.removeAttribute(name);
      }
    }
    strip(document.documentElement);
    strip(document.body);
    var mo = new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        if (r.type === "attributes") {
          if (r.attributeName && RX.test(r.attributeName)) strip(r.target);
        } else if (r.addedNodes && r.addedNodes.length) {
          for (var j = 0; j < r.addedNodes.length; j++) strip(r.addedNodes[j]);
        }
      }
    });
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  } catch (e) {}
})();`;

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
        <script
          id="strip-instrumentation-attrs"
          dangerouslySetInnerHTML={{ __html: stripInstrumentationScript }}
        />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
