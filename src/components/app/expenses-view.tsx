"use client";

import { useCallback, useState } from "react";
import { createExpense, approveExpense, listExpenses, listExpenseCategories } from "@/server/actions/finance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { Plus, Check, X, Wallet, Clock } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";

type ExpenseRow = {
  id: string; amount: { toString(): string }; date: string; paymentMethod: string; description: string;
  payee: string | null; status: string; category: { name: string } | null; enteredBy: { name: string };
};

export function ExpensesView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ categoryId: "", amount: "", date: new Date().toISOString().slice(0, 10), paymentMethod: "CASH", description: "", payee: "", receiptRef: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([
        listExpenses(businessId) as unknown as Promise<ExpenseRow[]>,
        listExpenseCategories(businessId) as unknown as Promise<{ id: string; name: string }[]>,
      ]);
      setExpenses(e);
      setCategories(c);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoaded(true);
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  const totalApproved = expenses.filter((e) => e.status === "APPROVED").reduce((a, e) => a + Number(e.amount), 0);
  const pending = expenses.filter((e) => e.status === "PENDING");

  async function handleCreate() {
    setSaving(true);
    try {
      const result = (await createExpense({
        businessId,
        categoryId: form.categoryId || null,
        amount: Number(form.amount),
        date: form.date,
        paymentMethod: form.paymentMethod as "CASH" | "TRANSFER" | "CARD",
        description: form.description,
        payee: form.payee || undefined,
        receiptRef: form.receiptRef || undefined,
      })) as unknown as { status: string };
      toast({ title: result.status === "APPROVED" ? "Expense recorded" : "Expense submitted for approval", description: `${form.description} — ${formatNaira(form.amount)}` });
      setDialogOpen(false);
      setForm({ categoryId: "", amount: "", date: new Date().toISOString().slice(0, 10), paymentMethod: "CASH", description: "", payee: "", receiptRef: "" });
      bumpRefresh();
      void load();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string, approve: boolean) {
    try {
      await approveExpense(businessId, id, approve);
      toast({ title: approve ? "Expense approved" : "Expense rejected" });
      void load();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Expenses"
        subtitle={
          <>
            Operating expenses — approved total: <strong className="tabular-nums">{formatNaira(totalApproved)}</strong> (this ledger is not a statutory accounting system)
          </>
        }
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" /> Record expense
          </Button>
        }
      />

      {!loaded ? (
        <GlassCard className="p-5">
          <InlineLoading label="Loading expenses" />
        </GlassCard>
      ) : (
        <>
          {pending.length > 0 && (
            <FadeIn>
              <GlassCard intensity="subtle" className="border-amber-400/50 bg-amber-500/10 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-amber-700">
                  <Clock className="h-4 w-4" aria-hidden="true" />
                  {pending.length} expense(s) awaiting approval
                </p>
                <div className="space-y-1.5">
                  {pending.map((e) => (
                    <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200/60 bg-background/70 px-3 py-1.5 text-sm">
                      <span>
                        {e.description} — <strong className="tabular-nums">{formatNaira(e.amount)}</strong>{" "}
                        <span className="text-xs text-muted-foreground">by {e.enteredBy.name}</span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 border-emerald-200 text-emerald-700" aria-label={`Approve ${e.description}`} onClick={() => void handleApprove(e.id, true)}>
                          <Check className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 border-red-200 text-red-600" aria-label={`Reject ${e.description}`} onClick={() => void handleApprove(e.id, false)}>
                          <X className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </FadeIn>
          )}

          <FadeIn>
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-[0.95rem] font-semibold">Expense ledger</h3>
                <div className="flex flex-wrap items-center gap-2">
                  {pending.length > 0 && (
                    <Badge variant="outline" className="border-amber-400/50 bg-amber-500/10 text-amber-700">
                      {pending.length} pending approval
                    </Badge>
                  )}
                  <Badge variant="outline">{expenses.length} record{expenses.length === 1 ? "" : "s"}</Badge>
                </div>
              </div>
              <div className="px-5 pb-4 pt-3">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Method</TableHead><TableHead>By</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenses.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs">{new Date(e.date).toLocaleDateString()}</TableCell>
                        <TableCell><div className="font-medium">{e.description}</div>{e.payee && <div className="text-xs text-muted-foreground">payee: {e.payee}</div>}</TableCell>
                        <TableCell className="text-sm">{e.category?.name ?? "—"}</TableCell>
                        <TableCell className="text-sm">{e.paymentMethod}</TableCell>
                        <TableCell className="text-xs">{e.enteredBy.name}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{formatNaira(e.amount)}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={
                              e.status === "APPROVED"
                                ? "border-emerald-200/70 bg-emerald-500/10 text-emerald-700"
                                : e.status === "PENDING"
                                  ? "border-amber-400/50 bg-amber-500/10 text-amber-700"
                                  : "border-red-200/70 bg-red-500/10 text-red-600"
                            }
                          >
                            {e.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!expenses.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="p-2">
                          <EmptyState
                            icon={Wallet}
                            title="No expenses recorded yet"
                            hint="Rent, salaries, transport, utilities — record them here so reports reflect true profitability."
                            className="border-0"
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </GlassCard>
          </FadeIn>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record expense</DialogTitle><Description>Examples: rent, electricity, salaries, transport, internet, maintenance.</Description></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.categoryId} onValueChange={(v) => setForm({ ...form, categoryId: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Amount (₦)</Label><Input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Payment method</Label>
              <Select value={form.paymentMethod} onValueChange={(v) => setForm({ ...form, paymentMethod: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="TRANSFER">Transfer</SelectItem><SelectItem value="CARD">Card</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Shop rent for November" /></div>
            <div className="space-y-1"><Label>Payee (optional)</Label><Input value={form.payee} onChange={(e) => setForm({ ...form, payee: e.target.value })} /></div>
            <div className="space-y-1"><Label>Receipt ref (optional)</Label><Input value={form.receiptRef} onChange={(e) => setForm({ ...form, receiptRef: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleCreate()} disabled={saving || !form.amount || form.description.length < 3}>{saving ? "Saving…" : "Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Description({ children }: { children: React.ReactNode }) {
  return <DialogDescription>{children}</DialogDescription>;
}
