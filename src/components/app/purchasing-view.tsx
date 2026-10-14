"use client";

import { useCallback, useState } from "react";
import { listSuppliers, saveSupplier, createPurchaseOrder, listPurchaseOrders, receiveGoods, listGoodsReceipts, paySupplierBalance } from "@/server/actions/purchasing-actions";
import { listProducts } from "@/server/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { formatNaira, formatQty } from "@/lib/money";
import { Plus, Truck, PackageCheck, HandCoins } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";
import { cn } from "@/lib/utils";

type SupplierRow = { id: string; name: string; contactName: string | null; phone: string | null; email: string | null; address: string | null; category: string | null; paymentTerms: string | null; notes: string | null; balance: { toString(): string }; isActive: boolean };
type ProductOption = { id: string; name: string; baseUnit: string; trackBatches: boolean; costPrice: { toString(): string } };
type PoRow = { id: string; number: string; status: string; total: { toString(): string }; expectedDate: string | null; supplier: { name: string }; lines: { id: string; quantity: { toString(): string }; receivedQty: { toString(): string }; unitCost: { toString(): string }; product: { name: string; baseUnit: string } }[] };
type ReceiptRow = { id: string; number: string; totalCost: { toString(): string }; receivedDate: string; supplier: { name: string }; receivedBy: { name: string }; lines: { id: string; quantity: { toString(): string }; unitCost: { toString(): string }; batchNumber: string | null; expiryDate: string | null; product: { name: string } }[] };

const emptySupplier = { name: "", contactName: "", phone: "", email: "", address: "", category: "", paymentTerms: "", notes: "", isActive: true };

