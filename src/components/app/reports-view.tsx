"use client";

import { useCallback, useState } from "react";
import { getReports, getInventoryReports, type ReportBundle, type InventoryReportBundle } from "@/server/queries/reports";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Download, Info, Boxes, Hourglass, ShieldAlert, PackageX, ClipboardList } from "lucide-react";
import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, Stagger, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";
import { KpiCard } from "./ui/kpi-card";
import { ChartCard, RevenueAreaChart, ComparisonBarChart, DonutChart, SERIES } from "./ui/chart-kit";

function defaultPeriod() {
  const to = new Date();
  const from = new Date(Date.now() - 29 * 864e5);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
}

function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  const csv = toCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* Decimal-serialized server values → JS numbers for charting (never for display math). */
const num = (v: unknown): number => Number(String(v ?? 0));

const prettyDept = (d: string) => (d === "PHARMACY" ? "Pharmacy" : d === "SUPERMARKET" ? "Supermarket" : d);
const deptColor = (name: string) => (name === "Pharmacy" ? SERIES.pharmacy : name === "Supermarket" ? SERIES.supermarket : SERIES.aux);

/* Axis-safe display label — full product names remain in the tables beside each chart. */
const shortLabel = (s: string) => (s.length > 13 ? `${s.slice(0, 12)}…` : s);

const POSITIVE_TEXT = "text-[oklch(0.50_0.11_163)]";

