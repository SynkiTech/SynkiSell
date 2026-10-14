"use client";

import { useCallback, useState } from "react";
import { openShift, closeShift, getMyShift, listShifts, cashDrop } from "@/server/actions/pos-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { Play, Square, Banknote } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";
import { cn } from "@/lib/utils";

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
  const [loaded, setLoaded] = useState(false);
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
    } finally {
      setLoaded(true);
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
    <div className="space-y-5">
      <PageHeader
        title="Cashier Shifts"
        subtitle="Opening float, cash movements and reconciliation with discrepancy report."
        actions={
          myShift ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDropDialog(true)}><Banknote className="h-4 w-4 mr-1" /> Cash drop</Button>
              <Button onClick={() => { setCountedCash(String(Number(myShift.expectedCash ?? 0))); setCloseDialog(true); }}><Square className="h-4 w-4 mr-1" /> Close my shift</Button>
            </div>
          ) : (
            <Button onClick={() => setOpenDialog(true)}><Play className="h-4 w-4 mr-1" /> Open shift</Button>
          )
        }
      />

      {myShift && (
        <FadeIn>
          <GlassCard intensity="strong" className="border-primary/30 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[0.95rem] font-semibold">Current shift</h3>
                <Badge variant="outline" className="border-primary/30 text-primary">{myShift.salesCount} sale(s)</Badge>
              </div>
              <Banknote className="h-4 w-4 text-primary" aria-hidden="true" />
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div><p className="text-xs text-muted-foreground">Opened</p><p className="font-semibold tabular-nums">{new Date(myShift.openedAt).toLocaleTimeString()}</p></div>
              <div><p className="text-xs text-muted-foreground">Opening float</p><p className="font-semibold tabular-nums">{formatNaira(myShift.openingCash as string)}</p></div>
              <div><p className="text-xs text-muted-foreground">Sales (this shift)</p><p className="font-semibold tabular-nums">{myShift.salesCount} • {formatNaira(myShift.salesTotal as string)}</p></div>
              <div><p className="text-xs text-muted-foreground">Expected cash in drawer</p><p className="font-semibold text-primary tabular-nums">{formatNaira(myShift.expectedCash as string)}</p></div>
            </div>
          </GlassCard>
        </FadeIn>
      )}

      <FadeIn>
        <GlassCard className="overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <div className="flex items-center gap-2">
              <h3 className="text-[0.95rem] font-semibold">Shift history</h3>
              <Badge variant="outline">{shifts.length}</Badge>
            </div>
            <span className="text-xs text-muted-foreground">All figures come from recorded cash movements</span>
          </div>
          <div className="px-5 pb-4 pt-3">
            {!loaded ? (
              <InlineLoading label="Loading shifts" />
            ) : shifts.length === 0 ? (
              <EmptyState icon={Banknote} title="No shifts recorded yet" hint="Open a shift to start tracking the cash drawer against expected takings." className="border-0" />
            ) : (
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
                        <TableCell className="text-right tabular-nums">{formatNaira(s.openingCash)}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.expectedCash ? formatNaira(s.expectedCash) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{s.countedCash ? formatNaira(s.countedCash) : "—"}</TableCell>
                        <TableCell className={cn(
                          "text-right font-semibold tabular-nums",
                          Number(s.discrepancy) < 0 ? "text-red-600" : Number(s.discrepancy) > 0 ? "text-amber-600" : "text-emerald-700",
                        )}>
                          <span className="sr-only">{Number(s.discrepancy) < 0 ? "shortage" : Number(s.discrepancy) > 0 ? "overage" : "balanced"}: </span>
                          {s.discrepancy ? formatNaira(s.discrepancy) : "—"}
                        </TableCell>
                        <TableCell><Badge variant="outline" className={s.status === "OPEN" ? "border-primary/30 text-primary" : ""}>{s.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </div>
        </GlassCard>
      </FadeIn>

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Open shift</DialogTitle><DialogDescription>Record your opening cash float.</DialogDescription></DialogHeader>
          <div className="space-y-1"><Label>Opening cash (₦)</Label><Input value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} inputMode="decimal" /></div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenDialog(false)}>Cancel</Button><Button onClick={() => void handleOpen()}>Open</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close shift & reconcile</DialogTitle>
            <DialogDescription>Expected in drawer: {myShift ? formatNaira(myShift.expectedCash as string) : "—"}. Count the drawer and enter the amount.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Counted cash (₦)</Label><Input value={countedCash} onChange={(e) => setCountedCash(e.target.value)} inputMode="decimal" /></div>
            {countedCash && myShift && (
              <p role="status" className={cn(
                "text-sm font-medium tabular-nums",
                Number(countedCash) - Number(myShift.expectedCash) === 0 ? "text-emerald-700" : "text-amber-700",
              )}>
                Discrepancy: {formatNaira(Number(countedCash) - Number(myShift.expectedCash))}
              </p>
            )}
            <div className="space-y-1"><Label>Notes (optional)</Label><Textarea rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setCloseDialog(false)}>Cancel</Button><Button onClick={() => void handleClose()}>Close shift</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dropDialog} onOpenChange={setDropDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cash drop</DialogTitle><DialogDescription>Move excess cash from the drawer to the safe. Recorded as a cash movement.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1"><Label>Amount (₦)</Label><Input value={dropAmount} onChange={(e) => setDropAmount(e.target.value)} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Reason</Label><Textarea rows={2} value={dropReason} onChange={(e) => setDropReason(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setDropDialog(false)}>Cancel</Button><Button onClick={() => void handleDrop()}>Record drop</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
