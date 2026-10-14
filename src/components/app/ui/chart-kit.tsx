"use client";

import { useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { GlassCard } from "./primitives";
import { InlineLoading } from "./loading";
import { EmptyState } from "./primitives";
import { cn } from "@/lib/utils";

/**
 * SynkiSell chart kit — one coherent animation & colour language for every
 * visualisation. Colours come from the design-system chart tokens so charts
 * always match the brand. All data passed in must be REAL backend figures.
 */

/* Department / series identity — used consistently across the product */
export const SERIES = {
  pharmacy: "var(--chart-1)",
  supermarket: "var(--chart-2)",
  profit: "var(--chart-3)",
  warning: "var(--chart-4)",
  aux: "var(--chart-5)",
} as const;

export const AXIS_STYLE = {
  stroke: "oklch(0.62 0.02 248)",
  fontSize: 11,
} as const;

const nairaShort = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `₦${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `₦${(v / 1_000).toFixed(0)}k`;
  return `₦${v}`;
};

export const shortMoney = nairaShort;

/* ───────────────────────── Glass tooltip ───────────────────────── */

function GlassTooltip({ active, payload, label, formatter, labelFormatter }: TooltipProps<number, string> & {
  formatter?: (v: number, name: string) => string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2.5 text-xs shadow-lg" role="presentation">
      {label !== undefined && (
        <p className="mb-1.5 font-semibold text-foreground">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>
      )}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke || "var(--chart-1)" }} aria-hidden="true" />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {formatter ? formatter(Number(p.value), String(p.name)) : Number(p.value).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────── Gradient fill defs ─────────────────────── */

function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.34} />
        <stop offset="100%" stopColor={color} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );
}

/* ───────────────────────── Chart container ───────────────────────── */

export function ChartCard({
  title,
  description,
  actions,
  loading = false,
  error,
  empty,
  emptyHint,
  height = 300,
  className,
  children,
  overlay,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyHint?: string;
  height?: number;
  className?: string;
  children: React.ReactNode;
  overlay?: React.ReactNode;
}) {
  return (
    <GlassCard className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
        <div className="min-w-0">
          <h3 className="text-[0.95rem] font-semibold leading-tight">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      <div className="relative px-2 pb-3 pt-3 sm:px-4" style={{ height }}>
        {loading ? (
          <InlineLoading label="Loading chart" />
        ) : error ? (
          <EmptyState title="Couldn't load this chart" hint={error} className="h-full border-0" />
        ) : empty ? (
          <EmptyState title="No data for this period" hint={emptyHint ?? "Figures appear here as soon as transactions are recorded."} className="h-full border-0" />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {children as React.ReactElement}
          </ResponsiveContainer>
        )}
        {overlay && !loading && !error && !empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            {overlay}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/* ─────────────────── Ready-made animated charts ─────────────────── */

export type SeriesPoint = Record<string, number | string>;

export function RevenueAreaChart({
  data,
  series,
  xKey = "label",
  money = true,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string; color: string; dashed?: boolean }[];
  xKey?: string;
  money?: boolean;
}) {
  const uid = useId().replace(/[:]/g, "");
  return (
    <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
      {series.map((s, i) => (
        <AreaGradient key={s.key} id={`${uid}-${i}`} color={s.color} />
      ))}
      <CartesianGrid strokeDasharray="3 6" stroke="oklch(0.85 0.012 245)" vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} minTickGap={18} />
      <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => (money ? nairaShort(v) : String(v))} />
      <Tooltip
        cursor={{ stroke: "oklch(0.72 0.105 200 / 40%)", strokeWidth: 1.5 }}
        content={
          <GlassTooltip
            formatter={(v) => (money ? nairaShort(v) : v.toLocaleString())}
            labelFormatter={(l) => String(l)}
          />
        }
      />
      {series.map((s, i) => (
        <Area
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          strokeWidth={2}
          fill={`url(#${uid}-${i})`}
          strokeDasharray={s.dashed ? "5 4" : undefined}
          animationDuration={900}
          animationEasing="ease-out"
        />
      ))}
    </AreaChart>
  );
}

export function ComparisonBarChart({
  data,
  bars,
  xKey = "name",
  money = true,
  stacked = false,
  colorMap,
}: {
  data: SeriesPoint[];
  bars: { key: string; name: string; color?: string }[];
  xKey?: string;
  money?: boolean;
  stacked?: boolean;
  colorMap?: (entry: SeriesPoint, index: number) => string;
}) {
  return (
    <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }} barCategoryGap="22%">
      <CartesianGrid strokeDasharray="3 6" stroke="oklch(0.85 0.012 245)" vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} />
      <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => (money ? nairaShort(v) : String(v))} />
      <Tooltip
        cursor={{ fill: "oklch(0.585 0.093 201 / 6%)", radius: 8 }}
        content={<GlassTooltip formatter={(v) => (money ? nairaShort(v) : v.toLocaleString())} />}
      />
      {bars.map((b) => (
        <Bar
          key={b.key}
          dataKey={b.key}
          name={b.name}
          fill={b.color ?? "var(--chart-1)"}
          radius={[6, 6, 0, 0]}
          stackId={stacked ? "a" : undefined}
          animationDuration={800}
          animationEasing="ease-out"
        >
          {colorMap && data.map((entry, i) => <Cell key={i} fill={colorMap(entry, i)} />)}
        </Bar>
      ))}
    </BarChart>
  );
}

export function DonutChart({
  data,
  colors,
  money = true,
  innerRadius = "62%",
}: {
  data: { name: string; value: number }[];
  colors?: string[];
  money?: boolean;
  innerRadius?: string;
}) {
  const palette = colors ?? ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "oklch(0.72 0.04 258)"];
  return (
    <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
      <Tooltip content={<GlassTooltip formatter={(v) => (money ? nairaShort(v) : v.toLocaleString())} />} />
      <Pie
        data={data}
        dataKey="value"
        nameKey="name"
        innerRadius={innerRadius as unknown as number}
        outerRadius="86%"
        paddingAngle={2}
        strokeWidth={0}
        animationDuration={850}
        animationEasing="ease-out"
      >
        {data.map((_, i) => (
          <Cell key={i} fill={palette[i % palette.length]} />
        ))}
      </Pie>
    </PieChart>
  );
}

export function TrendLineChart({
  data,
  series,
  xKey = "label",
  money = true,
}: {
  data: SeriesPoint[];
  series: { key: string; name: string; color: string; dashed?: boolean }[];
  xKey?: string;
  money?: boolean;
}) {
  return (
    <LineChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 6" stroke="oklch(0.85 0.012 245)" vertical={false} />
      <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} dy={6} minTickGap={18} />
      <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => (money ? nairaShort(v) : String(v))} />
      <Tooltip
        cursor={{ stroke: "oklch(0.72 0.105 200 / 40%)", strokeWidth: 1.5 }}
        content={<GlassTooltip formatter={(v) => (money ? nairaShort(v) : v.toLocaleString())} />}
      />
      {series.map((s) => (
        <Line
          key={s.key}
          type="monotone"
          dataKey={s.key}
          name={s.name}
          stroke={s.color}
          strokeWidth={2.2}
          strokeDasharray={s.dashed ? "5 4" : undefined}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "#fff" }}
          animationDuration={900}
          animationEasing="ease-out"
        />
      ))}
    </LineChart>
  );
}

/** Legend chips with the series colours (consistent across the product). */
export function ChartLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 pb-3 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: i.color }} aria-hidden="true" />
          {i.name}
        </span>
      ))}
    </div>
  );
}
