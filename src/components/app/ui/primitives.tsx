"use client";

import { forwardRef } from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────────── Surfaces ───────────────────────────── */

export const GlassCard = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & {
  intensity?: "subtle" | "default" | "strong";
  hover?: boolean;
}>(function GlassCard({ className, intensity = "default", hover = false, ...props }, ref) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl",
        intensity === "strong" ? "glass-strong" : intensity === "subtle" ? "glass-subtle" : "glass",
        hover && "lift",
        className
      )}
      {...props}
    />
  );
});

/* ───────────────────── Staggered entrance helper ───────────────────── */

export function Stagger({
  children,
  className,
  delay = 0,
  step = 0.055,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  step?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <div className={className}>
      {Array.isArray(children)
        ? children.map((child, i) =>
            child ? (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1], delay: delay + i * step }}
              >
                {child}
              </motion.div>
            ) : null
          )
        : children}
    </div>
  );
}

export function FadeIn({ children, className, ...rest }: HTMLMotionProps<"div">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/* ─────────────────────────── Page header ─────────────────────────── */

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <FadeIn className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </FadeIn>
  );
}

/* ─────────────────────────── Trend badge ─────────────────────────── */

export function TrendBadge({ value, label }: { value: number | null; label?: string }) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> {label ?? "no comparison"}
      </span>
    );
  }
  const up = value >= 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium",
        up ? "bg-[oklch(0.585_0.115_163/0.12)] text-[oklch(0.50_0.11_163)]" : "bg-destructive/10 text-destructive"
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{value}%{label ? <span className="font-normal opacity-70">{label}</span> : null}
    </span>
  );
}

/* ─────────────────────────── Empty state ─────────────────────────── */

export function EmptyState({
  icon: Icon,
  title,
  hint,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  hint?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-center", className)}>
      {Icon && (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}
