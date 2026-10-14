"use client";

import { useCallback, useState } from "react";
import { listStockBalances, listBatches, createStockAdjustment, setBatchStatus, listStockMovements } from "@/server/actions/inventory-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { formatNaira, formatQty } from "@/lib/money";
import { cn } from "@/lib/utils";
import { TriangleAlert, CalendarClock, ArrowDownUp, ShieldBan, PackageSearch, History, Search } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { PageHeader, GlassCard, EmptyState, Stagger, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";

type BalanceRow = {
  id: string; name: string; sku: string; department: string; type: string; baseUnit: string;
  reorderLevel: { toString(): string }; costPrice: { toString(): string }; sellingPrice: { toString(): string };
  quantity: { toString(): string }; isLow: boolean; value: { toString(): string }; categoryName: string | null;
};
type BatchRow = {
  id: string; productId: string; batchNumber: string; expiryDate: string; status: string;
  quantityRemaining: { toString(): string }; quantityReceived: { toString(): string }; unitCost: { toString(): string };
  product: { name: string; sku: string; baseUnit: string }; supplier: { name: string } | null;
};
type MovementRow = {
  id: string; type: string; quantity: { toString(): string }; reason: string | null; createdAt: string;
  product: { name: string; baseUnit: string }; batch: { batchNumber: string } | null; user: { name: string } | null;
};

export function InventoryView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [batchFilter, setBatchFilter] = useState<"ALL" | "EXPIRING" | "EXPIRED">("ALL");
  const [search, setSearch] = useState("");
  const [adjustTarget, setAdjustTarget] = useState<BalanceRow | null>(null);
  const [adjustForm, setAdjustForm] = useState({ direction: "OUT", quantity: "", reason: "", batchId: "" });
  const [saving, setSaving] = useState(false);
  const [batchesForProduct, setBatchesForProduct] = useState<BatchRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, bt, mv] = await Promise.all([
        listStockBalances(businessId, search || undefined) as unknown as Promise<BalanceRow[]>,
        listBatches(businessId, batchFilter === "ALL" ? undefined : batchFilter) as unknown as Promise<BatchRow[]>,
        listStockMovements(businessId, undefined, 60) as unknown as Promise<MovementRow[]>,
      ]);
      setBalances(b);
      setBatches(bt);
      setMovements(mv);
    } catch (err) {
      toast({ title: "Could not load inventory", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [businessId, search, batchFilter, toast]);

  useDataLoader(load, [load]);

  async function openAdjust(b: BalanceRow) {
    setAdjustTarget(b);
    setAdjustForm({ direction: "OUT", quantity: "", reason: "", batchId: "" });
    if (b.type === "MEDICINE") {
      try {
        const bt = (await listBatches(businessId)) as unknown as BatchRow[];
        setBatchesForProduct(bt.filter((x) => x.productId === b.id && x.status === "ACTIVE" && Number(x.quantityRemaining) > 0));
      } catch { setBatchesForProduct([]); }
    }
  }

  async function handleAdjust() {
    if (!adjustTarget) return;
    setSaving(true);
    try {
      await createStockAdjustment({
        businessId,
        productId: adjustTarget.id,
        batchId: adjustForm.batchId || null,
        direction: adjustForm.direction as "IN" | "OUT" | "DAMAGE",
        quantity: Number(adjustForm.quantity),
        reason: adjustForm.reason,
      });
      toast({ title: "Stock adjusted", description: `${adjustTarget.name}: ${adjustForm.direction} ${adjustForm.quantity}` });
      setAdjustTarget(null);
      void load();
    } catch (err) {
      toast({ title: "Adjustment failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function quarantine(b: BatchRow) {
    try {
      await setBatchStatus(businessId, b.id, b.status === "QUARANTINED" ? "ACTIVE" : "QUARANTINED");
      toast({ title: b.status === "QUARANTINED" ? "Batch restored" : "Batch quarantined", description: `${b.product.name} — ${b.batchNumber}` });
      void load();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  const totalValue = balances.reduce((a, b) => a + Number(b.value), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Inventory"
        subtitle={
          <>
            Stock value at cost: <strong className="tabular-nums">{formatNaira(totalValue)}</strong> • every change is an audited ledger movement
          </>
        }
      />

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Stock balances</TabsTrigger>
          <TabsTrigger value="batches" className="relative">Batches &amp; expiry <CalendarClock className="ml-1 h-3.5 w-3.5" /></TabsTrigger>
          <TabsTrigger value="movements">Movement ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-4">
          <Stagger className="space-y-3">
            <div className="relative max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-[0.95rem] font-semibold">Stock balances</h3>
                <Badge variant="outline" className="tabular-nums">{loading ? "…" : balances.length}</Badge>
              </div>
              <div className="px-5 pb-4 pt-3">
                <ScrollArea className="max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Product</TableHead><TableHead>Dept</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Reorder at</TableHead><TableHead className="text-right">Value</TableHead><TableHead /><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow><TableCell colSpan={7}><InlineLoading label="Loading stock balances" /></TableCell></TableRow>
                      ) : balances.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <EmptyState
                              icon={PackageSearch}
                              title={search ? "No products match this search" : "No stock records yet"}
                              hint={search ? "Try a different product name or SKU." : "Balances appear here once stock is received via purchases or adjustments."}
                              className="border-0"
                            />
                          </TableCell>
                        </TableRow>
                      ) : balances.map((b) => (
                        <TableRow key={b.id} className={b.isLow ? "bg-red-50/50" : ""}>
                          <TableCell>
                            <div className="font-medium">{b.name}</div>
                            <div className="text-xs text-muted-foreground">{b.sku}{b.type === "MEDICINE" ? " • medicine" : ""}</div>
                          </TableCell>
                          <TableCell><Badge variant="outline" className="text-xs">{b.department}</Badge></TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatQty(b.quantity)} {b.baseUnit}</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{formatQty(b.reorderLevel)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNaira(b.value)}</TableCell>
                          <TableCell>{b.isLow && <Badge className="border-0 bg-red-100 text-red-700">LOW</Badge>}</TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={() => void openAdjust(b)}><ArrowDownUp className="mr-1 h-3.5 w-3.5" /> Adjust</Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </GlassCard>
          </Stagger>
        </TabsContent>

        <TabsContent value="batches" className="mt-4">
          <Stagger className="space-y-3">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Batch filter">
              {(["ALL", "EXPIRING", "EXPIRED"] as const).map((f) => (
                <Button key={f} size="sm" variant={batchFilter === f ? "default" : "outline"} onClick={() => setBatchFilter(f)} aria-pressed={batchFilter === f}>
                  {f === "EXPIRING" ? "Expiring ≤ 90 days" : f === "EXPIRED" ? "Expired" : "All batches"}
                </Button>
              ))}
            </div>
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-[0.95rem] font-semibold">Batches &amp; expiry</h3>
                <Badge variant="outline" className="tabular-nums">{loading ? "…" : batches.length}</Badge>
              </div>
              <div className="px-5 pb-4 pt-3">
                <ScrollArea className="max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow><TableCell colSpan={7}><InlineLoading label="Loading batches" /></TableCell></TableRow>
                      ) : batches.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7}>
                            <EmptyState
                              icon={PackageSearch}
                              title="No batches match this filter"
                              hint={batchFilter === "ALL" ? "Pharmacy batches appear here after goods are received." : "Nothing in this bucket right now — try another filter."}
                              className="border-0"
                            />
                          </TableCell>
                        </TableRow>
                      ) : batches.map((b) => {
                        const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - Date.now()) / 864e5);
                        return (
                          <TableRow key={b.id} className={b.status === "EXPIRED" ? "bg-red-50/60" : daysLeft <= 90 && b.status === "ACTIVE" ? "bg-amber-50/50" : ""}>
                            <TableCell><div className="font-medium">{b.product.name}</div><div className="text-xs text-muted-foreground">{b.supplier?.name ?? "—"}</div></TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">{b.batchNumber}</TableCell>
                            <TableCell>
                              <div>{new Date(b.expiryDate).toLocaleDateString()}</div>
                              <div className={cn("text-xs", daysLeft < 0 ? "text-red-600" : daysLeft <= 90 ? "text-amber-600" : "text-muted-foreground")}>
                                {daysLeft < 0 ? `expired ${-daysLeft}d ago` : `${daysLeft}d left`}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{formatQty(b.quantityRemaining)} {b.product.baseUnit}</TableCell>
                            <TableCell className="text-right tabular-nums">{formatNaira(Number(b.quantityRemaining) * Number(b.unitCost))}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn(b.status === "EXPIRED" && "border-red-200 text-red-600", b.status === "QUARANTINED" && "border-amber-300 text-amber-700", b.status === "ACTIVE" && "border-emerald-200 text-emerald-700")}>{b.status}</Badge>
                            </TableCell>
                            <TableCell>
                              {b.status !== "EXPIRED" && Number(b.quantityRemaining) > 0 && (
                                <Button size="sm" variant="ghost" onClick={() => void quarantine(b)} aria-label={b.status === "QUARANTINED" ? `Restore batch ${b.batchNumber} to active` : `Quarantine batch ${b.batchNumber}`} title={b.status === "QUARANTINED" ? "Restore to active" : "Quarantine"}>
                                  <ShieldBan className={cn("h-3.5 w-3.5", b.status === "QUARANTINED" ? "text-emerald-600" : "text-amber-600")} />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </GlassCard>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-500" /> Expired batches are automatically blocked from ordinary sale and dispensing (FEFO allocation skips them).</p>
          </Stagger>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <FadeIn>
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-[0.95rem] font-semibold">Movement ledger</h3>
                <Badge variant="outline" className="tabular-nums">{loading ? "…" : movements.length}</Badge>
              </div>
              <div className="px-5 pb-4 pt-3">
                <ScrollArea className="max-h-[60vh]">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>When</TableHead><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow><TableCell colSpan={6}><InlineLoading label="Loading movements" /></TableCell></TableRow>
                      ) : movements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6}>
                            <EmptyState icon={History} title="No movements recorded yet" hint="Every receipt, sale, transfer and adjustment appears in this audited trail." className="border-0" />
                          </TableCell>
                        </TableRow>
                      ) : movements.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell className="text-xs text-muted-foreground tabular-nums">{new Date(m.createdAt).toLocaleString()}</TableCell>
                          <TableCell>{m.product.name}{m.batch ? <span className="text-xs text-muted-foreground/70"> ({m.batch.batchNumber})</span> : ""}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{m.type}</Badge></TableCell>
                          <TableCell className={cn("text-right font-mono tabular-nums", Number(m.quantity) < 0 ? "text-red-600" : "text-emerald-700")}>{formatQty(m.quantity)}</TableCell>
                          <TableCell className="text-xs max-w-40 truncate">{m.reason ?? "—"}</TableCell>
                          <TableCell className="text-xs">{m.user?.name ?? "system"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </GlassCard>
          </FadeIn>
        </TabsContent>
      </Tabs>

      {/* Adjust dialog */}
      <Dialog open={!!adjustTarget} onOpenChange={(o) => !o && setAdjustTarget(null)}>
        <DialogContent className="glass-strong rounded-2xl">
          <DialogHeader>
            <DialogTitle>Adjust stock — {adjustTarget?.name}</DialogTitle>
            <DialogDescription>All adjustments are reason-coded and audited.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Direction</Label>
                <Select value={adjustForm.direction} onValueChange={(v) => setAdjustForm({ ...adjustForm, direction: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="IN">Stock IN (found/recount)</SelectItem>
                    <SelectItem value="OUT">Stock OUT (loss/recount)</SelectItem>
                    <SelectItem value="DAMAGE">Damage / expiry write-off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="adjust-qty">Quantity ({adjustTarget?.baseUnit})</Label><Input id="adjust-qty" value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })} inputMode="decimal" /></div>
            </div>
            {adjustTarget?.type === "MEDICINE" && batchesForProduct.length > 0 && (
              <div className="space-y-1">
                <Label>Batch (optional — required to adjust a specific batch)</Label>
                <Select value={adjustForm.batchId} onValueChange={(v) => setAdjustForm({ ...adjustForm, batchId: v })}>
                  <SelectTrigger><SelectValue placeholder="Whole-product balance" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Whole-product balance</SelectItem>
                    {batchesForProduct.map((b) => (
                      <SelectItem key={b.id} value={b.id}>{b.batchNumber} — {formatQty(b.quantityRemaining)} left, exp {new Date(b.expiryDate).toLocaleDateString()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1"><Label htmlFor="adjust-reason">Reason</Label><Textarea id="adjust-reason" rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="e.g. Damaged by water leak in store B" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>Cancel</Button>
            <Button onClick={() => void handleAdjust()} disabled={saving || !adjustForm.quantity || adjustForm.reason.length < 3}>{saving ? "Saving…" : "Apply adjustment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
