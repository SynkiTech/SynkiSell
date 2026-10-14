"use client";

import { useMemo, useState } from "react";
import { getDashboard, type DashboardData } from "@/server/queries/dashboard";
import { formatNaira, formatQty } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/app-store";
import { useDataLoader } from "@/hooks/use-data-loader";
import { Stagger, PageHeader, GlassCard, EmptyState } from "./ui/primitives";
import { KpiCard } from "./ui/kpi-card";
import { ChartCard, RevenueAreaChart, TrendLineChart, ComparisonBarChart, DonutChart, ChartLegend, SERIES, shortMoney } from "./ui/chart-kit";
import { cn } from "@/lib/utils";
import {
  TrendingUp, Wallet, Boxes, CalendarClock, TriangleAlert, PiggyBank, Truck,
  ShieldAlert, ScanBarcode, Sparkles, Info, ArrowRight, PackageX, Hourglass, BadgePercent,
} from "lucide-react";

/* Segmented control for chart metric / range switches */
function Segmented<T extends string>({
  options, value, onChange, ariaLabel,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex rounded-lg border bg-secondary/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-200",
            value === o.value ? "text-white shadow-sm [background:var(--grad-brand)]" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardView({ businessId }: { businessId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTrigger = useAppStore((s) => s.refreshTrigger);
  const setActiveView = useAppStore((s) => s.setActiveView);

  const [range, setRange] = useState<"14" | "30">("30");
  const [revenueMode, setRevenueMode] = useState<"departments" | "profit">("departments");
  const [deptMetric, setDeptMetric] = useState<"revenue" | "grossProfit" | "units">("revenue");

  useDataLoader(async () => {
    setError(null);
    try {
      const d = await getDashboard(businessId);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }, [businessId, refreshTrigger], 60_000);

  const trendSlice = useMemo(() => (data ? data.trend.slice(-Number(range)) : []), [data, range]);
  const total30 = useMemo(() => (data ? data.trend.reduce((a, t) => a + t.revenue, 0) : 0), [data]);
  const trendHasData = trendSlice.some((t) => t.revenue > 0);
  const deptHasData = (data?.departmentComparison.length ?? 0) > 0;

  if (error) {
    return (
      <Alert variant="destructive" className="glass-strong border-destructive/30">
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Could not load dashboard</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-48 animate-pulse rounded-lg bg-secondary" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <KpiCard key={i} title="" value={null} loading />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-80 animate-pulse rounded-2xl bg-secondary/60 lg:col-span-2" />
          <div className="h-80 animate-pulse rounded-2xl bg-secondary/60" />
        </div>
      </div>
    );
  }

  const subStatus = data.subscription?.status ?? "—";
  const deptToday = data.departments;
  const pharmNum = Number(String(deptToday.find((d) => d.department === "PHARMACY")?.total ?? 0));
  const marketNum = Number(String(deptToday.find((d) => d.department === "SUPERMARKET")?.total ?? 0));
  const todayTotal = pharmNum + marketNum;
  const paymentMixEntries = Object.entries(data.paymentMix);
  const expiryAtRisk = data.expiryRisk.within30.value + data.expiryRisk.within90.value + data.expiryRisk.expired.value;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        subtitle={
          <span className="inline-flex items-center gap-1.5">
            Live figures from your records
            <span className="inline-flex items-center gap-1">
              <span className="relative flex h-1.5 w-1.5"><span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400/70" /><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /></span>
              refreshed {new Date(data.generatedAt).toLocaleTimeString()}
            </span>
          </span>
        }
        actions={
          data.subscription && (
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 px-2.5 py-1",
                subStatus === "ACTIVE"
                  ? "border-[oklch(0.585_0.093_201/0.35)] bg-[oklch(0.585_0.093_201/0.08)] text-primary"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              )}
            >
              <CalendarClock className="h-3 w-3" />
              {subStatus} {data.subscription.endDate ? `• renews ${new Date(data.subscription.endDate).toLocaleDateString()}` : ""}
            </Badge>
          )
        }
      />

      {/* KPI row 1 — trading today */}
      <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Today's sales"
          value={Number(String(data.today.sales))}
          icon={TrendingUp}
          tone="brand"
          trend={data.growthPct !== null ? Number(String(data.growthPct)) : null}
          trendLabel="vs yesterday"
          sub={`${data.today.count} sale(s) today`}
        />
        <KpiCard
          title="Gross profit (today)"
          value={Number(String(data.today.grossProfit))}
          icon={PiggyBank}
          tone="positive"
          sub="revenue − product cost. Not net profit."
        />
        <KpiCard
          title="This week's sales"
          value={Number(String(data.week.sales))}
          icon={Wallet}
          sub={`prev. week ${formatNaira(data.week.prevSales)} • GP ${formatNaira(data.week.grossProfit)}`}
        />
        <KpiCard
          title="Supplier balance"
          value={Number(String(data.supplierBalance))}
          icon={Truck}
          tone={Number(String(data.supplierBalance)) > 0 ? "warning" : "default"}
          sub="payables from credit purchases"
        />
      </Stagger>

      {/* KPI row 2 — stock & period */}
      <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" delay={0.08}>
        <KpiCard
          title="Revenue — last 30 days"
          value={total30}
          icon={TrendingUp}
          tone="brand"
          sub="completed sales"
        />
        <KpiCard
          title="Inventory value (at cost)"
          value={data.inventory.totalValue}
          icon={Boxes}
          sub={`${data.inventory.valueByDept.map((d) => `${d.name} ${shortMoney(d.value)}`).join(" • ") || "no stock"}`}
        />
        <KpiCard
          title="Stock at expiry risk"
          value={expiryAtRisk}
          icon={Hourglass}
          tone={expiryAtRisk > 0 ? "warning" : "default"}
          sub={`${data.expiryRisk.expired.batches + data.expiryRisk.within30.batches + data.expiryRisk.within90.batches} batch(es) within 90 days`}
        />
        <KpiCard
          title="Products to restock"
          value={data.inventory.restockCount}
          format="number"
          icon={PackageX}
          tone={data.inventory.restockCount > 0 ? "danger" : "positive"}
          sub={data.inventory.restockCount > 0 ? "at or below reorder level" : "all above reorder level"}
        />
      </Stagger>

      {/* Alerts */}
      {(data.expiringBatches.length > 0 || data.lowStock.length > 0) && (
        <Stagger className="grid gap-4 md:grid-cols-2" delay={0.05}>
          {data.expiringBatches.length > 0 && (
            <Alert className="glass border-amber-400/50 bg-amber-500/10">
              <TriangleAlert className="h-4 w-4 text-amber-600" />
              <AlertTitle className="text-amber-700">Expiry review needed</AlertTitle>
              <AlertDescription className="text-amber-700/90">
                {data.expiringBatches.length} medicine batch(es) expiring within 90 days — {formatNaira(data.expiringValue)} at cost at risk. Check Inventory → Expiry watch.
              </AlertDescription>
            </Alert>
          )}
          {data.lowStock.length > 0 && (
            <Alert className="glass border-red-400/50 bg-red-500/10">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <AlertTitle className="text-destructive">Out of stock ({data.lowStock.length})</AlertTitle>
              <AlertDescription className="text-destructive/90">
                {data.lowStock.slice(0, 4).map((p) => p.name).join(", ")}
                {data.lowStock.length > 4 ? ` +${data.lowStock.length - 4} more` : ""} — reorder now.
              </AlertDescription>
            </Alert>
          )}
        </Stagger>
      )}

      {/* Revenue trend + department share */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Stagger className="lg:col-span-2" delay={0.05}>
          <ChartCard
            title="Revenue trend"
            description={revenueMode === "departments" ? "Daily sales by department" : "Daily revenue vs estimated gross profit"}
            loading={!data}
            empty={!trendHasData}
            height={320}
            actions={
              <div className="flex flex-wrap items-center gap-1.5">
                <Segmented
                  ariaLabel="Revenue metric"
                  value={revenueMode}
                  onChange={setRevenueMode}
                  options={[{ value: "departments", label: "Departments" }, { value: "profit", label: "Profit" }]}
                />
                <Segmented
                  ariaLabel="Period range"
                  value={range}
                  onChange={setRange}
                  options={[{ value: "14", label: "14d" }, { value: "30", label: "30d" }]}
                />
              </div>
            }
          >
            {revenueMode === "departments" ? (
              <RevenueAreaChart
                data={trendSlice}
                series={[
                  { key: "pharmacy", name: "Pharmacy", color: SERIES.pharmacy },
                  { key: "supermarket", name: "Supermarket", color: SERIES.supermarket },
                ]}
              />
            ) : (
              <TrendLineChart
                data={trendSlice}
                series={[
                  { key: "revenue", name: "Revenue", color: SERIES.pharmacy },
                  { key: "grossProfit", name: "Gross profit", color: SERIES.profit },
                ]}
              />
            )}
          </ChartCard>
        </Stagger>

        <Stagger delay={0.1}>
          <ChartCard
            title="Revenue by department"
            description="Last 30 days, completed sales"
            empty={!deptHasData}
            height={320}
          >
            <DonutChart
              data={data.departmentComparison.map((d) => ({
                name: d.department === "PHARMACY" ? "Pharmacy" : d.department === "SUPERMARKET" ? "Supermarket" : d.department,
                value: d.revenue,
              }))}
              colors={[SERIES.pharmacy, SERIES.supermarket, SERIES.aux]}
            />
          </ChartCard>
        </Stagger>
      </div>

      {/* Department comparison + inventory composition */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Stagger delay={0.05} className="lg:col-span-2">
          <ChartCard
            title="Pharmacy vs Supermarket"
            description="Last 30 days — switch the metric"
            empty={!deptHasData}
            height={300}
            actions={
              <Segmented
                ariaLabel="Department metric"
                value={deptMetric}
                onChange={setDeptMetric}
                options={[
                  { value: "revenue", label: "Revenue" },
                  { value: "grossProfit", label: "Gross profit" },
                  { value: "units", label: "Units" },
                ]}
              />
            }
          >
            <ComparisonBarChart
              data={data.departmentComparison.map((d) => ({
                name: d.department === "PHARMACY" ? "Pharmacy" : d.department === "SUPERMARKET" ? "Supermarket" : d.department,
                value: deptMetric === "units" ? d.units : d[deptMetric],
              }))}
              bars={[{ key: "value", name: deptMetric === "revenue" ? "Revenue" : deptMetric === "grossProfit" ? "Gross profit" : "Units sold", color: deptMetric === "grossProfit" ? SERIES.profit : SERIES.pharmacy }]}
              money={deptMetric !== "units"}
            />
          </ChartCard>
        </Stagger>

        <Stagger delay={0.1}>
          <ChartCard
            title="Inventory value by category"
            description="At cost, top categories"
            empty={data.inventory.valueByCategory.length === 0}
            height={300}
            overlay={
              <div className="text-center">
                <div className="text-lg font-bold tabular-nums">{shortMoney(data.inventory.totalValue)}</div>
                <div className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">at cost</div>
              </div>
            }
          >
            <DonutChart data={data.inventory.valueByCategory} />
          </ChartCard>
        </Stagger>
      </div>

      {/* Expiry risk + payment mix + shifts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Stagger delay={0.05}>
          <GlassCard className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[0.95rem] font-semibold leading-tight">Expiry risk distribution</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Value at cost by urgency — pharmacy batches</p>
              </div>
              <Hourglass className="h-4 w-4 text-amber-500" />
            </div>
            <div className="mt-5 flex-1 space-y-4">
              {[
                { label: "Already expired", value: data.expiryRisk.expired.value, batches: data.expiryRisk.expired.batches, color: "var(--grad-danger)", text: "text-destructive" },
                { label: "Expiring within 30 days", value: data.expiryRisk.within30.value, batches: data.expiryRisk.within30.batches, color: "var(--grad-warning)", text: "text-amber-600" },
                { label: "31–90 days", value: data.expiryRisk.within90.value, batches: data.expiryRisk.within90.batches, color: "var(--grad-brand)", text: "text-primary" },
              ].map((row) => {
                const max = Math.max(expiryAtRisk, 1);
                return (
                  <div key={row.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className={cn("font-medium", row.text)}>{row.label}</span>
                      <span className="font-semibold tabular-nums">{formatNaira(row.value)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-out-quint)]"
                        style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: row.color }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{row.batches} batch(es)</p>
                  </div>
                );
              })}
              {expiryAtRisk === 0 && (
                <EmptyState icon={BadgePercent} title="No expiry risk" hint="No pharmacy batches expire within the next 90 days." className="border-0" />
              )}
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Supermarket goods are not batch-tracked, so expiry exposure is computed from pharmacy batches only.
              </p>
            </div>
          </GlassCard>
        </Stagger>

        <Stagger delay={0.1}>
          <GlassCard className="flex h-full flex-col p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-[0.95rem] font-semibold leading-tight">Today by department</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Completed sales</p>
              </div>
              <ScanBarcode className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-5 space-y-4">
              {[
                { label: "Pharmacy", value: pharmNum, color: SERIES.pharmacy, icon: Boxes },
                { label: "Supermarket", value: marketNum, color: SERIES.supermarket, icon: ScanBarcode },
              ].map((row) => (
                <div key={row.label}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-1.5 font-medium"><Boxes className="h-3.5 w-3.5" style={{ color: row.color }} /> {row.label}</span>
                    <span className="font-semibold tabular-nums">{formatNaira(row.value)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 [transition-timing-function:var(--ease-out-quint)]"
                      style={{ width: `${Math.min(100, (row.value / Math.max(1, todayTotal)) * 100)}%`, background: row.color }}
                    />
                  </div>
                </div>
              ))}
              {todayTotal === 0 && (
                <p className="py-2 text-center text-sm text-muted-foreground">No completed sales yet today.</p>
              )}
            </div>
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment mix (today)</p>
              {paymentMixEntries.length ? (
                <div className="space-y-1.5">
                  {paymentMixEntries.map(([method, amount]) => (
                    <div key={method} className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{method}</span>
                      <span className="font-medium tabular-nums">{formatNaira(amount)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No payments recorded today.</p>
              )}
            </div>
            <div className="mt-4 border-t pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open shifts</p>
              {data.openShifts.length ? (
                <ul className="space-y-1.5 text-sm">
                  {data.openShifts.map((s) => (
                    <li key={s.id} className="flex items-center justify-between">
                      <span>{s.cashier}</span>
                      <span className="text-xs text-muted-foreground">since {new Date(s.openedAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No shift currently open.</p>
              )}
            </div>
          </GlassCard>
        </Stagger>

        {/* AI insights teaser — animated gradient border, honest CTA */}
        <Stagger delay={0.15}>
          <div className="border-flow glass flex h-full flex-col rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" />
              </span>
              <h3 className="text-[0.95rem] font-semibold leading-tight">AI business insights</h3>
            </div>
            <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
              Daily summaries, weekly performance reviews, stockout and expiry warnings, purchasing recommendations and demand forecasts — generated strictly from your own records, with missing data disclosed.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {["Summary of today's trading", "Demand forecast & reorder suggestion", "Anomalies worth reviewing"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" /> {t}
                </li>
              ))}
            </ul>
            <Button className="mt-5 w-full" onClick={() => setActiveView("insights")}>
              Open AI Insights <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </Stagger>
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-4">
            <h3 className="text-[0.95rem] font-semibold">Recent sales</h3>
            <Badge variant="outline">latest {data.recentSales.length}</Badge>
          </div>
          <CardContent>
            <ScrollArea className="max-h-64">
              <Table>
                <TableHeader>
                  <TableRow><TableHead>Receipt</TableHead><TableHead>Cashier</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentSales.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-mono text-xs">{s.number}</TableCell>
                      <TableCell>{s.cashier}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatNaira(s.total)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn(
                          s.status === "COMPLETED" && "border-[oklch(0.585_0.115_163/0.4)] text-[oklch(0.50_0.11_163)]",
                          s.status === "VOIDED" && "border-destructive/40 text-destructive",
                          (s.status === "REFUNDED" || s.status === "PARTIALLY_REFUNDED") && "border-amber-400/50 text-amber-600",
                        )}>
                          {s.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </GlassCard>

        <GlassCard className="overflow-hidden">
          <div className="px-5 pt-4">
            <h3 className="text-[0.95rem] font-semibold">Recent expenses &amp; unusual activity</h3>
          </div>
          <CardContent>
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {data.recentExpenses.map((e) => (
                  <div key={e.id} className="flex items-center justify-between border-b pb-2 text-sm">
                    <div><div className="font-medium">{e.description}</div><div className="text-xs text-muted-foreground">{e.category} • {new Date(e.date).toLocaleDateString()}</div></div>
                    <div className="font-semibold tabular-nums">{formatNaira(e.amount)}</div>
                  </div>
                ))}
                {data.recentVoids.map((v) => (
                  <div key={v.id} className="flex items-center justify-between border-b pb-2 text-sm">
                    <div><div className="font-medium text-destructive">{v.number} — {v.status.replace("_", " ")}</div><div className="text-xs text-muted-foreground">{v.cashier} • {new Date(v.updatedAt).toLocaleString()}</div></div>
                    <Badge variant="outline" className="border-destructive/40 text-destructive"><Info className="mr-1 h-3 w-3" />review</Badge>
                  </div>
                ))}
                {!data.recentExpenses.length && !data.recentVoids.length && (
                  <p className="py-6 text-center text-sm text-muted-foreground">No recent expenses or unusual transactions.</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </GlassCard>
      </div>

      <div className="flex items-start gap-1.5 text-xs text-muted-foreground/80">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Gross profit = sales − recorded product cost (COGS). It is NOT net profit: rent, salaries, transport and other operating expenses are not yet deducted. See Reports for the expense-adjusted view. All charts use live, permission-filtered records.
      </div>
    </div>
  );
}

function CardContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-5 pb-4 pt-3", className)}>{children}</div>;
}
