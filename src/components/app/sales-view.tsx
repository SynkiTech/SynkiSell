"use client";

import { useCallback, useState } from "react";
import { listSales, voidSale, requestRefund, approveRefund, rejectRefund, listRefunds, reprintReceipt } from "@/server/actions/pos-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import { Printer, Undo2, Ban, Check, X } from "lucide-react";
import { ReceiptDialog } from "@/components/pos/pos-view";
import { useDataLoader } from "@/hooks/use-data-loader";

type SaleRow = {
  id: string; number: string; status: string; total: { toString(): string }; createdAt: string;
  cashier: { name: string }; channel: string;
  items: { id: string; department: string; lineTotal: { toString(): string }; productName: string; quantityBase: { toString(): string } }[];
  payments: { method: string; amount: { toString(): string } }[];
};
type RefundRow = {
  id: string; number: string; type: string; status: string; amount: { toString(): string }; reason: string;
  createdAt: string; sale: { number: string }; requestedBy: { name: string }; approvedBy: { name: string } | null;
  lines: { quantity: { toString(): string }; saleItem: { productName: string } }[];
};

export function SalesView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const role = useAppStore((s) => s.activeView); // placeholder to keep hook order stable
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof reprintReceipt>> | null>(null);
  const [voidTarget, setVoidTarget] = useState<SaleRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [refundTarget, setRefundTarget] = useState<SaleRow | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, string>>({});
  const [refundRestock, setRefundRestock] = useState(true);
  const [refundReason, setRefundReason] = useState("");

  // detail dialog state
  const [detailTarget, setDetailTarget] = useState<SaleRow | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        listSales(businessId, { status: statusFilter, search: search || undefined }) as unknown as Promise<SaleRow[]>,
        listRefunds(businessId) as unknown as Promise<RefundRow[]>,
      ]);
      setSales(s);
      setRefunds(r);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, statusFilter, search, toast]);

  useDataLoader(load, [load]);

  async function handleVoid() {
    if (!voidTarget) return;
    try {
      await voidSale(businessId, voidTarget.id, voidReason);
      toast({ title: "Sale voided", description: `${voidTarget.number} — stock restored, audit recorded` });
      setVoidTarget(null);
      setVoidReason("");
      void load();
    } catch (err) {
      toast({ title: "Void failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleRefundRequest() {
    if (!refundTarget) return;
    try {
      const lines = Object.entries(refundQty)
        .filter(([, q]) => Number(q) > 0)
        .map(([saleItemId, q]) => ({ saleItemId, quantity: Number(q), restock: refundRestock }));
      if (!lines.length) throw new Error("Enter at least one quantity to refund.");
      // map saleItemId → need item ids; refund dialog uses item index keys
      const result = (await requestRefund({ businessId, saleId: refundTarget.id, reason: refundReason, lines })) as unknown as { status?: string; number?: string };
      toast({ title: "Refund processed", description: `${result.number ?? ""} — ${result.status ?? "completed"}` });
      setRefundTarget(null);
      setRefundQty({});
      setRefundReason("");
      void load();
    } catch (err) {
      toast({ title: "Refund failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleRefundAction(refundId: string, approve: boolean) {
    try {
      if (approve) {
        await approveRefund(businessId, refundId);
        toast({ title: "Refund approved & completed" });
      } else {
        await rejectRefund(businessId, refundId, "Rejected by approver");
        toast({ title: "Refund rejected" });
      }
      void load();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleReprint(saleId: string) {
    try {
      const r = await reprintReceipt(businessId, saleId);
      setReceipt(r as Awaited<ReturnType<typeof reprintReceipt>>);
    } catch (err) {
      toast({ title: "Reprint failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Sales & Refunds</h1>
        <p className="text-sm text-slate-500">Full transaction history — voids and refunds preserve the original records with linked reversals.</p>
      </div>

      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales ({sales.length})</TabsTrigger>
          <TabsTrigger value="refunds">Refunds ({refunds.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4 space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Receipt number…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="VOIDED">Voided</SelectItem>
                <SelectItem value="PARTIALLY_REFUNDED">Partially refunded</SelectItem>
                <SelectItem value="REFUNDED">Refunded</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Receipt</TableHead><TableHead>When</TableHead><TableHead>Cashier</TableHead><TableHead>Dept mix</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.number}{s.channel === "OFFLINE_SYNC" && <Badge variant="outline" className="ml-1 text-[9px] border-amber-300 text-amber-600">offline→synced</Badge>}</TableCell>
                        <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-sm">{s.cashier.name}</TableCell>
                        <TableCell className="text-xs">{[...new Set(s.items.map((i) => i.department))].join(" + ")}</TableCell>
                        <TableCell className="text-right font-semibold">{Number(s.total).toLocaleString()}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={s.status === "COMPLETED" ? "border-emerald-200 text-emerald-700" : s.status === "VOIDED" ? "border-red-200 text-red-600" : "border-amber-200 text-amber-700"}>
                            {s.status.replace("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          <Button size="sm" variant="ghost" title="Reprint (audited)" onClick={() => void handleReprint(s.id)}><Printer className="h-3.5 w-3.5" /></Button>
                          {s.status === "COMPLETED" && (
                            <>
                              <Button size="sm" variant="ghost" title="Refund" onClick={() => { setRefundTarget(s); setRefundQty({}); setRefundReason(""); }}><Undo2 className="h-3.5 w-3.5 text-amber-600" /></Button>
                              <Button size="sm" variant="ghost" title="Void (manager)" onClick={() => { setVoidTarget(s); setVoidReason(""); }}><Ban className="h-3.5 w-3.5 text-red-500" /></Button>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="refunds" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Refund</TableHead><TableHead>Sale</TableHead><TableHead>Items</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Requested by</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {refunds.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">{r.number}<div className="text-slate-400">{new Date(r.createdAt).toLocaleDateString()}</div></TableCell>
                      <TableCell className="font-mono text-xs">{r.sale.number}</TableCell>
                      <TableCell className="text-xs">{r.lines.map((l) => `${l.saleItem.productName} ×${l.quantity}`).join("; ")}</TableCell>
                      <TableCell className="text-right font-semibold">{Number(r.amount).toLocaleString()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.status === "COMPLETED" ? "border-emerald-200 text-emerald-700" : r.status === "PENDING" ? "border-amber-200 text-amber-700" : r.status === "REJECTED" ? "border-red-200 text-red-600" : ""}>{r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{r.requestedBy.name}</TableCell>
                      <TableCell>
                        {r.status === "PENDING" && (
                          <div className="space-x-1">
                            <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200" onClick={() => void handleRefundAction(r.id, true)}><Check className="h-3.5 w-3.5" /></Button>
                            <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => void handleRefundAction(r.id, false)}><X className="h-3.5 w-3.5" /></Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!refunds.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400">No refunds recorded.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Void dialog */}
      <Dialog open={!!voidTarget} onOpenChange={(o) => !o && setVoidTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void sale {voidTarget?.number}</DialogTitle><DialogDescription>Voids reverse stock and cash, keep the original record, and are audit-logged. Requires manager/owner permission.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Reason (required)</Label><Textarea rows={2} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. Wrong items rung, customer changed order before leaving" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleVoid()} disabled={voidReason.length < 5}>Void sale</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund dialog */}
      <Dialog open={!!refundTarget} onOpenChange={(o) => !o && setRefundTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Refund sale {refundTarget?.number}</DialogTitle><DialogDescription>Quantities are capped at what remains refundable. Refunds create linked reversal records.</DialogDescription></DialogHeader>
          <div className="space-y-2">
            {refundTarget?.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 border rounded p-2">
                <div className="text-sm">{item.productName} <span className="text-xs text-slate-400">(sold {Number(item.quantityBase)})</span></div>
                <Input className="w-24" placeholder="qty" value={refundQty[item.id] ?? ""} onChange={(e) => setRefundQty({ ...refundQty, [item.id]: e.target.value })} inputMode="decimal" />
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={refundRestock} onChange={(e) => setRefundRestock(e.target.checked)} /> Return items to stock</label>
            <div className="space-y-1"><Label>Reason (required)</Label><Textarea rows={2} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="e.g. Customer returned unopened item with receipt" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundTarget(null)}>Cancel</Button>
            <Button className="bg-amber-600 hover:bg-amber-700" onClick={() => void handleRefundRequest()} disabled={!refundReason || refundReason.length < 5}>Process refund</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReceiptDialog receipt={receipt as never} onClose={() => setReceipt(null)} />
    </div>
  );
}
