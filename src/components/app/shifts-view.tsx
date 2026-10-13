"use client";

import { useCallback, useState } from "react";
import { openShift, closeShift, getMyShift, listShifts, cashDrop } from "@/server/actions/pos-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { Play, Square, Banknote } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type ShiftRow = {
  id: string; userId: string; status: string; openedAt: string; closedAt: string | null;
  openingCash: { toString(): string }; closingCash: { toString(): string } | null;
  expectedCash: { toString(): string } | null; countedCash: { toString(): string } | null;
  discrepancy: { toString(): string } | null; user: { name: string }; notes: string | null;
};

export function ShiftsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [myShift, setMyShift] = useState<{ id: string; openedAt: string; openingCash: unknown; expectedCash: unknown; salesCount: number; salesTotal: unknown } | null>(null);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openingFloat, setOpeningFloat] = useState("5000");
  const [closeDialog, setCloseDialog] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [dropDialog, setDropDialog] = useState(false);
  const [dropAmount, setDropAmount] = useState("");
  const [dropReason, setDropReason] = useState("Cash drop to safe");

  const load = useCallback(async () => {
    try {
      const [mine, all] = await Promise.all([
        getMyShift(businessId) as unknown as Promise<{ shift: typeof myShift }>,
        listShifts(businessId) as unknown as Promise<ShiftRow[]>,
      ]);
      setMyShift(mine?.shift ?? null);
      setShifts(all);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handleOpen() {
    try {
      await openShift(businessId, Number(openingFloat) || 0);
      toast({ title: "Shift opened" });
      setOpenDialog(false);
      bumpRefresh();
      void load();
    } catch (err) {
      toast({ title: "Could not open shift", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleClose() {
    try {
      const result = (await closeShift(businessId, Number(countedCash) || 0, closeNotes || undefined)) as unknown as { expectedCash: string; discrepancy: string };
      const disc = Number(result.discrepancy);
      toast({
        title: "Shift closed",
        description: `Expected ${formatNaira(result.expectedCash)} • discrepancy ${formatNaira(disc)}${disc !== 0 ? " — investigate!" : " (clean)"}`,
        variant: disc !== 0 ? "destructive" : "default",
      });
      setCloseDialog(false);
      bumpRefresh();
      void load();
    } catch (err) {
      toast({ title: "Could not close shift", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleDrop() {
    try {
      await cashDrop(businessId, Number(dropAmount), dropReason);
      toast({ title: "Cash drop recorded" });
      setDropDialog(false);
      void load();
    } catch (err) {
      toast({ title: "Drop failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cashier Shifts</h1>
          <p className="text-sm text-slate-500">Opening float, cash movements and reconciliation with discrepancy report.</p>
        </div>
        {myShift ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setDropDialog(true)}><Banknote className="h-4 w-4 mr-1" /> Cash drop</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => { setCountedCash(String(Number(myShift.expectedCash ?? 0))); setCloseDialog(true); }}><Square className="h-4 w-4 mr-1" /> Close my shift</Button>
          </div>
        ) : (
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setOpenDialog(true)}><Play className="h-4 w-4 mr-1" /> Open shift</Button>
        )}
      </div>

      {myShift && (
        <Card className="border-teal-200 bg-teal-50/50">
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><p className="text-xs text-slate-500">Opened</p><p className="font-semibold">{new Date(myShift.openedAt).toLocaleTimeString()}</p></div>
            <div><p className="text-xs text-slate-500">Opening float</p><p className="font-semibold">{formatNaira(myShift.openingCash as string)}</p></div>
            <div><p className="text-xs text-slate-500">Sales (this shift)</p><p className="font-semibold">{myShift.salesCount} • {formatNaira(myShift.salesTotal as string)}</p></div>
            <div><p className="text-xs text-slate-500">Expected cash in drawer</p><p className="font-semibold text-teal-700">{formatNaira(myShift.expectedCash as string)}</p></div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[55vh]">
            <Table>
              <TableHeader>
                <TableRow><TableHead>Cashier</TableHead><TableHead>Opened</TableHead><TableHead>Closed</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Discrepancy</TableHead><TableHead>Status</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {shifts.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.user.name}</TableCell>
                    <TableCell className="text-xs">{new Date(s.openedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{s.closedAt ? new Date(s.closedAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-right">{formatNaira(s.openingCash)}</TableCell>
                    <TableCell className="text-right">{s.expectedCash ? formatNaira(s.expectedCash) : "—"}</TableCell>
                    <TableCell className="text-right">{s.countedCash ? formatNaira(s.countedCash) : "—"}</TableCell>
                    <TableCell className={`text-right font-semibold ${Number(s.discrepancy) < 0 ? "text-red-600" : Number(s.discrepancy) > 0 ? "text-amber-600" : "text-emerald-700"}`}>
                      {s.discrepancy ? formatNaira(s.discrepancy) : "—"}
                    </TableCell>
                    <TableCell><Badge variant="outline" className={s.status === "OPEN" ? "border-teal-200 text-teal-700" : ""}>{s.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Open shift</DialogTitle><DialogDescription>Record your opening cash float.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Opening cash (₦)</Label><Input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenDialog(false)}>Cancel</Button><Button className="bg-teal-600" onClick={() => void handleOpen()}>Open</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close shift & reconcile</DialogTitle>
            <DialogDescription>Expected in drawer: {myShift ? formatNaira(myShift.expectedCash as string) : "—"}. Count the drawer and enter the amount.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Counted cash (₦)</Label><Input value={countedCash} onChange={(e) => setCountedCash(e.target.value)} inputMode="decimal" /></div>
            {countedCash && myShift && (
              <p className={`text-sm font-medium ${Number(countedCash) - Number(myShift.expectedCash) === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                Discrepancy: {formatNaira(Number(countedCash) - Number(myShift.expectedCash))}
              </p>
            )}
            <div className="space-y-1"><Label>Notes (optional)</Label><Textarea rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCloseDialog(false)}>Cancel</Button><Button className="bg-teal-600" onClick={() => void handleClose()}>Close shift</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dropDialog} onOpenChange={setDropDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cash drop</DialogTitle><DialogDescription>Move excess cash from the drawer to the safe. Recorded as a cash movement.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Amount (₦)</Label><Input value={dropAmount} onChange={(e) => setDropAmount(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Reason</Label><Textarea rows={2} value={dropReason} onChange={(e) => setDropReason(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDropDialog(false)}>Cancel</Button><Button className="bg-teal-600" onClick={() => void handleDrop()}>Record drop</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
