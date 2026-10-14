"use client";

import { useCallback, useState } from "react";
import { getBillingOverview, startInvoicePayment, mockConfirmPayment, checkPaymentStatus } from "@/server/actions/billing-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { CreditCard, FlaskConical, ShieldCheck, CalendarClock, ExternalLink, FileText, Wallet } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, Stagger, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";

type Overview = {
  mode: "LIVE_KEYS" | "MOCK_TEST_MODE";
  subscription: { status: string; plan: string; annualFee: { toString(): string }; startDate: string | null; endDate: string | null; graceEndDate: string | null; autoRenew: boolean; daysLeft: number | null } | null;
  deployment: { stage: string; feeAmount: { toString(): string }; completedAt: string | null } | null;
  invoices: { id: string; number: string; kind: string; status: string; total: { toString(): string }; issuedAt: string | null; paidAt: string | null; lines: { kind: string; description: string; amount: { toString(): string } }[] }[];
  payments: { id: string; reference: string; method: string; amount: { toString(): string }; status: string; provider: string; createdAt: string; verifiedAt: string | null }[];
  pricing: Record<string, unknown> | null;
  reminders: { title: string; body: string; severity: string; createdAt: string }[];
};

/* Card header row inside a GlassCard (title + optional trailing element) */
function CardHeaderRow({ title, sub, icon: Icon }: { title: string; sub?: string; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[0.95rem] font-semibold leading-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {Icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground"><Icon className="h-4 w-4" /></span>}
    </div>
  );
}

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

  if (!data) return <InlineLoading label="Loading billing" />;

  const sub = data.subscription;
  const outstanding = data.invoices.filter((i) => i.status === "ISSUED" || i.status === "DRAFT");

  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title="Subscription & Billing"
        subtitle="Deployment fee and annual subscription are separate charges — the deployment fee never repeats at renewal."
      />

      {data.mode === "MOCK_TEST_MODE" && (
        <FadeIn>
          <Alert className="border-primary/30 bg-primary/10">
            <FlaskConical className="h-4 w-4 text-primary" />
            <AlertTitle className="text-primary">Paystack test mode (mock)</AlertTitle>
            <AlertDescription className="text-primary/90">
              No Paystack API keys are configured, so payments run through a clearly-labelled mock provider. The full flow — initialize → verify → idempotent application → subscription activation — is real code; only the HTTP call to Paystack is simulated. Configure <code className="text-xs">PAYSTACK_SECRET_KEY</code> to go live.
            </AlertDescription>
          </Alert>
        </FadeIn>
      )}

      {/* Current plan / deployment / pilot pricing */}
      <Stagger className="grid gap-4 md:grid-cols-3">
        <GlassCard intensity="strong" hover className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: "var(--grad-brand)" }} aria-hidden="true" />
          <div className="p-5">
            <CardHeaderRow title="Subscription" icon={CalendarClock} />
            <div className="mt-3">
              {sub ? (
                <>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={sub.status === "ACTIVE" ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"}>{sub.status}</Badge>
                    <span className="text-sm font-medium">{sub.plan}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> {sub.endDate ? `Renews ${new Date(sub.endDate).toLocaleDateString()}` : "Awaiting first payment"}{sub.daysLeft !== null && sub.daysLeft >= 0 ? ` (${sub.daysLeft} days)` : ""}</p>
                  <p className="text-xs text-muted-foreground/80">Annual fee <span className="font-medium tabular-nums">{formatNaira(sub.annualFee)}</span></p>
                </>
              ) : <p className="text-sm text-muted-foreground">No subscription</p>}
            </div>
          </div>
        </GlassCard>

        <GlassCard hover className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 opacity-80" style={{ background: "var(--grad-ice)" }} aria-hidden="true" />
          <div className="p-5">
            <CardHeaderRow title="Deployment" icon={CreditCard} />
            <div className="mt-3">
              {data.deployment ? (
                <>
                  <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{data.deployment.stage.replace(/_/g, " ")}</Badge>
                  <p className="mt-2 text-xs text-muted-foreground">One-time fee <span className="font-medium tabular-nums">{formatNaira(data.deployment.feeAmount)}</span></p>
                  {data.deployment.completedAt && <p className="text-xs text-muted-foreground/80">Completed {new Date(data.deployment.completedAt).toLocaleDateString()}</p>}
                </>
              ) : <p className="text-sm text-muted-foreground">No deployment order</p>}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="relative overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-1 opacity-70" style={{ background: "var(--grad-silver)" }} aria-hidden="true" />
          <div className="p-5">
            <CardHeaderRow title="Pilot pricing" icon={ShieldCheck} />
            <div className="mt-3 space-y-0.5 text-xs text-muted-foreground">
              {data.pricing && (
                <>
                  <p>Deployment: <span className="font-medium tabular-nums">₦{Number(data.pricing.deploymentFee).toLocaleString()}</span></p>
                  <p>Annual subscription: <span className="font-medium tabular-nums">₦{Number(data.pricing.annualSubscriptionFee).toLocaleString()}</span></p>
                  <p>Grace period: {String(data.pricing.gracePeriodDays)} days</p>
                </>
              )}
            </div>
          </div>
        </GlassCard>
      </Stagger>

      {data.reminders.length > 0 && (
        <FadeIn>
          <GlassCard intensity="subtle" className="border-amber-400/50 p-4">
            <div className="space-y-1.5">
              {data.reminders.map((r, i) => (
                <div key={i} className="flex gap-2 text-sm">
                  <ShieldCheck className={`h-4 w-4 shrink-0 ${r.severity === "CRITICAL" ? "text-red-500" : "text-amber-500"}`} />
                  <div><span className="font-medium">{r.title}</span> — <span className="text-muted-foreground">{r.body}</span></div>
                </div>
              ))}
            </div>
          </GlassCard>
        </FadeIn>
      )}

      {/* Invoices */}
      <FadeIn>
        <GlassCard className="overflow-hidden">
          <div className="px-5 pt-4">
            <CardHeaderRow title="Invoices" sub="The first invoice itemises deployment and subscription as separate lines." icon={FileText} />
          </div>
          {data.invoices.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={FileText} title="No invoices yet" hint="Your deployment and subscription invoices will appear here once issued." className="border-0" />
            </div>
          ) : (
            <div className="px-5 pb-4 pt-3">
              <Table>
                <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Kind</TableHead><TableHead>Lines</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {data.invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs">{inv.number}<div className="text-muted-foreground">{inv.issuedAt ? new Date(inv.issuedAt).toLocaleDateString() : ""}</div></TableCell>
                      <TableCell className="text-sm">{inv.kind}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{inv.lines.map((l) => `${l.description} — ${formatNaira(l.amount)}`).join(" • ")}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatNaira(inv.total)}</TableCell>
                      <TableCell><Badge variant="outline" className={inv.status === "PAID" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}>{inv.status}</Badge></TableCell>
                      <TableCell>
                        {(inv.status === "ISSUED" || inv.status === "DRAFT") && (
                          <Button size="sm" onClick={() => void handlePay(inv.id, inv.number, inv.total.toString())}>
                            <CreditCard className="h-3.5 w-3.5 mr-1" /> Pay {formatNaira(inv.total)}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </GlassCard>
      </FadeIn>

      {/* Payment history */}
      <FadeIn>
        <GlassCard className="overflow-hidden">
          <div className="px-5 pt-4">
            <CardHeaderRow title="Payment history" icon={Wallet} />
          </div>
          {data.payments.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={Wallet} title="No payments recorded yet" hint="Verified Paystack and manual payments will be listed here." className="border-0" />
            </div>
          ) : (
            <div className="px-5 pb-4 pt-3">
              <Table>
                <TableHeader><TableRow><TableHead>Reference</TableHead><TableHead>Provider</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Verified</TableHead></TableRow></TableHeader>
                <TableBody>
                  {data.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.provider}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.method}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{formatNaira(p.amount)}</TableCell>
                      <TableCell><Badge variant="outline" className={p.status === "SUCCESS" ? "border-emerald-200 text-emerald-700" : "border-border text-muted-foreground"}>{p.status}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{p.verifiedAt ? new Date(p.verifiedAt).toLocaleString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </GlassCard>
      </FadeIn>

      {outstanding.length === 0 && data.subscription?.status === "ACTIVE" && (
        <FadeIn>
          <p className="text-xs text-muted-foreground">No outstanding invoices. Renewal reminders arrive 30/14/7/1 days before expiry; a 7-day grace period follows, then operational access pauses while billing & data export stay available. Your data is never deleted.</p>
        </FadeIn>
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
          <div className="glass-subtle rounded-xl p-4 text-center">
            <p className="text-xs text-muted-foreground">Amount due</p>
            <p className="text-2xl font-bold tabular-nums">{payDialog ? formatNaira(payDialog.amount) : ""}</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground/70">ref: {payDialog?.reference}</p>
          </div>
          <DialogFooter>
            {payDialog?.authorizationUrl && (
              <Button variant="outline" onClick={() => window.open(payDialog.authorizationUrl!, "_blank")}><ExternalLink className="h-4 w-4 mr-1" /> Open Paystack</Button>
            )}
            {payDialog?.mode === "MOCK_TEST_MODE" ? (
              <Button onClick={() => void handleMockConfirm()}>Simulate successful payment (mock)</Button>
            ) : (
              <Button onClick={() => void pollStatus()} disabled={polling}>{polling ? "Verifying…" : "I've paid — verify now"}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
