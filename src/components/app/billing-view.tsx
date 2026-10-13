"use client";

import { useCallback, useState } from "react";
import { getBillingOverview, startInvoicePayment, mockConfirmPayment, checkPaymentStatus } from "@/server/actions/billing-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { CreditCard, FlaskConical, ShieldCheck, CalendarClock, ExternalLink } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type Overview = {
  mode: "LIVE_KEYS" | "MOCK_TEST_MODE";
  subscription: { status: string; plan: string; annualFee: { toString(): string }; startDate: string | null; endDate: string | null; graceEndDate: string | null; autoRenew: boolean; daysLeft: number | null } | null;
  deployment: { stage: string; feeAmount: { toString(): string }; completedAt: string | null } | null;
  invoices: { id: string; number: string; kind: string; status: string; total: { toString(): string }; issuedAt: string | null; paidAt: string | null; lines: { kind: string; description: string; amount: { toString(): string } }[] }[];
  payments: { id: string; reference: string; method: string; amount: { toString(): string }; status: string; provider: string; createdAt: string; verifiedAt: string | null }[];
  pricing: Record<string, unknown> | null;
  reminders: { title: string; body: string; severity: string; createdAt: string }[];
};

export function BillingView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<Overview | null>(null);
  const [payDialog, setPayDialog] = useState<{ invoiceId: string; invoiceNumber: string; amount: string; reference: string; mode: string; authorizationUrl: string | null } | null>(null);
  const [polling, setPolling] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = (await getBillingOverview(businessId)) as unknown as Overview;
      setData(d);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handlePay(invoiceId: string, invoiceNumber: string, amount: string) {
    try {
      const result = (await startInvoicePayment(businessId, invoiceId)) as unknown as { mode: string; reference: string; authorizationUrl: string | null };
      setPayDialog({ invoiceId, invoiceNumber, amount, reference: result.reference, mode: result.mode, authorizationUrl: result.authorizationUrl });
      void load();
    } catch (err) {
      toast({ title: "Payment init failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleMockConfirm() {
    if (!payDialog) return;
    try {
      await mockConfirmPayment(businessId, payDialog.reference);
      toast({ title: "Mock payment verified & applied", description: `Invoice ${payDialog.invoiceNumber} marked PAID (test mode)` });
      setPayDialog(null);
      void load();
    } catch (err) {
      toast({ title: "Mock confirm failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function pollStatus() {
    if (!payDialog) return;
    setPolling(true);
    try {
      const result = (await checkPaymentStatus(businessId, payDialog.reference)) as unknown as { status: string };
      if (result.status === "SUCCESS") {
        toast({ title: "Payment verified", description: `Invoice ${payDialog.invoiceNumber} is PAID` });
        setPayDialog(null);
        void load();
      } else {
        toast({ title: "Payment not confirmed yet", description: `Status: ${result.status}` });
      }
    } catch (err) {
      toast({ title: "Check failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setPolling(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-400">Loading billing…</p>;

  const sub = data.subscription;
  const outstanding = data.invoices.filter((i) => i.status === "ISSUED" || i.status === "DRAFT");

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Subscription & Billing</h1>
        <p className="text-sm text-slate-500">Deployment fee and annual subscription are separate charges — the deployment fee never repeats at renewal.</p>
      </div>

      {data.mode === "MOCK_TEST_MODE" && (
        <Alert className="border-teal-300 bg-teal-50">
          <FlaskConical className="h-4 w-4 text-teal-600" />
          <AlertTitle className="text-teal-800">Paystack test mode (mock)</AlertTitle>
          <AlertDescription className="text-teal-700">
            No Paystack API keys are configured, so payments run through a clearly-labelled mock provider. The full flow — initialize → verify → idempotent application → subscription activation — is real code; only the HTTP call to Paystack is simulated. Configure <code className="text-xs">PAYSTACK_SECRET_KEY</code> to go live.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Subscription</CardTitle></CardHeader>
          <CardContent>
            {sub ? (
              <>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={sub.status === "ACTIVE" ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"}>{sub.status}</Badge>
                  <span className="text-sm font-medium">{sub.plan}</span>
                </div>
                <p className="mt-2 text-xs text-slate-500 flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {sub.endDate ? `Renews ${new Date(sub.endDate).toLocaleDateString()}` : "Awaiting first payment"}{sub.daysLeft !== null && sub.daysLeft >= 0 ? ` (${sub.daysLeft} days)` : ""}</p>
                <p className="text-xs text-slate-400">Annual fee {formatNaira(sub.annualFee)}</p>
              </>
            ) : <p className="text-sm text-slate-400">No subscription</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Deployment</CardTitle></CardHeader>
          <CardContent>
            {data.deployment ? (
              <>
                <Badge variant="outline" className="border-teal-200 text-teal-700">{data.deployment.stage.replace(/_/g, " ")}</Badge>
                <p className="mt-2 text-xs text-slate-500">One-time fee {formatNaira(data.deployment.feeAmount)}</p>
                {data.deployment.completedAt && <p className="text-xs text-slate-400">Completed {new Date(data.deployment.completedAt).toLocaleDateString()}</p>}
              </>
            ) : <p className="text-sm text-slate-400">No deployment order</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pilot pricing</CardTitle></CardHeader>
          <CardContent className="text-xs text-slate-500 space-y-0.5">
            {data.pricing && (
              <>
                <p>Deployment: ₦{Number(data.pricing.deploymentFee).toLocaleString()}</p>
                <p>Annual subscription: ₦{Number(data.pricing.annualSubscriptionFee).toLocaleString()}</p>
                <p>Grace period: {String(data.pricing.gracePeriodDays)} days</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {data.reminders.length > 0 && (
        <Card className="border-amber-200">
          <CardContent className="p-3 space-y-1.5">
            {data.reminders.map((r, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <ShieldCheck className={`h-4 w-4 shrink-0 ${r.severity === "CRITICAL" ? "text-red-500" : "text-amber-500"}`} />
                <div><span className="font-medium">{r.title}</span> — <span className="text-slate-600">{r.body}</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Invoices</CardTitle><CardDescription>The first invoice itemises deployment and subscription as separate lines.</CardDescription></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Kind</TableHead><TableHead>Lines</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {data.invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs">{inv.number}<div className="text-slate-400">{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : ""}</div></TableCell>
                  <TableCell className="text-sm">{inv.kind}</TableCell>
                  <TableCell className="text-xs">{inv.lines.map((l) => `${l.description} — ${formatNaira(l.amount)}`).join(" • ")}</TableCell>
                  <TableCell className="text-right font-semibold">{formatNaira(inv.total)}</TableCell>
                  <TableCell><Badge variant="outline" className={inv.status === "PAID" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}>{inv.status}</Badge></TableCell>
                  <TableCell>
                    {(inv.status === "ISSUED" || inv.status === "DRAFT") && (
                      <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => void handlePay(inv.id, inv.number, inv.total.toString())}>
                        <CreditCard className="h-3.5 w-3.5 mr-1" /> Pay {formatNaira(inv.total)}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Payment history</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Provider</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                  <TableCell className="text-xs">{p.provider}</TableCell>
                  <TableCell className="text-xs">{p.method}</TableCell>
                  <TableCell className="text-right font-medium">{formatNaira(p.amount)}</TableCell>
                  <TableCell><Badge variant="outline" className={p.status === "SUCCESS" ? "border-emerald-200 text-emerald-700" : "border-slate-200 text-slate-500"}>{p.status}</Badge></TableCell>
                  <TableCell className="text-xs">{p.verifiedAt ? new Date(p.verifiedAt).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {outstanding.length === 0 && data.subscription?.status === "ACTIVE" && (
        <p className="text-xs text-slate-400">No outstanding invoices. Renewal reminders arrive 30/14/7/1 days before expiry; a 7-day grace period follows, then operational access pauses while billing & data export stay available. Your data is never deleted.</p>
      )}

      {/* Payment dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay invoice {payDialog?.invoiceNumber}</DialogTitle>
            <DialogDescription>
              {payDialog?.mode === "MOCK_TEST_MODE"
                ? "TEST MODE: this simulates the Paystack checkout. The real flow (initialize → verify server-side → apply idempotently) runs when keys are configured."
                : "Complete the payment on Paystack, then return here — the server verifies before applying anything."}
            </DialogDescription></DialogHeader>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-xs text-slate-500">Amount due</p>
            <p className="text-2xl font-bold">{payDialog ? formatNaira(payDialog.amount) : ""}</p>
            <p className="mt-1 text-xs text-slate-400 font-mono">ref: {payDialog?.reference}</p>
          </div>
          <DialogFooter>
            {payDialog?.authorizationUrl && (
              <Button variant="outline" onClick={() => window.open(payDialog.authorizationUrl!, "_blank")}><ExternalLink className="h-4 w-4 mr-1" /> Open Paystack</Button>
            )}
            {payDialog?.mode === "MOCK_TEST_MODE" ? (
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleMockConfirm()}>Simulate successful payment (mock)</Button>
            ) : (
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void pollStatus()} disabled={polling}>{polling ? "Verifying…" : "I've paid — verify now"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