export function ReportsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [period, setPeriod] = useState(defaultPeriod);
  const [report, setReport] = useState<ReportBundle | null>(null);
  const [invReport, setInvReport] = useState<InventoryReportBundle | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, ir] = await Promise.all([
        getReports(businessId, { from: period.from, to: period.to }) as unknown as Promise<ReportBundle>,
        getInventoryReports(businessId) as unknown as Promise<InventoryReportBundle>,
      ]);
      setReport(r);
      setInvReport(ir);
    } catch (err) {
      toast({ title: "Report failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [businessId, period, toast]);

  useDataLoader(load, [load]);

  function exportSales() {
    if (!report) return;
    downloadCsv(`synkisell-sales-${period.from}-to-${period.to}.csv`, [
      { metric: "Total sales", value: report.sales.total },
      { metric: "Sales count", value: report.sales.count },
      { metric: "Discounts", value: report.sales.discounts },
      { metric: "Tax", value: report.sales.tax },
      { metric: "Refunds", value: report.refunds.total },
      { metric: "Voids", value: report.voids.total },
      { metric: "COGS", value: report.cogs },
      { metric: "Gross profit", value: report.grossProfit },
      { metric: "Operating expenses (approved)", value: report.expenses },
      { metric: "Net before tax (GP − expenses)", value: report.netBeforeTax },
    ]);
    toast({ title: "Exported CSV", description: "Permission-protected export (audit applies on server)" });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="All figures from validated database records — no hard-coded numbers."
        actions={
          <div className="no-print flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="period-from">From</Label>
              <Input id="period-from" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="period-to">To</Label>
              <Input id="period-to" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
            </div>
            <Button onClick={exportSales} disabled={!report}><Download className="h-4 w-4 mr-1" /> CSV</Button>
          </div>
        }
      />

      <Tabs defaultValue="financial">
        <TabsList>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="products">Products &amp; cashiers</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="financial" className="mt-4 space-y-4">
          {report ? (
            <>
              {/* Totals row — exact, un-rounded figures (formatNaira), tone-coloured by semantics */}
              <FadeIn>
                <GlassCard className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-[0.95rem] font-semibold leading-tight">Period totals</h3>
                    <Badge variant="outline" className="tabular-nums">{report.period.from} → {report.period.to}</Badge>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4 xl:grid-cols-7">
                    {[
                      { label: "Sales revenue", value: formatNaira(report.sales.total), sub: `${report.sales.count} sale(s)`, cls: "" },
                      { label: "Refunds", value: formatNaira(report.refunds.total), sub: `${report.refunds.count} refund(s)`, cls: "text-amber-600" },
                      { label: "Voids", value: formatNaira(report.voids.total), sub: `${report.voids.count} void(s)`, cls: "text-destructive" },
                      { label: "COGS", value: formatNaira(report.cogs), sub: "recorded product cost", cls: "" },
                      { label: "Gross profit (est.)", value: formatNaira(report.grossProfit), sub: undefined as string | undefined, cls: POSITIVE_TEXT },
                      { label: "Operating expenses", value: formatNaira(report.expenses), sub: "approved only", cls: "" },
                      {
                        label: "Net before tax",
                        value: formatNaira(report.netBeforeTax),
                        sub: "GP − expenses",
                        cls: String(report.netBeforeTax).startsWith("-") ? "text-destructive" : POSITIVE_TEXT,
                      },
                    ].map((t) => (
                      <div key={t.label}>
                        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t.label}</dt>
                        <dd className={cn("mt-1 text-sm font-semibold tabular-nums", t.cls)}>{t.value}</dd>
                        {t.sub ? <dd className="mt-0.5 text-xs text-muted-foreground">{t.sub}</dd> : null}
                      </div>
                    ))}
                  </dl>
                </GlassCard>
              </FadeIn>

              <Alert className="glass">
                <Info className="h-4 w-4" />
                <AlertTitle>What this report includes</AlertTitle>
                <AlertDescription>
                  Revenue = completed sales in the period. Gross profit = revenue − recorded product cost (COGS) − refunds. It EXCLUDES operating expenses, taxes and supplier liabilities. Net-before-tax simply subtracts recorded approved expenses from gross profit — this is not a statutory profit figure.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 lg:grid-cols-3">
                <Stagger className="lg:col-span-2" delay={0.05}>
                  <ChartCard
                    title="Daily sales"
                    description={`Completed sales per day — ${report.period.from} → ${report.period.to}`}
                    empty={!report.series.length}
                    emptyHint="No sales in this period."
                    height={300}
                  >
                    <RevenueAreaChart
                      data={report.series.map((s) => ({ label: s.day.slice(5), revenue: Number(s.total) }))}
                      series={[{ key: "revenue", name: "Daily sales", color: SERIES.pharmacy }]}
                    />
                  </ChartCard>
                </Stagger>
                <Stagger delay={0.1}>
                  <ChartCard
                    title="Payment methods"
                    description="Tender mix for the period"
                    empty={!Object.keys(report.paymentMix).length}
                    emptyHint="No payments in period."
                    height={300}
                  >
                    <DonutChart data={Object.entries(report.paymentMix).map(([m, v]) => ({ name: m, value: num(v) }))} />
                  </ChartCard>
                </Stagger>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Stagger className="lg:col-span-2" delay={0.05}>
                  <ChartCard
                    title="By department"
                    description="Revenue by department, completed sales"
                    empty={!report.byDept.length}
                    height={280}
                  >
                    <ComparisonBarChart
                      data={report.byDept.map((d) => ({ name: prettyDept(d.department), revenue: num(d.revenue) }))}
                      bars={[{ key: "revenue", name: "Revenue" }]}
                      colorMap={(entry) => deptColor(String(entry.name))}
                    />
                  </ChartCard>
                </Stagger>
                <Stagger delay={0.1}>
                  <GlassCard className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-[0.95rem] font-semibold leading-tight">Refunds &amp; voids</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Exception totals for the period</p>
                      </div>
                    </div>
                    <div className="mt-4 flex-1 space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3 border-b pb-2.5">
                        <span className="text-muted-foreground">Refunds</span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums text-amber-600">{formatNaira(report.refunds.total)}</span>
                          <span className="block text-xs text-muted-foreground">{report.refunds.count} refund(s)</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 border-b pb-2.5">
                        <span className="text-muted-foreground">Voids</span>
                        <span className="text-right">
                          <span className="block font-semibold tabular-nums text-destructive">{formatNaira(report.voids.total)}</span>
                          <span className="block text-xs text-muted-foreground">{report.voids.count} void(s)</span>
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground">Discounts given</span>
                        <span className="font-semibold tabular-nums">{formatNaira(report.sales.discounts)}</span>
                      </div>
                    </div>
                  </GlassCard>
                </Stagger>
              </div>

              <FadeIn>
                <GlassCard className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                    <h3 className="text-[0.95rem] font-semibold leading-tight">By cashier</h3>
                    <Badge variant="outline">{report.byCashier.length} cashier(s)</Badge>
                  </div>
                  <div className="px-5 pb-4 pt-3">
                    {report.byCashier.length ? (
                      <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
                        {report.byCashier.map((c) => (
                          <div key={c.name} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
                            <span className="min-w-0 truncate">{c.name} <span className="text-xs text-muted-foreground">({c.count})</span></span>
                            <span className="font-semibold tabular-nums">{formatNaira(c.total)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No cashier sales in this period" className="border-0" />
                    )}
                  </div>
                </GlassCard>
              </FadeIn>
            </>
          ) : loading ? (
            <InlineLoading label="Loading reports" className="py-16" />
          ) : (
            <EmptyState title="No report loaded" hint="Pick a period above — figures load from your validated records." className="border-0" />
          )}
        </TabsContent>

        <TabsContent value="products" className="mt-4 space-y-4">
          {report ? (
            <>
              <FadeIn>
                <ChartCard
                  title="Top products by revenue"
                  description="Top 8 of the period — axis labels abbreviated, full detail in the table below"
                  empty={!report.topProducts.length}
                  height={280}
                >
                  <ComparisonBarChart
                    data={report.topProducts.slice(0, 8).map((p) => ({ name: p.name, short: shortLabel(p.name), revenue: num(p.revenue) }))}
                    bars={[{ key: "revenue", name: "Revenue" }]}
                    xKey="short"
                  />
                </ChartCard>
              </FadeIn>

              <FadeIn>
                <GlassCard className="overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                    <div>
                      <h3 className="text-[0.95rem] font-semibold leading-tight">Product performance (period)</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">Top 20 by revenue — gross profit is per-product revenue − COGS</p>
                    </div>
                    <Badge variant="outline">{report.topProducts.length} product(s)</Badge>
                  </div>
                  <div className="px-2 pb-4 pt-2 sm:px-4">
                    <ScrollArea className="max-h-[55vh]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Product</TableHead>
                            <TableHead className="text-right">Qty sold</TableHead>
                            <TableHead className="text-right">Revenue</TableHead>
                            <TableHead className="text-right">COGS</TableHead>
                            <TableHead className="text-right">Gross profit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {report.topProducts.length ? (
                            report.topProducts.map((p) => (
                              <TableRow key={p.name}>
                                <TableCell className="font-medium">{p.name}</TableCell>
                                <TableCell className="text-right tabular-nums">{Number(p.qty).toLocaleString()}</TableCell>
                                <TableCell className="text-right tabular-nums">{formatNaira(p.revenue)}</TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">{formatNaira(p.cogs)}</TableCell>
                                <TableCell className={cn("text-right font-semibold tabular-nums", POSITIVE_TEXT)}>{formatNaira(p.profit)}</TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow>
                              <TableCell colSpan={5}>
                                <EmptyState title="No product sales in this period" hint="Once sales are recorded in the selected window, the leaders appear here." className="border-0" />
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                </GlassCard>
              </FadeIn>
            </>
          ) : loading ? (
            <InlineLoading label="Loading reports" className="py-16" />
          ) : (
            <EmptyState title="No report loaded" hint="Pick a period above — figures load from your validated records." className="border-0" />
          )}
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 space-y-4">
          {invReport ? (
            <>
              <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <KpiCard
                  title="Stock value at cost"
                  value={num(invReport.valuation.total)}
                  icon={Boxes}
                  sub={`${invReport.valuation.productCount} products in stock`}
                />
                <KpiCard title="Expiring ≤90d exposure" value={num(invReport.expiringValue)} tone="warning" icon={Hourglass} />
                <KpiCard title="Expired value" value={num(invReport.expiredValue)} tone="danger" icon={ShieldAlert} />
                <KpiCard
                  title="Low-stock products"
                  value={invReport.lowStock.length}
                  format="number"
                  tone={invReport.lowStock.length > 0 ? "warning" : "positive"}
                  icon={PackageX}
                />
              </Stagger>

              <div className="grid gap-4 lg:grid-cols-2">
                <Stagger delay={0.05}>
                  <GlassCard className="flex h-full flex-col overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                      <div>
                        <h3 className="text-[0.95rem] font-semibold leading-tight">Batches requiring review</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Pharmacy batches expiring within 90 days, or already expired</p>
                      </div>
                      <Badge variant="outline">{invReport.batches.length}</Badge>
                    </div>
                    <div className="px-2 pb-4 pt-2 sm:px-4">
                      {invReport.batches.length ? (
                        <ScrollArea className="max-h-72">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Batch</TableHead>
                                <TableHead>Expiry</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Value</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {invReport.batches.map((b, i) => (
                                <TableRow key={i} className={b.status === "EXPIRED" ? "bg-red-50/50" : b.daysLeft <= 90 ? "bg-amber-50/40" : ""}>
                                  <TableCell className="text-xs">
                                    {b.productName}
                                    <div className="font-mono text-xs text-muted-foreground">{b.batchNumber}</div>
                                  </TableCell>
                                  <TableCell className="text-xs">
                                    {new Date(b.expiryDate).toLocaleDateString()}
                                    <div
                                      className={cn("font-medium", b.status === "EXPIRED" ? "text-destructive" : "text-amber-600")}
                                      aria-label={b.status === "EXPIRED" ? "Expired" : `${b.daysLeft} days left`}
                                    >
                                      {b.status === "EXPIRED" ? "EXPIRED" : `${b.daysLeft}d left`}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{Number(b.quantityRemaining)} {b.baseUnit}</TableCell>
                                  <TableCell className="text-right font-medium tabular-nums">{formatNaira(b.valueAtCost)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      ) : (
                        <EmptyState title="No batches need review" hint="No pharmacy batches expire within the next 90 days." className="mx-2 my-4" />
                      )}
                    </div>
                  </GlassCard>
                </Stagger>

                <Stagger delay={0.1}>
                  <GlassCard className="flex h-full flex-col overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                      <div>
                        <h3 className="text-[0.95rem] font-semibold leading-tight">Never sold (30d)</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Active products with no recorded sale in the last 30 days</p>
                      </div>
                      <Badge variant="outline">{invReport.neverSold.length}</Badge>
                    </div>
                    <div className="px-2 pb-4 pt-2 sm:px-4">
                      {invReport.neverSold.length ? (
                        <ScrollArea className="max-h-72">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead>Unit</TableHead>
                                <TableHead className="text-right">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {invReport.neverSold.map((p) => (
                                <TableRow key={p.name}>
                                  <TableCell className="text-xs font-medium">{p.name}</TableCell>
                                  <TableCell className="text-xs text-muted-foreground">{p.baseUnit}</TableCell>
                                  <TableCell className="text-right"><Badge variant="outline" className="text-[9px]">no sales</Badge></TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      ) : (
                        <EmptyState
                          icon={PackageX}
                          title="Nothing idle"
                          hint="Every active product recorded at least one sale in the last 30 days."
                          className="mx-2 my-4"
                        />
                      )}
                    </div>
                  </GlassCard>
                </Stagger>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Stagger className="lg:col-span-2" delay={0.05}>
                  <ChartCard
                    title="Fast movers (30d)"
                    description="Top 10 products by revenue, last 30 days — axis labels abbreviated"
                    empty={!invReport.fastMovers.length}
                    height={300}
                  >
                    <ComparisonBarChart
                      data={invReport.fastMovers.map((f) => ({ name: f.name, short: shortLabel(f.name), revenue: num(f.revenue) }))}
                      bars={[{ key: "revenue", name: "Revenue" }]}
                      xKey="short"
                    />
                  </ChartCard>
                </Stagger>
                <Stagger delay={0.1}>
                  <GlassCard className="flex h-full flex-col p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-[0.95rem] font-semibold leading-tight">Recent stock adjustments (30d)</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">Latest entries, newest first</p>
                      </div>
                      <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-4 flex-1 space-y-2.5 text-sm">
                      {invReport.adjustments.length ? (
                        invReport.adjustments.map((a, i) => (
                          <div key={i} className="flex items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0">
                            <span className="min-w-0">
                              {a.productName} — <Badge variant="outline" className="text-[10px]">{a.type}</Badge>{" "}
                              <span className="tabular-nums">{Number(a.quantity)}</span>
                            </span>
                            <span className="max-w-36 truncate text-xs text-muted-foreground" title={a.reason}>{a.reason}</span>
                          </div>
                        ))
                      ) : (
                        <EmptyState icon={ClipboardList} title="No stock adjustments" hint="No adjustments recorded in the last 30 days." className="border-0" />
                      )}
                    </div>
                  </GlassCard>
                </Stagger>
              </div>
            </>
          ) : loading ? (
            <InlineLoading label="Loading inventory report" className="py-16" />
          ) : (
            <EmptyState title="No inventory report loaded" hint="Figures load from your validated records — try again in a moment." className="border-0" />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
