"use client";

import { useCallback, useState } from "react";
import { getReports, getInventoryReports, type ReportBundle, type InventoryReportBundle } from "@/server/queries/reports";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Download, Info, BarChart3 } from "lucide-react";
import { formatNaira } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useDataLoader } from "@/hooks/use-data-loader";

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

  const maxDaily = report ? Math.max(...report.series.map((s) => Number(s.total)), 1) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
          <p className="text-sm text-slate-500">All figures from validated database records — no hard-coded numbers.</p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1"><Label>From</Label><Input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></div>
          <div className="space-y-1"><Label>To</Label><Input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></div>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={exportSales} disabled={!report}><Download className="h-4 w-4 mr-1" /> CSV</Button>
        </div>
      </div>

      <Tabs defaultValue="financial">
        <TabsList>
          <TabsTrigger value="financial">Financial</TabsTrigger>
          <TabsTrigger value="products">Products & cashiers</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>

        <TabsContent value="financial" className="mt-4 space-y-4">
          {report && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Sales revenue</p><p className="text-xl font-bold">{formatNaira(report.sales.total)}</p><p className="text-xs text-slate-400">{report.sales.count} sale(s)</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Gross profit (est.)</p><p className="text-xl font-bold text-teal-700">{formatNaira(report.grossProfit)}</p><p className="text-xs text-slate-400">COGS {formatNaira(report.cogs)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Operating expenses</p><p className="text-xl font-bold">{formatNaira(report.expenses)}</p><p className="text-xs text-slate-400">approved only</p></CardContent></Card>
                <Card className="border-teal-200 bg-teal-50/50"><CardContent className="p-4"><p className="text-xs text-slate-500">Net before tax (GP − expenses)</p><p className={cn("text-xl font-bold", String(report.netBeforeTax).startsWith("-") ? "text-red-600" : "text-teal-800")}>{formatNaira(report.netBeforeTax)}</p></CardContent></Card>
              </div>

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>What this report includes</AlertTitle>
                <AlertDescription>
                  Revenue = completed sales in the period. Gross profit = revenue − recorded product cost (COGS) − refunds. It EXCLUDES operating expenses, taxes and supplier liabilities. Net-before-tax simply subtracts recorded approved expenses from gross profit — this is not a statutory profit figure.
                </AlertDescription>
              </Alert>

              <Card>
                <CardHeader><CardTitle className="text-base">Daily sales</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-end gap-0.5 h-28">
                    {report.series.map((s) => (
                      <div key={s.day} className="flex-1 group relative" title={`${s.day}: ₦${Number(s.total).toLocaleString()} (${s.count} sales)`}>
                        <div className="w-full rounded-t bg-teal-500/80 group-hover:bg-teal-600" style={{ height: `${Math.max(2, (Number(s.total) / maxDaily) * 100)}px` }} />
                      </div>
                    ))}
                    {!report.series.length && <p className="text-sm text-slate-400 py-6 mx-auto">No sales in this period.</p>}
                  </div>
                </CardContent>
              </Card>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">By department</CardTitle></CardHeader>
                  <CardContent>
                    {report.byDept.map((d) => (
                      <div key={d.department} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                        <span>{d.department}</span><span className="font-semibold">{String(d.revenue)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Payment methods</CardTitle></CardHeader>
                  <CardContent>
                    {Object.entries(report.paymentMix).map(([m, v]) => (
                      <div key={m} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                        <span>{m}</span><span className="font-semibold">{String(v)}</span>
                      </div>
                    ))}
                    {!Object.keys(report.paymentMix).length && <p className="text-sm text-slate-400">No payments in period.</p>}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">By cashier</CardTitle></CardHeader>
                  <CardContent>
                    {report.byCashier.map((c) => (
                      <div key={c.name} className="flex justify-between py-1.5 border-b last:border-0 text-sm">
                        <span>{c.name} <span className="text-xs text-slate-400">({c.count})</span></span><span className="font-semibold">{String(c.total)}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">Refunds & voids</CardTitle></CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <div className="flex justify-between"><span>Refunds</span><span className="font-semibold text-amber-700">{String(report.refunds.total)} ({report.refunds.count})</span></div>
                    <div className="flex justify-between"><span>Voids</span><span className="font-semibold text-red-600">{String(report.voids.total)} ({report.voids.count})</span></div>
                    <div className="flex justify-between"><span>Discounts given</span><span className="font-semibold">{String(report.sales.discounts)}</span></div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          {report && (
            <Card>
              <CardHeader><CardTitle className="text-base">Product performance (period)</CardTitle><CardDescription>Top 20 by revenue — gross profit is per-product revenue − COGS</CardDescription></CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[55vh]">
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty sold</TableHead><TableHead className="text-right">Revenue</TableHead><TableHead className="text-right">COGS</TableHead><TableHead className="text-right">Gross profit</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {report.topProducts.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right">{Number(p.qty).toLocaleString()}</TableCell>
                          <TableCell className="text-right">{String(p.revenue)}</TableCell>
                          <TableCell className="text-right text-slate-500">{String(p.cogs)}</TableCell>
                          <TableCell className="text-right font-semibold text-teal-700">{String(p.profit)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="inventory" className="mt-4 space-y-4">
          {invReport && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Stock value at cost</p><p className="text-xl font-bold">{formatNaira(invReport.valuation.total)}</p><p className="text-xs text-slate-400">{invReport.valuation.productCount} products in stock</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Expiring ≤90d exposure</p><p className="text-xl font-bold text-amber-600">{formatNaira(invReport.expiringValue)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Expired value</p><p className="text-xl font-bold text-red-600">{formatNaira(invReport.expiredValue)}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Low-stock products</p><p className="text-xl font-bold">{invReport.lowStock.length}</p></CardContent></Card>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Batches requiring review</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-72">
                      <Table>
                        <TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {invReport.batches.map((b, i) => (
                            <TableRow key={i} className={b.status === "EXPIRED" ? "bg-red-50/50" : b.daysLeft <= 90 ? "bg-amber-50/40" : ""}>
                              <TableCell className="text-xs">{b.productName}<div className="font-mono text-slate-400">{b.batchNumber}</div></TableCell>
                              <TableCell className="text-xs">{new Date(b.expiryDate).toLocaleDateString()}<div className={b.status === "EXPIRED" ? "text-red-500" : "text-amber-500"}>{b.status === "EXPIRED" ? "EXPIRED" : `${b.daysLeft}d`}</div></TableCell>
                              <TableCell className="text-right">{Number(b.quantityRemaining)} {b.baseUnit}</TableCell>
                              <TableCell className="text-right font-medium">{String(b.valueAtCost)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Fast movers (30d) & never sold</CardTitle></CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="max-h-72">
                      <Table>
                        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Qty (30d)</TableHead><TableHead className="text-right">Revenue</TableHead></TableRow></TableHeader>
                        <TableBody>
                          {invReport.fastMovers.map((f) => (
                            <TableRow key={f.name}><TableCell className="text-xs font-medium">{f.name}</TableCell><TableCell className="text-right">{Number(f.qty).toLocaleString()}</TableCell><TableCell className="text-right">{String(f.revenue)}</TableCell></TableRow>
                          ))}
                          {invReport.neverSold.map((p) => (
                            <TableRow key={p.name} className="bg-slate-50"><TableCell className="text-xs font-medium">{p.name} <Badge variant="outline" className="text-[9px]">no sales</Badge></TableCell><TableCell className="text-right text-slate-400">0</TableCell><TableCell /></TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              {invReport.adjustments.length > 0 && (
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-base">Recent stock adjustments (30d)</CardTitle></CardHeader>
                  <CardContent>
                    <div className="space-y-1 text-sm">
                      {invReport.adjustments.map((a, i) => (
                        <div key={i} className="flex justify-between border-b last:border-0 pb-1">
                          <span>{a.productName} — <Badge variant="outline" className="text-[10px]">{a.type}</Badge> {Number(a.quantity)}</span>
                          <span className="text-xs text-slate-500 max-w-64 truncate">{a.reason}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
