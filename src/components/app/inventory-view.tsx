"use client";

import { useCallback, useState } from "react";
import { listStockBalances, listBatches, createStockAdjustment, setBatchStatus, listStockMovements } from "@/server/actions/inventory-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { formatNaira, formatQty } from "@/lib/money";
import { TriangleAlert, CalendarClock, ArrowDownUp, ShieldBan, Boxes } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        <p className="text-sm text-slate-500">
          Stock value at cost: <strong>{formatNaira(totalValue)}</strong> • every change is an audited ledger movement
        </p>
      </div>

      <Tabs defaultValue="balances">
        <TabsList>
          <TabsTrigger value="balances">Stock balances</TabsTrigger>
          <TabsTrigger value="batches" className="relative">Batches & expiry <CalendarClock className="h-3.5 w-3.5 ml-1" /></TabsTrigger>
          <TabsTrigger value="movements">Movement ledger</TabsTrigger>
        </TabsList>

        <TabsContent value="balances" className="mt-4 space-y-3">
          <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Product</TableHead><TableHead>Dept</TableHead><TableHead className="text-right">Balance</TableHead><TableHead className="text-right">Reorder at</TableHead><TableHead className="text-right">Value</TableHead><TableHead /><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {balances.map((b) => (
                      <TableRow key={b.id} className={b.isLow ? "bg-red-50/50" : ""}>
                        <TableCell>
                          <div className="font-medium">{b.name}</div>
                          <div className="text-xs text-slate-500">{b.sku}{b.type === "MEDICINE" ? " • medicine" : ""}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{b.department}</Badge></TableCell>
                        <TableCell className="text-right font-semibold">{formatQty(b.quantity)} {b.baseUnit}</TableCell>
                        <TableCell className="text-right text-slate-500">{formatQty(b.reorderLevel)}</TableCell>
                        <TableCell className="text-right">{formatNaira(b.value)}</TableCell>
                        <TableCell>{b.isLow && <Badge className="bg-red-100 text-red-700 border-0">LOW</Badge>}</TableCell>
                        <TableCell><Button size="sm" variant="outline" onClick={() => void openAdjust(b)}><ArrowDownUp className="h-3.5 w-3.5 mr-1" /> Adjust</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="batches" className="mt-4 space-y-3">
          <div className="flex gap-2">
            {(["ALL", "EXPIRING", "EXPIRED"] as const).map((f) => (
              <Button key={f} size="sm" variant={batchFilter === f ? "default" : "outline"} className={batchFilter === f ? "bg-teal-600" : ""} onClick={() => setBatchFilter(f)}>
                {f === "EXPIRING" ? "Expiring ≤ 90 days" : f === "EXPIRED" ? "Expired" : "All batches"}
              </Button>
            ))}
          </div>
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Product</TableHead><TableHead>Batch</TableHead><TableHead>Expiry</TableHead><TableHead className="text-right">Remaining</TableHead><TableHead className="text-right">Value</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {batches.map((b) => {
                      const daysLeft = Math.ceil((new Date(b.expiryDate).getTime() - Date.now()) / 864e5);
                      return (
                        <TableRow key={b.id} className={b.status === "EXPIRED" ? "bg-red-50/60" : daysLeft <= 90 && b.status === "ACTIVE" ? "bg-amber-50/50" : ""}>
                          <TableCell><div className="font-medium">{b.product.name}</div><div className="text-xs text-slate-500">{b.supplier?.name ?? "—"}</div></TableCell>
                          <TableCell className="font-mono text-xs">{b.batchNumber}</TableCell>
                          <TableCell>
                            <div>{new Date(b.expiryDate).toLocaleDateString()}</div>
                            <div className={cn2(daysLeft < 0 ? "text-red-600" : daysLeft <= 90 ? "text-amber-600" : "text-slate-400", "text-xs")}>
                              {daysLeft < 0 ? `expired ${-daysLeft}d ago` : `${daysLeft}d left`}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium">{formatQty(b.quantityRemaining)} {b.product.baseUnit}</TableCell>
                          <TableCell className="text-right">{formatNaira(Number(b.quantityRemaining) * Number(b.unitCost))}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn2(b.status === "EXPIRED" && "border-red-200 text-red-600", b.status === "QUARANTINED" && "border-amber-300 text-amber-700", b.status === "ACTIVE" && "border-emerald-200 text-emerald-700")}>{b.status}</Badge>
                          </TableCell>
                          <TableCell>
                            {b.status !== "EXPIRED" && Number(b.quantityRemaining) > 0 && (
                              <Button size="sm" variant="ghost" onClick={() => void quarantine(b)}>
                                <ShieldBan className={cn2("h-3.5 w-3.5", b.status === "QUARANTINED" ? "text-emerald-600" : "text-amber-600")} />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!batches.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400">No batches match this filter.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
          <p className="text-xs text-slate-400 flex items-center gap-1.5"><TriangleAlert className="h-3.5 w-3.5" /> Expired batches are automatically blocked from ordinary sale and dispensing (FEFO allocation skips them).</p>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>When</TableHead><TableHead>Product</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Qty</TableHead><TableHead>Reason</TableHead><TableHead>By</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs text-slate-500">{new Date(m.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{m.product.name}{m.batch ? <span className="text-xs text-slate-400"> ({m.batch.batchNumber})</span> : ""}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{m.type}</Badge></TableCell>
                        <TableCell className={cn2("text-right font-mono", Number(m.quantity) < 0 ? "text-red-600" : "text-emerald-700")}>{formatQty(m.quantity)}</TableCell>
                        <TableCell className="text-xs max-w-40 truncate">{m.reason ?? "—"}</TableCell>
                        <TableCell className="text-xs">{m.user?.name ?? "system"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Adjust dialog */}
      <Dialog open={!!adjustTarget} onOpenChange={(o) => !o && setAdjustTarget(null)}>
        <DialogContent>
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
              <div className="space-y-1"><Label>Quantity ({adjustTarget?.baseUnit})</Label><Input value={adjustForm.quantity} onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })} inputMode="decimal" /></div>
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
            <div className="space-y-1"><Label>Reason</Label><Textarea rows={2} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} placeholder="e.g. Damaged by water leak in store B" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustTarget(null)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleAdjust()} disabled={saving || !adjustForm.quantity || adjustForm.reason.length < 3}>{saving ? "Saving…" : "Apply adjustment"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function cn2(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
