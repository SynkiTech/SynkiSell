"use client";

import { useCallback, useState } from "react";
import { createExpense, approveExpense, listExpenses, listExpenseCategories } from "@/server/actions/finance-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { useAppStore } from "@/store/app-store";
import { Plus, Check, X, Wallet } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type ExpenseRow = {
  id: string; amount: { toString(): string }; date: string; paymentMethod: string; description: string;
  payee: string | null; status: string; category: { name: string } | null; enteredBy: { name: string };
};

export function ExpensesView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-slate-500">Operating expenses — approved total: <strong>{formatNaira(totalApproved)}</strong> (this ledger is not a statutory accounting system)</p>
        </div>
        <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-1" /> Record expense</Button>
      </div>

      {pending.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="p-3">
            <p className="text-sm font-medium text-amber-800 mb-2">{pending.length} expense(s) awaiting approval</p>
            <div className="space-y-1.5">
              {pending.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-sm bg-white rounded border px-3 py-1.5">
                  <span>{e.description} — <strong>{formatNaira(e.amount)}</strong> <span className="text-xs text-slate-400">by {e.enteredBy.name}</span></span>
                  <span className="space-x-1">
                    <Button size="sm" variant="outline" className="h-7 text-emerald-700 border-emerald-200" onClick={() => void handleApprove(e.id, true)}><Check className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-200" onClick={() => void handleApprove(e.id, false)}><X className="h-3.5 w-3.5" /></Button>
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Date</TableHead><TableHead>Description</TableHead><TableHead>Category</TableHead><TableHead>Method</TableHead><TableHead>By</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.date).toLocaleDateString()}</TableCell>
                  <TableCell><div className="font-medium">{e.description}</div>{e.payee && <div className="text-xs text-slate-500">payee: {e.payee}</div>}</TableCell>
                  <TableCell className="text-sm">{e.category?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">{e.paymentMethod}</TableCell>
                  <TableCell className="text-xs">{e.enteredBy.name}</TableCell>
                  <TableCell className="text-right font-semibold">{formatNaira(e.amount)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={e.status === "APPROVED" ? "border-emerald-200 text-emerald-700" : e.status === "PENDING" ? "border-amber-200 text-amber-700" : "border-red-200 text-red-600"}>{e.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {!expenses.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400"><Wallet className="h-5 w-5 mx-auto mb-1 opacity-40" />No expenses recorded yet.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleCreate()} disabled={saving || !form.amount || form.description.length < 3}>{saving ? "Saving…" : "Record"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Description({ children }: { children: React.ReactNode }) {
  return <DialogDescription>{children}</DialogDescription>;
}
