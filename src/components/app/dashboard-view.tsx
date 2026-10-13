"use client";

import { useState } from "react";
import { getDashboard, type DashboardData } from "@/server/queries/dashboard";
import { formatNaira, formatQty } from "@/lib/money";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/store/app-store";
import { useDataLoader } from "@/hooks/use-data-loader";
import {
  TrendingUp, TrendingDown, Wallet, Boxes, CalendarClock, TriangleAlert,
  PiggyBank, Truck, ShieldAlert, ScanBarcode, Sparkles, Info,
} from "lucide-react";
import Link from "next/link";

function StatCard({ title, value, sub, icon: Icon, tone = "default" }: {
  title: string; value: string; sub?: string; icon: React.ComponentType<{ className?: string }>; tone?: "default" | "positive" | "negative" | "brand";
}) {
  return (
    <Card className={cn(
      tone === "brand" && "border-teal-200 bg-teal-50/60",
      tone === "positive" && "border-emerald-200 bg-emerald-50/60",
      tone === "negative" && "border-red-200 bg-red-50/60",
    )}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-500">{title}</p>
          <Icon className="h-4 w-4 text-slate-400" />
        </div>
        <p className="mt-1.5 text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}

import { cn } from "@/lib/utils";

export function DashboardView({ businessId }: { businessId: string }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refreshTrigger = useAppStore((s) => s.refreshTrigger);

  useDataLoader(async () => {
    setError(null);
    try {
      const d = await getDashboard(businessId);
      setData(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    }
  }, [businessId, refreshTrigger], 60_000);

  if (error) {
    return <Alert variant="destructive"><TriangleAlert className="h-4 w-4" /><AlertTitle>Could not load dashboard</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>;
  }

  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
      </div>
    );
  }

  const growth = data.growthPct;
  const pharmacy = formatNaira(data.departments.find((d) => d.department === "PHARMACY")?.total ?? 0);
  const supermarket = formatNaira(data.departments.find((d) => d.department === "SUPERMARKET")?.total ?? 0);
  const pharmNum = Number(String(data.departments.find((d) => d.department === "PHARMACY")?.total ?? 0));
  const marketNum = Number(String(data.departments.find((d) => d.department === "SUPERMARKET")?.total ?? 0));
  const subStatus = data.subscription?.status ?? "—";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-slate-500">
            Live figures from your records • refreshed {new Date(data.generatedAt).toLocaleTimeString()}
          </p>
        </div>
        {data.subscription && (
          <Badge variant={subStatus === "ACTIVE" ? "outline" : "destructive"} className={subStatus === "ACTIVE" ? "border-teal-200 bg-teal-50 text-teal-700" : ""}>
            <CalendarClock className="h-3 w-3 mr-1" />
            {subStatus} {data.subscription.endDate ? `• renews ${new Date(data.subscription.endDate).toLocaleDateString()}` : ""}
          </Badge>
        )}
      </div>

      {/* Top stats */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Today's sales"
          value={formatNaira(data.today.sales)}
          sub={`${data.today.count} sale(s) ${growth !== null ? `• ${Number(growth) >= 0 ? "+" : ""}${growth}% vs yesterday` : ""}`}
          icon={TrendingUp}
          tone="brand"
        />
        <StatCard
          title="Estimated gross profit (today)"
          value={formatNaira(data.today.grossProfit)}
          sub="revenue − product cost. NOT net profit — operating expenses excluded."
          icon={PiggyBank}
        />
        <StatCard
          title="This week's sales"
          value={formatNaira(data.week.sales)}
          sub={`prev. week ${formatNaira(data.week.prevSales)} • GP ${formatNaira(data.week.grossProfit)}`}
          icon={Wallet}
        />
        <StatCard
          title="Outstanding supplier balance"
          value={formatNaira(data.supplierBalance)}
          sub="payables from credit purchases"
          icon={Truck}
        />
      </div>

      {/* Alerts */}
      <div className="grid gap-4 md:grid-cols-2">
        {data.expiringBatches.length > 0 && (
          <Alert className="border-amber-300 bg-amber-50">
            <TriangleAlert className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">Expiry review needed</AlertTitle>
            <AlertDescription className="text-amber-700">
              {data.expiringBatches.length} medicine batch(es) expiring within 90 days — {formatNaira(data.expiringValue)} at cost at risk. Check Inventory → Expiry watch.
            </AlertDescription>
          </Alert>
        )}
        {data.lowStock.length > 0 && (
          <Alert className="border-red-200 bg-red-50">
            <ShieldAlert className="h-4 w-4 text-red-600" />
            <AlertTitle className="text-red-800">Out of stock ({data.lowStock.length})</AlertTitle>
            <AlertDescription className="text-red-700">
              {data.lowStock.slice(0, 4).map((p) => p.name).join(", ")}
              {data.lowStock.length > 4 ? ` +${data.lowStock.length - 4} more` : ""} — reorder now.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Sparkline */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Sales — last 14 days</CardTitle>
            <CardDescription>Completed sales per day</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-36">
              {data.sparkline.map((s) => {
                const max = Math.max(...data.sparkline.map((x) => x.total), 1);
                return (
                  <div key={s.day} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="text-[10px] text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      {formatNaira(s.total)}
                    </div>
                    <div
                      className="w-full rounded-t bg-teal-500/80 group-hover:bg-teal-600 transition-colors"
                      style={{ height: `${Math.max(2, (s.total / max) * 100)}%` }}
                    />
                    <div className="text-[9px] text-slate-400">{s.day.slice(8)}</div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Department split + payment mix */}
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Today by department</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="flex items-center gap-1.5"><Boxes className="h-3.5 w-3.5 text-teal-600" /> Pharmacy</span><span className="font-semibold">{pharmacy}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-600" style={{ width: `${Math.min(100, (pharmNum / Math.max(1, pharmNum + marketNum)) * 100)}%` }} /></div>
              </div>
              <div>
                <div className="flex justify-between text-sm mb-1"><span className="flex items-center gap-1.5"><ScanBarcode className="h-3.5 w-3.5 text-slate-500" /> Supermarket</span><span className="font-semibold">{supermarket}</span></div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-500" style={{ width: `${Math.min(100, (marketNum / Math.max(1, pharmNum + marketNum)) * 100)}%` }} /></div>
              </div>
              <div className="pt-2 border-t text-xs text-slate-500 space-y-1">
                {Object.entries(data.paymentMix).map(([method, amount]) => (
                  <div key={method} className="flex justify-between"><span>{method}</span><span className="font-medium text-slate-700">{formatNaira(amount)}</span></div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Shift status</CardTitle></CardHeader>
            <CardContent>
              {data.openShifts.length ? (
                <ul className="space-y-1.5 text-sm">
                  {data.openShifts.map((s) => (
                    <li key={s.id} className="flex items-center justify-between">
                      <span>{s.cashier}</span>
                      <span className="text-xs text-slate-500">since {new Date(s.openedAt).toLocaleTimeString()}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No shift currently open.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tables */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent sales</CardTitle>
            <Badge variant="outline">latest {data.recentSales.length}</Badge>
          </CardHeader>
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
                      <TableCell className="text-right font-medium">{formatNaira(s.total)}</TableCell>
                      <TableCell><Badge variant="outline" className={cn(s.status === "COMPLETED" && "border-emerald-200 text-emerald-700", s.status === "VOIDED" && "border-red-200 text-red-600", (s.status === "REFUNDED" || s.status === "PARTIALLY_REFUNDED") && "border-amber-200 text-amber-700")}>{s.status.replace("_", " ")}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Recent expenses & unusual activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-64">
              <div className="space-y-2">
                {data.recentExpenses.map((e) => (
                  <div key={e.id} className="flex items-center justify-between text-sm border-b pb-2">
                    <div><div className="font-medium">{e.description}</div><div className="text-xs text-slate-500">{e.category} • {new Date(e.date).toLocaleDateString()}</div></div>
                    <div className="font-semibold">{formatNaira(e.amount)}</div>
                  </div>
                ))}
                {data.recentVoids.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm border-b pb-2">
                    <div><div className="font-medium text-red-700">{v.number} — {v.status.replace("_", " ")}</div><div className="text-xs text-slate-500">{v.cashier} • {new Date(v.updatedAt).toLocaleString()}</div></div>
                    <Badge variant="outline" className="border-red-200 text-red-600"><Info className="h-3 w-3 mr-1" />review</Badge>
                  </div>
                ))}
                {!data.recentExpenses.length && !data.recentVoids.length && (
                  <p className="text-sm text-slate-500 py-6 text-center">No recent expenses or unusual transactions.</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-slate-400 flex items-start gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        Gross profit = sales − recorded product cost (COGS). It is NOT net profit: rent, salaries, transport and other operating expenses are not yet deducted. See Reports for the expense-adjusted view.
      </div>
    </div>
  );
}
