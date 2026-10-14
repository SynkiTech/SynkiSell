"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * SynkiSell brand components.
 * The approved logo PNG is the source of truth — never distorted, only
 * revealed (fade-up), illuminated (light sweep) and haloed (soft glow).
 * Swap `/branding/synkisell-logo.png` to rebrand every surface at once.
 */

export function BrandLogo({
  size = 40,
  withGlow = false,
  withSweep = false,
  className,
  priority = false,
}: {
  size?: number;
  withGlow?: boolean;
  withSweep?: boolean;
  className?: string;
  priority?: boolean;
}) {
  const h = Math.round(size * (369 / 677));
  return (
    <span
      className={cn("relative inline-block shrink-0 animate-fade-up", withSweep && "sweep", className)}
      aria-label="SynkiSell"
      role="img"
    >
      <Image
        src="/branding/synkisell-logo.png"
        alt=""
        width={size}
        height={h}
        priority={priority}
        className={cn("object-contain", withGlow && "animate-pulse-glow")}
        style={{ width: size, height: h }}
      />
    </span>
  );
}

/** Wordmark text used beside the mark (sidebar, login, loading). */
export function BrandWordmark({ className, light = false }: { className?: string; light?: boolean }) {
  return (
    <span className={cn("font-semibold tracking-tight leading-none select-none", className)}>
      <span className={light ? "text-white" : "text-foreground"}>Synki</span>
      <span className={light ? "text-gradient-light" : "text-gradient"}>Sell</span>
    </span>
  );
}

/** Compact animated mark for spinners / compact surfaces. */
export function BrandMark({ size = 44, className }: { size?: number; className?: string }) {
  return (
    <span className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size} fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="sk-brand-grad" x1="4" y1="4" x2="44" y2="44" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="oklch(0.62 0.105 200)" />
            <stop offset="1" stopColor="oklch(0.47 0.088 240)" />
          </linearGradient>
        </defs>
        <rect x="4" y="4" width="40" height="40" rx="12" fill="url(#sk-brand-grad)" />
        {/* Abstract “S” flow — two opposing arcs */}
        <path
          d="M31 17.5c-1.8-2-4.4-3-7.2-2.7-3.6.4-6.3 2.6-6.3 5.5 0 6.4 14 3.6 14 10 0 3-2.9 5.3-6.7 5.6-3.2.3-6.2-.9-8-3.1"
          stroke="white"
          strokeWidth="3.4"
          strokeLinecap="round"
          opacity="0.95"
        />
      </svg>
      <span className="absolute inset-0 rounded-xl animate-ping bg-teal-400/20" aria-hidden="true" />
    </span>
  );
}
