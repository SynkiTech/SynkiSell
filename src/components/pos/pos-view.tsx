"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useAppStore, cartTotal } from "@/store/app-store";
import { getPosCatalog, completeSale, openShift, getMyShift } from "@/server/actions/pos-actions";
import { toast } from "@/hooks/use-toast";
import { loadCatalogCache, saveCatalogCache, queueSale, newSaleKey, listQueuedSales, type CachedProduct, type CatalogCache } from "@/lib/offline/db";
import { syncOfflineSales } from "@/lib/offline/sync";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { Search, Trash2, WifiOff, CloudOff, Printer, X, Minus, Plus, Banknote, Smartphone, CreditCard, CircleAlert } from "lucide-react";

type Receipt = {
  number: string; createdAt: string; cashier: string;
  business: { name: string; receiptHeader: string; receiptFooter: string; address?: string | null; phone?: string | null };
  items: { name: string; quantity: number; unit: string; unitPrice: unknown; discount: unknown; lineTotal: unknown; department: string }[];
  payments: { method: string; amount: unknown; reference?: string | null }[];
  subtotal: unknown; discountTotal: unknown; taxTotal: unknown; total: unknown; amountPaid: unknown; changeGiven: unknown; status: string;
};

const fmt = (n: number | string) => `₦${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PosView({ businessId, onShiftChanged }: { businessId: string; onShiftChanged?: () => void }) {
  const { data: session } = useSession();
  const canDiscountLine = session?.user?.role === "OWNER" || session?.user?.role === "MANAGER" || session?.user?.role === "PHARMACIST";

  const { cart, addToCart, updateCartQty, updateCartDiscount, removeFromCart, clearCart, offline, setOffline, bumpRefresh } = useAppStore();
  const [catalog, setCatalog] = useState<CatalogCache | null>(null);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<"ALL" | "PHARMACY" | "SUPERMARKET">("ALL");
  const [shift, setShift] = useState<{ id: string; openingCash: number } | null>(null);
  const [openShiftDialog, setOpenShiftDialog] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("5000");
  const [payDialog, setPayDialog] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "TRANSFER" | "CARD">("CASH");
  const [cashGiven, setCashGiven] = useState("");
  const [transferRef, setTransferRef] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [splitTransfer, setSplitTransfer] = useState("");
  const [useSplit, setUseSplit] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [offlineWarnings, setOfflineWarnings] = useState<string[]>([]);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const total = cartTotal(cart);
  const { online } = offline;

  /* ── Catalogue: online fetch with offline cache fallback ── */
  const loadCatalog = useCallback(async () => {
    try {
      const data = await getPosCatalog(businessId);
      const cache: CatalogCache = {
        businessId,
        fetchedAt: new Date().toISOString(),
        products: data.products.map((p) => ({
          id: p.id, name: p.name, sku: p.sku, barcodes: p.barcodes,
          department: p.department, type: p.type, trackBatches: p.trackBatches,
          sellingPrice: Number(p.sellingPrice), taxRate: Number(p.taxRate), baseUnit: p.baseUnit,
          conversions: p.conversions.map((c) => ({ fromUnit: c.fromUnit, toUnit: c.toUnit, factor: Number(c.factor) })),
          stock: Number(p.stock),
        })),
        business: data.business ? { ...data.business, defaultTaxRate: Number(data.business.defaultTaxRate) } : null,
        disclosedNote: "Offline snapshot — cloud stock may be out of date.",
      };
      setCatalog(cache);
      await saveCatalogCache(cache);
    } catch {
      const cached = await loadCatalogCache(businessId);
      if (cached) {
        setCatalog(cached);
        setOffline({ online: false });
        toast({ title: "Offline mode", description: "Using cached catalogue. Stock may be out of date." });
      } else {
        toast({ title: "Cannot load POS catalogue", description: "You are offline and no cached catalogue exists yet.", variant: "destructive" });
      }
    }
  }, [businessId, setOffline]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const loadShift = useCallback(async () => {
    try {
      const r = await getMyShift(businessId);
      setShift(r?.shift ? { id: r.shift.id, openingCash: 0 } : null);
      if (!r?.shift) setOpenShiftDialog(true);
    } catch {
      setShift(null);
    }
  }, [businessId]);

  useEffect(() => { void loadShift(); }, [loadShift]);

  /* ── Barcode / search ── */
  const filtered = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.products.filter((p) => {
      if (deptFilter !== "ALL" && p.department !== deptFilter && p.department !== "BOTH") return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcodes.some((b) => b.includes(q));
    });
  }, [catalog, search, deptFilter]);

  function handleBarcodeScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = search.trim();
    if (!code) return;
    const product = catalog?.products.find((p) => p.barcodes.includes(code)) ?? filtered[0];
    if (product) {
      handleAdd(product);
      setSearch("");
    } else {
      toast({ title: "Product not found", description: `No product matches "${code}"`, variant: "destructive" });
    }
  }

  function handleAdd(p: CachedProduct) {
    if (online && p.stock <= 0 && !p.trackBatches) {
      toast({ title: "Out of stock", description: `${p.name} has no stock`, variant: "destructive" });
      return;
    }
    addToCart({ productId: p.id, name: p.name, department: p.department, soldUnit: p.baseUnit, unitPrice: p.sellingPrice, discountAmount: 0, stock: p.stock, trackBatches: p.trackBatches });
  }

  /* ── Checkout ── */
  async function handleOpenShift() {
    try {
      await openShift(businessId, Number(openingFloat) || 0);
      setOpenShiftDialog(false);
      await loadShift();
      onShiftChanged?.();
      toast({ title: "Shift opened", description: `Opening float ₦${openingFloat}` });
    } catch (err) {
      toast({ title: "Could not open shift", description: err instanceof Error ? err.message : "Error", variant: "destructive" });
    }
  }

  function resetPayment() {
    setPayDialog(false); setPaymentMethod("CASH"); setCashGiven(""); setTransferRef(""); setSplitCash(""); setSplitTransfer(""); setUseSplit(false);
  }

  async function handleComplete() {
    if (!catalog || !cart.length) return;
    setCompleting(true);
    const idempotencyKey = newSaleKey();

    const lines = cart.map((c) => ({ productId: c.productId, quantity: c.quantity, soldUnit: c.soldUnit, discountAmount: c.discountAmount }));
    const payments = useSplit
      ? [
          { method: "CASH" as const, amount: Number(splitCash) || 0 },
          { method: "TRANSFER" as const, amount: Number(splitTransfer) || 0, reference: transferRef || null },
        ].filter((p) => p.amount > 0)
      : paymentMethod === "CASH"
        ? [{ method: "CASH" as const, amount: Number(cashGiven) || total }]
        : [{ method: paymentMethod, amount: total, reference: transferRef || null }];

    try {
      if (!online) {
        // Queue locally — do NOT pretend it's synced
        await queueSale({
          idempotencyKey, businessId, shiftId: shift?.id ?? null,
          lines, payments, transactionDiscount: 0,
          clientCreatedAt: new Date().toISOString(),
          status: "pending", attempts: 0,
        });
        const pending = await listQueuedSales(businessId);
        setOffline({ pendingCount: pending.filter((q) => q.status === "pending").length });
        clearCart();
        resetPayment();
        toast({ title: "Sale stored offline", description: "Will sync automatically when connection returns. Not yet in the cloud." });
        return;
      }

      const result = await completeSale({
        businessId, shiftId: shift?.id ?? null, lines, payments,
        transactionDiscount: 0, idempotencyKey, clientCreatedAt: null, offline: false,
      });
      if (result?.ok) {
        if (result.shortfallWarnings?.length) setOfflineWarnings(result.shortfallWarnings);
        setReceipt(result.receipt as unknown as Receipt);
        clearCart();
        resetPayment();
        bumpRefresh();
        void loadCatalog(); // refresh stock
        toast({ title: `Sale ${result.number} completed`, description: `Total ${fmt(result.total)}${Number(result.changeGiven) > 0 ? ` • change ${fmt(result.changeGiven)}` : ""}` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sale failed";
      if (msg.includes("INSUFFICIENT_STOCK")) {
        toast({ title: "Insufficient stock", description: msg.split(":")[1] ?? "Not enough stock", variant: "destructive" });
      } else if (msg.includes("PERMISSION_DENIED")) {
        toast({ title: "Not permitted", description: msg.replace("PERMISSION_DENIED: ", ""), variant: "destructive" });
      } else {
        toast({ title: "Sale failed", description: msg, variant: "destructive" });
      }
    } finally {
      setCompleting(false);
    }
  }

  async function handleManualSync() {
    const result = await syncOfflineSales(businessId);
    const pending = await listQueuedSales(businessId);
    setOffline({ pendingCount: pending.filter((q) => q.status === "pending").length });
    toast({ title: "Sync complete", description: `${result.synced} synced, ${result.failed} failed, ${result.remaining} remaining` });
    void loadCatalog();
  }

  const paymentTotal = useSplit ? (Number(splitCash) || 0) + (Number(splitTransfer) || 0) : Number(cashGiven) || total;
  const changeDue = Math.max(0, paymentTotal - total);
  const balanceDue = Math.max(0, total - paymentTotal);

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Point of Sale</h1>
          <p className="text-sm text-slate-500">{catalog?.business?.name ?? ""} • {shift ? "Shift open" : "No shift"}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!online && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700"><WifiOff className="h-3 w-3 mr-1" /> Offline — sales queue locally</Badge>}
          {online && offline.pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => void handleManualSync()}><CloudOff className="h-3.5 w-3.5 mr-1" /> Sync {offline.pendingCount} offline sale(s)</Button>
          )}
          {!shift && online && <Button size="sm" onClick={() => setOpenShiftDialog(true)}>Open shift</Button>}
        </div>
      </div>

      {!online && (
        <Alert className="border-amber-300 bg-amber-50">
          <WifiOff className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Offline mode: catalogue snapshot from {catalog?.fetchedAt ? new Date(catalog.fetchedAt).toLocaleTimeString() : "—"}.
            Stock shown may be out of date; offline sales queue locally and sync when reconnected.
          </AlertDescription>
        </Alert>
      )}
      {offlineWarnings.length > 0 && (
        <Alert className="border-amber-300 bg-amber-50">
          <CircleAlert className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">{offlineWarnings.join(" • ")}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Products */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                ref={barcodeRef}
                autoFocus
                placeholder="Scan barcode or search products… (Enter adds first match)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleBarcodeScan}
                className="pl-9"
              />
              {search && <button className="absolute right-2 top-2.5" onClick={() => setSearch("")}><X className="h-4 w-4 text-slate-400" /></button>}
            </div>
            <Select value={deptFilter} onValueChange={(v: "ALL" | "PHARMACY" | "SUPERMARKET") => setDeptFilter(v)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All departments</SelectItem>
                <SelectItem value="PHARMACY">Pharmacy</SelectItem>
                <SelectItem value="SUPERMARKET">Supermarket</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="h-[calc(100vh-320px)] min-h-72">
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 pr-2">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAdd(p)}
                  className={cn(
                    "text-left rounded-lg border p-2.5 bg-white hover:border-teal-500 hover:shadow-sm transition-all active:scale-[0.98]",
                    p.stock <= 0 && !p.trackBatches && "opacity-50"
                  )}
                >
                  <div className="text-xs font-medium text-slate-400 flex items-center justify-between">
                    <span>{p.department === "PHARMACY" ? "Pharmacy" : p.department === "BOTH" ? "Both" : "Market"}</span>
                    <span className={cn("font-semibold", p.stock <= 0 ? "text-red-500" : "text-slate-500")}>
                      {p.trackBatches ? "" : `${p.stock} ${p.baseUnit}`}
                    </span>
                  </div>
                  <div className="mt-1 text-sm font-semibold leading-snug line-clamp-2 min-h-9">{p.name}</div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="font-bold text-teal-700">{fmt(p.sellingPrice)}</span>
                    <Plus className="h-4 w-4 text-teal-600" />
                  </div>
                </button>
              ))}
              {!filtered.length && <p className="col-span-full text-center text-sm text-slate-400 py-10">No products match.</p>}
            </div>
          </ScrollArea>
        </div>

        {/* Cart */}
        <Card className="lg:col-span-2 flex flex-col self-start sticky top-20">
          <CardContent className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Basket ({cart.length})</h2>
              {cart.length > 0 && <Button size="sm" variant="ghost" className="text-red-500 h-7" onClick={clearCart}><Trash2 className="h-3.5 w-3.5" /> Clear</Button>}
            </div>
            <ScrollArea className="max-h-[42vh]">
              <div className="space-y-2">
                {cart.map((c) => (
                  <div key={c.productId} className="rounded-lg border p-2 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium leading-snug">{c.name}</span>
                      <button onClick={() => removeFromCart(c.productId)} aria-label={`Remove ${c.name}`}><X className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center border rounded-md">
                        <button className="px-2 py-1" onClick={() => updateCartQty(c.productId, c.quantity - 1)} aria-label="decrease"><Minus className="h-3 w-3" /></button>
                        <input
                          className="w-12 text-center text-sm outline-none"
                          value={c.quantity}
                          onChange={(e) => updateCartQty(c.productId, Number(e.target.value) || 0)}
                          inputMode="decimal"
                        />
                        <button className="px-2 py-1" onClick={() => updateCartQty(c.productId, c.quantity + 1)} aria-label="increase"><Plus className="h-3 w-3" /></button>
                      </div>
                      <span className="text-xs text-slate-500">{c.soldUnit} × {fmt(c.unitPrice)}</span>
                      <span className="ml-auto font-semibold text-sm">{fmt(c.quantity * c.unitPrice - c.discountAmount)}</span>
                    </div>
                    {canDiscountLine && (
                      <div className="flex items-center gap-1.5">
                        <Label className="text-[10px] text-slate-400">Discount ₦</Label>
                        <input
                          className="w-20 rounded border px-1.5 py-0.5 text-xs"
                          value={c.discountAmount || ""}
                          placeholder="0"
                          inputMode="decimal"
                          onChange={(e) => updateCartDiscount(c.productId, Number(e.target.value) || 0)}
                        />
                      </div>
                    )}
                  </div>
                ))}
                {!cart.length && <p className="text-sm text-slate-400 text-center py-10">Basket is empty — scan or tap a product.</p>}
              </div>
            </ScrollArea>

            <div className="border-t pt-3 space-y-1.5">
              <div className="flex justify-between text-sm text-slate-500"><span>Items</span><span>{cart.reduce((a, c) => a + c.quantity, 0)}</span></div>
              <div className="flex justify-between text-lg font-bold"><span>Total</span><span className="text-teal-700">{fmt(total)}</span></div>
              <Button
                className="w-full bg-teal-600 hover:bg-teal-700 h-12 text-base"
                disabled={!cart.length || completing || (!online && !catalog)}
                onClick={() => setPayDialog(true)}
              >
                {completing ? "Processing…" : `Charge ${fmt(total)}`}
              </Button>
              <p className="text-[10px] text-center text-slate-400">F2 pay • Esc clear focus — totals verified server-side</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Open shift dialog */}
      <Dialog open={openShiftDialog && !!online} onOpenChange={setOpenShiftDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open your shift</DialogTitle>
            <DialogDescription>Record the opening cash float for your drawer.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Opening cash (₦)</Label>
            <Input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenShiftDialog(false)}>Later</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleOpenShift()}>Open shift</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={payDialog} onOpenChange={(o) => !o && resetPayment()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Take payment — {fmt(total)}</DialogTitle>
            <DialogDescription>Mixed pharmacy + supermarket items complete as ONE sale & one receipt.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!useSplit && (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {([["CASH", Banknote], ["TRANSFER", Smartphone], ["CARD", CreditCard]] as const).map(([m, Icon]) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={cn("flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors",
                        paymentMethod === m ? "border-teal-600 bg-teal-50 text-teal-700" : "hover:bg-slate-50")}
                    >
                      <Icon className="h-5 w-5" />{m}
                    </button>
                  ))}
                </div>
                {paymentMethod === "CASH" && (
                  <div className="space-y-2">
                    <Label>Cash given (₦)</Label>
                    <Input autoFocus value={cashGiven} onChange={(e) => setCashGiven(e.target.value)} placeholder={String(total)} inputMode="decimal" />
                    {cashGiven && Number(cashGiven) >= total && (
                      <p className="text-sm font-semibold text-emerald-700">Change due: {fmt(Number(cashGiven) - total)}</p>
                    )}
                    {cashGiven && Number(cashGiven) < total && (
                      <p className="text-sm text-amber-700">Balance due: {fmt(total - Number(cashGiven))} (recorded on receipt)</p>
                    )}
                  </div>
                )}
                {(paymentMethod === "TRANSFER" || paymentMethod === "CARD") && (
                  <div className="space-y-2">
                    <Label>Reference (optional)</Label>
                    <Input value={transferRef} onChange={(e) => setTransferRef(e.target.value)} placeholder="e.g. transfer ref / terminal slip no." />
                    <p className="text-[11px] text-slate-400">Card payments are recorded only — no card data is ever stored.</p>
                  </div>
                )}
              </>
            )}
            {useSplit && (
              <div className="space-y-2">
                <div><Label>Split — cash (₦)</Label><Input value={splitCash} onChange={(e) => setSplitCash(e.target.value)} inputMode="decimal" placeholder="0" /></div>
                <div><Label>Split — transfer (₦)</Label><Input value={splitTransfer} onChange={(e) => setSplitTransfer(e.target.value)} inputMode="decimal" placeholder="0" /></div>
                <p className={cn("text-sm", Math.abs(paymentTotal - total) < 0.01 ? "text-emerald-700" : "text-amber-700")}>
                  {Math.abs(paymentTotal - total) < 0.01 ? "Split matches total." : `Split totals ${fmt(paymentTotal)} vs ${fmt(total)}`}
                </p>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} /> Split tender (cash + transfer)
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetPayment}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleComplete()} disabled={completing || paymentTotal <= 0}>
              {completing ? "Completing…" : "Complete sale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt dialog */}
      <ReceiptDialog receipt={receipt} onClose={() => setReceipt(null)} />
    </div>
  );
}

export function ReceiptDialog({ receipt, onClose }: { receipt: Receipt | null; onClose: () => void }) {
  if (!receipt) return null;
  const dec = (v: unknown) => Number(v);
  return (
    <Dialog open={!!receipt} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Printer className="h-4 w-4" /> Receipt {receipt.number}</DialogTitle>
        </DialogHeader>
        <div className="rounded-lg border bg-white p-4 font-mono text-xs space-y-2" id="receipt-print">
          <div className="text-center">
            <div className="font-bold text-sm">{receipt.business.receiptHeader || receipt.business.name}</div>
            {receipt.business.address && <div>{receipt.business.address}</div>}
            {receipt.business.phone && <div>{receipt.business.phone}</div>}
            <div className="mt-1">{new Date(receipt.createdAt).toLocaleString()}</div>
            <div>Cashier: {receipt.cashier}</div>
            <div className="font-semibold">#{receipt.number}</div>
          </div>
          <div className="border-t border-dashed pt-2 space-y-1">
            {receipt.items.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-2">
                <span className="truncate">{i.quantity}× {i.name}</span>
                <span>{fmt(dec(i.lineTotal))}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed pt-2 space-y-0.5">
            <div className="flex justify-between"><span>Subtotal</span><span>{fmt(dec(receipt.subtotal))}</span></div>
            {dec(receipt.discountTotal) > 0 && <div className="flex justify-between"><span>Discounts</span><span>-{fmt(dec(receipt.discountTotal))}</span></div>}
            {dec(receipt.taxTotal) > 0 && <div className="flex justify-between"><span>Tax</span><span>{fmt(dec(receipt.taxTotal))}</span></div>}
            <div className="flex justify-between font-bold text-sm"><span>TOTAL</span><span>{fmt(dec(receipt.total))}</span></div>
            {receipt.payments.map((p, i) => (
              <div key={i} className="flex justify-between"><span>{p.method}{p.reference ? ` (${p.reference})` : ""}</span><span>{fmt(dec(p.amount))}</span></div>
            ))}
            {dec(receipt.changeGiven) > 0 && <div className="flex justify-between"><span>Change</span><span>{fmt(dec(receipt.changeGiven))}</span></div>}
          </div>
          <div className="border-t border-dashed pt-2 text-center">{receipt.business.receiptFooter}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
