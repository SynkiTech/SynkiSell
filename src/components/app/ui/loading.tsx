"use client";

import { useEffect, useState } from "react";
import { BrandLogo, BrandWordmark, BrandMark } from "./brand";
import { cn } from "@/lib/utils";

/**
 * Branded loading experiences.
 * `LoadingScreen`  — genuine initialisation (auth check, first boot only).
 * `InlineLoading`  — panel / section-level loading with a reason label.
 * Both respect prefers-reduced-motion via the CSS layer (animations collapse
 * to instant states) and never block forever — callers own timeouts/errors.
 */

export function LoadingScreen({ message = "Preparing your workspace" }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-[oklch(0.225_0.038_258)]" role="status" aria-live="polite">
      {/* Living navy gradient + slow ambient light */}
      <div
        className="absolute inset-0 opacity-90"
        style={{ background: "var(--grad-navy)" }}
        aria-hidden="true"
      />
      <div
        className="absolute -top-32 -left-32 h-[34rem] w-[34rem] rounded-full blur-3xl animate-fade-in"
        style={{ background: "radial-gradient(circle, oklch(0.55 0.09 200 / 30%), transparent 65%)", animationDuration: "3s" }}
        aria-hidden="true"
      />
      <div
        className="absolute -bottom-40 -right-24 h-[38rem] w-[38rem] rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.5 0.07 235 / 26%), transparent 65%)" }}
        aria-hidden="true"
      />

      <div className="relative flex flex-col items-center gap-6 px-6">
        <div className="rounded-3xl p-5 glass-nav shadow-2xl">
          <BrandLogo size={150} withGlow withSweep priority />
        </div>
        <BrandWordmark light className="text-2xl" />
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
            <div
              className="h-full w-1/2 rounded-full"
              style={{
                background: "linear-gradient(90deg, oklch(0.72 0.105 200), oklch(0.80 0.07 215))",
                animation: "sk-loading-slide 1.6s var(--ease-soft) infinite",
              }}
            />
          </div>
          <span className="sr-only">Loading</span>
        </div>
        <p className="text-sm text-white/60 tracking-wide">{message}…</p>
      </div>

      <style>{`@keyframes sk-loading-slide { 0% { transform: translateX(-120%);} 100% { transform: translateX(320%);} }`}</style>
    </div>
  );
}

export function InlineLoading({ label = "Loading", className }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-3 py-10 text-sm text-muted-foreground", className)} role="status">
      <BrandMark size={26} />
      <span>{label}…</span>
    </div>
  );
}

/**
 * Mounted-delay wrapper: shows the branded screen only if loading genuinely
 * takes time (>350ms), avoiding flashes on fast auth checks.
 */
export function DelayedLoading({ show, message }: { show: boolean; message?: string }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (show) {
      const t = setTimeout(() => setVisible(true), 350);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setVisible(false), 0);
    return () => clearTimeout(t);
  }, [show]);
  if (!show || !visible) return null;
  return <LoadingScreen message={message} />;
}