export function PurchasingView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [pos, setPos] = useState<PoRow[]>([]);
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [tab, setTab] = useState("suppliers");
  const [loaded, setLoaded] = useState(false);

  // supplier dialog
  const [supplierDialog, setSupplierDialog] = useState(false);
  const [supplierForm, setSupplierForm] = useState(emptySupplier);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [payTarget, setPayTarget] = useState<SupplierRow | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("TRANSFER");

  // PO dialog
  const [poDialog, setPoDialog] = useState(false);
  const [poSupplier, setPoSupplier] = useState("");
  const [poExpected, setPoExpected] = useState("");
  const [poNotes, setPoNotes] = useState("");
  const [poLines, setPoLines] = useState<{ productId: string; quantity: string; unitCost: string }[]>([{ productId: "", quantity: "1", unitCost: "0" }]);

  // Receive dialog
  const [receiveDialog, setReceiveDialog] = useState(false);
  const [receiveSupplier, setReceiveSupplier] = useState("");
  const [receivePoId, setReceivePoId] = useState("");
  const [receiveOnCredit, setReceiveOnCredit] = useState(true);
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveLines, setReceiveLines] = useState<{ productId: string; quantity: string; unitCost: string; batchNumber: string; expiryDate: string }[]>([{ productId: "", quantity: "1", unitCost: "0", batchNumber: "", expiryDate: "" }]);

  const load = useCallback(async () => {
    try {
      const [s, p, po, gr] = await Promise.all([
        listSuppliers(businessId) as unknown as Promise<SupplierRow[]>,
        listProducts(businessId) as unknown as Promise<ProductOption[]>,
        listPurchaseOrders(businessId) as unknown as Promise<PoRow[]>,
        listGoodsReceipts(businessId) as unknown as Promise<ReceiptRow[]>,
      ]);
      setSuppliers(s);
      setProducts(p);
      setPos(po);
      setReceipts(gr);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoaded(true);
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handleSaveSupplier() {
    try {
      await saveSupplier({ businessId, id: editingSupplierId ?? undefined, ...supplierForm, email: supplierForm.email || undefined });
      toast({ title: editingSupplierId ? "Supplier updated" : "Supplier added", description: supplierForm.name });
      setSupplierDialog(false);
      void load();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handlePay() {
    if (!payTarget) return;
    try {
      await paySupplierBalance(businessId, payTarget.id, Number(payAmount), payMethod);
      toast({ title: "Payment recorded", description: `${payTarget.name}: ₦${payAmount}` });
      setPayTarget(null);
      void load();
    } catch (err) {
      toast({ title: "Payment failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleCreatePo() {
    try {
      const lines = poLines.filter((l) => l.productId && Number(l.quantity) > 0).map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) }));
      await createPurchaseOrder({ businessId, supplierId: poSupplier, expectedDate: poExpected || null, notes: poNotes || undefined, lines });
      toast({ title: "Purchase order created", description: `${lines.length} line(s) — stock is NOT received until goods receipt` });
      setPoDialog(false);
      setPoLines([{ productId: "", quantity: "1", unitCost: "0" }]);
      void load();
    } catch (err) {
      toast({ title: "PO failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleReceive() {
    try {
      const lines = receiveLines.filter((l) => l.productId && Number(l.quantity) > 0).map((l) => ({
        productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost),
        batchNumber: l.batchNumber || null, expiryDate: l.expiryDate || null,
      }));
      const result = (await receiveGoods({ businessId, supplierId: receiveSupplier, poId: receivePoId || null, onCredit: receiveOnCredit, notes: receiveNotes || undefined, lines })) as unknown as { number: string };
      toast({ title: `Goods received — ${result.number}`, description: `${lines.length} line(s) recorded with stock movements${receiveOnCredit ? " on credit" : ""}` });
      setReceiveDialog(false);
      setReceiveLines([{ productId: "", quantity: "1", unitCost: "0", batchNumber: "", expiryDate: "" }]);
      void load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Receiving failed";
      toast({ title: "Receiving failed", description: msg.replace(/^(BATCH_REQUIRED|EXPIRY_REQUIRED|EXPIRED_BATCH_REJECTED):/, "Medicines require batch number & future expiry — "), variant: "destructive" });
    }
  }

  const productById = new Map(products.map((p) => [p.id, p]));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchasing & Suppliers"
        subtitle="Purchase orders do NOT create stock — receiving does."
        actions={
          <>
            <Button variant="outline" onClick={() => { setReceiveSupplier(suppliers[0]?.id ?? ""); setReceiveDialog(true); }}><PackageCheck className="h-4 w-4 mr-1" /> Receive goods</Button>
            <Button onClick={() => { setPoSupplier(suppliers[0]?.id ?? ""); setPoDialog(true); }}><Plus className="h-4 w-4 mr-1" /> New purchase order</Button>
          </>
        }
      />

      <FadeIn>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="suppliers">Suppliers ({suppliers.length})</TabsTrigger>
            <TabsTrigger value="pos">Purchase orders ({pos.length})</TabsTrigger>
            <TabsTrigger value="receipts">Goods receipts ({receipts.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="suppliers" className="mt-4">
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.95rem] font-semibold">Suppliers</h3>
                  <Badge variant="outline">{suppliers.length}</Badge>
                </div>
                <Button size="sm" variant="outline" onClick={() => { setEditingSupplierId(null); setSupplierForm(emptySupplier); setSupplierDialog(true); }}><Plus className="h-3.5 w-3.5 mr-1" /> Add supplier</Button>
              </div>
              <div className="px-5 pb-4 pt-3">
                {!loaded ? (
                  <InlineLoading label="Loading suppliers" />
                ) : suppliers.length === 0 ? (
                  <EmptyState icon={Truck} title="No suppliers yet" hint="Add your first supplier to start creating purchase orders and recording deliveries." className="border-0" />
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Contact</TableHead><TableHead>Terms</TableHead><TableHead className="text-right">Balance owed</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {suppliers.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell><div className="font-medium">{s.name}</div><div className="text-xs text-muted-foreground">{s.category ?? "—"}</div></TableCell>
                          <TableCell className="text-sm">{s.contactName}<div className="text-xs text-muted-foreground">{s.phone}</div></TableCell>
                          <TableCell className="text-sm">{s.paymentTerms ?? "—"}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatNaira(s.balance)}</TableCell>
                          <TableCell className="space-x-1 whitespace-nowrap">
                            <Button size="sm" variant="ghost" onClick={() => { setEditingSupplierId(s.id); setSupplierForm({ name: s.name, contactName: s.contactName ?? "", phone: s.phone ?? "", email: s.email ?? "", address: s.address ?? "", category: s.category ?? "", paymentTerms: s.paymentTerms ?? "", notes: s.notes ?? "", isActive: s.isActive }); setSupplierDialog(true); }}>Edit</Button>
                            {Number(s.balance) > 0 && (
                              <Button size="sm" variant="outline" onClick={() => { setPayTarget(s); setPayAmount(s.balance.toString()); }}><HandCoins className="h-3.5 w-3.5 mr-1" /> Pay</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </GlassCard>
          </TabsContent>

          <TabsContent value="pos" className="mt-4">
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.95rem] font-semibold">Purchase orders</h3>
                  <Badge variant="outline">{pos.length}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Receiving is what adds stock</span>
              </div>
              <div className="px-5 pb-4 pt-3">
                {!loaded ? (
                  <InlineLoading label="Loading purchase orders" />
                ) : pos.length === 0 ? (
                  <EmptyState icon={Truck} title="No purchase orders yet" hint="Create a PO to record what you ordered — stock only changes when the delivery is received." className="border-0" />
                ) : (
                  <ScrollArea className="max-h-[60vh]">
                    <Table>
                      <TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Lines</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead>Expected</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {pos.map((po) => (
                          <TableRow key={po.id}>
                            <TableCell className="font-mono text-xs tabular-nums">{po.number}</TableCell>
                            <TableCell>{po.supplier.name}</TableCell>
                            <TableCell className="text-xs">{po.lines.map((l) => `${l.product.name} ×${formatQty(l.quantity)}`).join("; ")}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{formatNaira(po.total)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={cn(
                                po.status === "RECEIVED" && "border-[oklch(0.585_0.115_163/0.4)] text-[oklch(0.50_0.11_163)]",
                                po.status === "PARTIALLY_RECEIVED" && "border-amber-400/50 text-amber-600",
                              )}>{po.status.replace("_", " ")}</Badge>
                            </TableCell>
                            <TableCell className="text-sm">{po.expectedDate ? new Date(po.expectedDate).toLocaleDateString() : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </div>
            </GlassCard>
          </TabsContent>

          <TabsContent value="receipts" className="mt-4">
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.95rem] font-semibold">Goods receipts</h3>
                  <Badge variant="outline">{receipts.length}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">Batch & expiry recorded for medicines</span>
              </div>
              <div className="px-5 pb-4 pt-3">
                {!loaded ? (
                  <InlineLoading label="Loading goods receipts" />
                ) : receipts.length === 0 ? (
                  <EmptyState icon={PackageCheck} title="No goods receipts yet" hint="Received deliveries will appear here with costs, batch numbers and expiry dates." className="border-0" />
                ) : (
                  <ScrollArea className="max-h-[60vh]">
                    <Table>
                      <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Supplier</TableHead><TableHead>By</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Cost</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {receipts.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-mono text-xs tabular-nums">{r.number}<div className="text-muted-foreground/70">{new Date(r.receivedDate).toLocaleDateString()}</div></TableCell>
                            <TableCell>{r.supplier.name}</TableCell>
                            <TableCell className="text-sm">{r.receivedBy.name}</TableCell>
                            <TableCell className="text-xs">{r.lines.map((l) => `${l.product.name} ×${formatQty(l.quantity)}${l.batchNumber ? ` [${l.batchNumber} exp ${l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : "?"}]` : ""}`).join("; ")}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">{formatNaira(r.totalCost)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
              </div>
            </GlassCard>
          </TabsContent>
        </Tabs>
      </FadeIn>

      {/* Supplier dialog */}
      <Dialog open={supplierDialog} onOpenChange={setSupplierDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingSupplierId ? "Edit supplier" : "New supplier"}</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>Name</Label><Input value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Contact person</Label><Input value={supplierForm.contactName} onChange={(e) => setSupplierForm({ ...supplierForm, contactName: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} /></div>
            <div className="space-y-1"><Label>Category</Label><Input value={supplierForm.category} onChange={(e) => setSupplierForm({ ...supplierForm, category: e.target.value })} placeholder="PHARMACEUTICAL_DISTRIBUTOR" /></div>
            <div className="space-y-1"><Label>Payment terms</Label><Input value={supplierForm.paymentTerms} onChange={(e) => setSupplierForm({ ...supplierForm, paymentTerms: e.target.value })} placeholder="Net 30" /></div>
            <div className="space-y-1 col-span-2"><Label>Address</Label><Input value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} /></div>
            <div className="space-y-1 col-span-2"><Label>Notes</Label><Textarea rows={2} value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></div>
            <div className="flex items-center gap-2 col-span-2"><Switch checked={supplierForm.isActive} onCheckedChange={(v) => setSupplierForm({ ...supplierForm, isActive: v })} /><Label>Active supplier</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSupplierDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleSaveSupplier()} disabled={!supplierForm.name}>Save supplier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pay supplier dialog */}
      <Dialog open={!!payTarget} onOpenChange={(o) => !o && setPayTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay supplier — {payTarget?.name}</DialogTitle><DialogDescription>Outstanding: {payTarget ? formatNaira(payTarget.balance) : ""}</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>Amount (₦)</Label><Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Method</Label><Select value={payMethod} onValueChange={setPayMethod}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="TRANSFER">Transfer</SelectItem><SelectItem value="CARD">Card</SelectItem></SelectContent></Select></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button onClick={() => void handlePay()}>Record payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PO dialog */}
      <Dialog open={poDialog} onOpenChange={setPoDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New purchase order</DialogTitle><DialogDescription>Ordering does not add stock. Receive goods when delivery arrives.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={poSupplier} onValueChange={setPoSupplier}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{suppliers.filter((s) => s.isActive).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1"><Label>Expected delivery</Label><Input type="date" value={poExpected} onChange={(e) => setPoExpected(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Order lines</Label>
            {poLines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-6 space-y-1">
                  <Select value={line.productId} onValueChange={(v) => { const p = productById.get(v); setPoLines(poLines.map((l, j) => j === i ? { ...l, productId: v, unitCost: p ? Number(p.costPrice).toString() : l.unitCost } : l)); }}>
                    <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2"><Input value={line.quantity} onChange={(e) => setPoLines(poLines.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))} placeholder="qty" inputMode="decimal" /></div>
                <div className="col-span-3"><Input value={line.unitCost} onChange={(e) => setPoLines(poLines.map((l, j) => j === i ? { ...l, unitCost: e.target.value } : l))} placeholder="unit cost" inputMode="decimal" /></div>
                <div className="col-span-1"><Button size="sm" variant="ghost" className="text-red-500" onClick={() => setPoLines(poLines.filter((_, j) => j !== i))}><Truck className="h-3.5 w-3.5" /><span className="sr-only">Remove line</span></Button></div>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setPoLines([...poLines, { productId: "", quantity: "1", unitCost: "0" }])}><Plus className="h-3.5 w-3.5 mr-1" /> Add line</Button>
          </div>
          <div className="space-y-1"><Label>Notes</Label><Input value={poNotes} onChange={(e) => setPoNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPoDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleCreatePo()} disabled={!poSupplier}>Create PO</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receive dialog */}
      <Dialog open={receiveDialog} onOpenChange={setReceiveDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Receive goods</DialogTitle><DialogDescription>Medicines require batch number + expiry date. Creates stock movements immediately.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Supplier</Label>
              <Select value={receiveSupplier} onValueChange={setReceiveSupplier}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1">
              <Label>Against PO (optional)</Label>
              <Select value={receivePoId} onValueChange={setReceivePoId}><SelectTrigger><SelectValue placeholder="Direct delivery" /></SelectTrigger>
                <SelectContent><SelectItem value="">Direct delivery (no PO)</SelectItem>{pos.filter((p) => p.status !== "RECEIVED" && p.status !== "CANCELLED").map((p) => <SelectItem key={p.id} value={p.id}>{p.number} — {p.supplier.name}</SelectItem>)}</SelectContent></Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-medium">Received lines (quantities in BASE units)</Label>
            {receiveLines.map((line, i) => {
              const p = productById.get(line.productId);
              return (
                <div key={i} className="grid grid-cols-12 gap-2 items-end rounded-lg border p-2">
                  <div className="col-span-12 space-y-1">
                    <Select value={line.productId} onValueChange={(v) => { const pr = productById.get(v); setReceiveLines(receiveLines.map((l, j) => j === i ? { ...l, productId: v, unitCost: pr ? Number(pr.costPrice).toString() : l.unitCost } : l)); }}>
                      <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                      <SelectContent>{products.map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name} <span className="text-xs text-muted-foreground/70">({pr.baseUnit})</span></SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3"><Label className="text-[10px]">Qty</Label><Input value={line.quantity} onChange={(e) => setReceiveLines(receiveLines.map((l, j) => j === i ? { ...l, quantity: e.target.value } : l))} inputMode="decimal" /></div>
                  <div className="col-span-3"><Label className="text-[10px]">Unit cost</Label><Input value={line.unitCost} onChange={(e) => setReceiveLines(receiveLines.map((l, j) => j === i ? { ...l, unitCost: e.target.value } : l))} inputMode="decimal" /></div>
                  {p?.trackBatches ? (
                    <>
                      <div className="col-span-3"><Label className="text-[10px]">Batch no. *</Label><Input value={line.batchNumber} onChange={(e) => setReceiveLines(receiveLines.map((l, j) => j === i ? { ...l, batchNumber: e.target.value } : l))} /></div>
                      <div className="col-span-3"><Label className="text-[10px]">Expiry *</Label><Input type="date" value={line.expiryDate} onChange={(e) => setReceiveLines(receiveLines.map((l, j) => j === i ? { ...l, expiryDate: e.target.value } : l))} /></div>
                    </>
                  ) : (
                    <div className="col-span-6 text-[10px] text-muted-foreground/70 pb-2">Retail item — no batch needed</div>
                  )}
                  <div className="col-span-12 flex justify-end"><Button size="sm" variant="ghost" className="text-red-500 h-6" onClick={() => setReceiveLines(receiveLines.filter((_, j) => j !== i))}>remove</Button></div>
                </div>
              );
            })}
            <Button size="sm" variant="outline" onClick={() => setReceiveLines([...receiveLines, { productId: "", quantity: "1", unitCost: "0", batchNumber: "", expiryDate: "" }])}><Plus className="h-3.5 w-3.5 mr-1" /> Add line</Button>
          </div>
          <div className="flex items-center gap-2"><Switch checked={receiveOnCredit} onCheckedChange={setReceiveOnCredit} /><Label>Purchase on credit (adds to supplier balance)</Label></div>
          <div className="space-y-1"><Label>Notes</Label><Input value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialog(false)}>Cancel</Button>
            <Button onClick={() => void handleReceive()} disabled={!receiveSupplier}>Receive & update stock</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
