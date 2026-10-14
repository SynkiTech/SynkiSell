"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { GlassCard, TrendBadge } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * Animated KPI card.
 * - Counts into its final value once, when valid data arrives (never loops).
 * - Staggered entrance handled by the parent <Stagger>.
 * - Honest states: `loading` renders a skeleton, never a fabricated figure.
 */

const nairaFmt = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const plainFmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });

function useCountUp(target: number, active: boolean, duration = 850): number {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(() => (reduce ? target : 0));
  useEffect(() => {
    if (!active) return;
    let raf: number;
    if (reduce) {
      // Jump straight to the final value — no counting animation.
      raf = requestAnimationFrame(() => setDisplay(target));
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const from = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4); // ease-out-quart
      setDisplay(from + (target - from) * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [target, active, duration, reduce]);
  return display;
}

export type KpiTone = "brand" | "default" | "positive" | "warning" | "danger";

const toneStyles: Record<KpiTone, { accent: string; iconWrap: string }> = {
  brand: { accent: "var(--grad-brand)", iconWrap: "bg-primary/10 text-primary" },
  default: { accent: "var(--grad-ice)", iconWrap: "bg-secondary text-secondary-foreground" },
  positive: { accent: "var(--grad-positive)", iconWrap: "bg-[oklch(0.585_0.115_163/0.12)] text-[oklch(0.50_0.11_163)]" },
  warning: { accent: "var(--grad-warning)", iconWrap: "bg-amber-500/10 text-amber-600" },
  danger: { accent: "var(--grad-danger)", iconWrap: "bg-destructive/10 text-destructive" },
};

export function KpiCard({
  title,
  value,
  format = "naira",
  sub,
  trend,
  trendLabel,
  icon: Icon,
  tone = "default",
  loading = false,
  footer,
}: {
  title: string;
  value: number | null;
  format?: "naira" | "number" | "raw";
  sub?: React.ReactNode;
  trend?: number | null;
  trendLabel?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: KpiTone;
  loading?: boolean;
  footer?: React.ReactNode;
}) {
  const active = !loading && typeof value === "number";
  const animated = useCountUp(typeof value === "number" ? value : 0, active);
  const fmt = (v: number) =>
    format === "naira" ? nairaFmt.format(Math.round(v)) : format === "number" ? plainFmt.format(Math.round(v)) : String(Math.round(v));
  const t = toneStyles[tone];

  if (loading) {
    return (
      <GlassCard className="overflow-hidden">
        <div className="p-4 sm:p-5">
          <div className="h-3.5 w-24 animate-pulse rounded bg-secondary" />
          <div className="mt-3 h-7 w-36 animate-pulse rounded bg-secondary" />
          <div className="mt-2 h-3 w-40 animate-pulse rounded bg-secondary/70" />
        </div>
        <div className="h-1 w-full bg-secondary/60" />
      </GlassCard>
    );
  }

  return (
    <GlassCard hover className="group relative overflow-hidden">
      {/* Gradient accent edge */}
      <div className="absolute inset-x-0 top-0 h-1 opacity-80" style={{ background: t.accent }} aria-hidden="true" />
      {/* Soft corner light */}
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{ background: t.accent, filter: "blur(36px)", opacity: 0.14 }}
        aria-hidden="true"
      />
      <div className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
          {Icon && (
            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-300 group-hover:scale-110", t.iconWrap)}>
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <p className="mt-2 text-[1.55rem] font-bold leading-tight tracking-tight tabular-nums" aria-label={typeof value === "number" ? fmt(value) : undefined}>
          {active ? fmt(animated) : <span className="text-muted-foreground">—</span>}
        </p>
        {(sub || trend !== undefined) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {trend !== undefined && <TrendBadge value={trend} label={trendLabel} />}
            {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
          </div>
        )}
        {footer && <div className="mt-3 border-t pt-2.5 text-xs text-muted-foreground">{footer}</div>}
      </div>
    </GlassCard>
  );
}
