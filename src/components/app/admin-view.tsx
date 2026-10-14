"use client";

import { useCallback, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { getPlatformOverview, adminListBusinesses, adminSetBusinessStatus, adminGrantComplimentaryDays, adminAdvanceDeployment, adminIssueInvoice, adminRecordManualPayment, adminCreateAnnouncement, adminRunReminderSweep, adminListWebhookEvents, adminListPlans, adminSavePlan, adminSavePricingConfig } from "@/server/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { LogOut, Building2, Rocket, FileText, Megaphone, RefreshCw, FlaskConical, Wallet, BadgeCheck, Sparkles } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, Stagger, FadeIn } from "./ui/primitives";
import { KpiCard } from "./ui/kpi-card";
import { InlineLoading } from "./ui/loading";

type Overview = {
  mode: string;
  metrics: { businesses: number; activeSubscriptions: number; collectedRevenue: string; aiCalls30d: number };
  pendingDeployments: { id: string; business: string; state: string; stage: string; updatedAt: string }[];
  recentBusinesses: { id: string; name: string; state: string; businessType: string; status: string; createdAt: string; subscription: { status: string; plan: string; endDate: string | null } | null; staffCount: number }[];
  openInvoices: { id: string; number: string; businessId: string; business: string; total: { toString(): string }; status: string; issuedAt: string | null }[];
  announcements: { id: string; title: string; body: string; createdAt: string }[];
};

const DEPLOYMENT_STAGES = ["AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "AWAITING_SETUP", "SETUP_IN_PROGRESS", "AWAITING_CUSTOMER_DATA", "READY_FOR_VERIFICATION", "LIVE"] as const;

/* Card header row inside a GlassCard table panel */
function PanelHeader({ title, sub, trailing }: { title: string; sub?: string; trailing?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
      <div className="min-w-0">
        <h3 className="text-[0.95rem] font-semibold leading-tight">{title}</h3>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
      </div>
      {trailing}
    </div>
  );
}

export function AdminConsole({ userName, onSignOut }: { userName: string; onSignOut: () => void }) {
  const { toast } = useToast();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [businesses, setBusinesses] = useState<Awaited<ReturnType<typeof adminListBusinesses>> | null>(null);
  const [plansData, setPlansData] = useState<Awaited<ReturnType<typeof adminListPlans>> | null>(null);
  const [pricingForm, setPricingForm] = useState<{ deploymentFee: string; annualSubscriptionFee: string; gracePeriodDays: string } | null>(null);
  const [announcement, setAnnouncement] = useState({ title: "", body: "" });
  const [invoiceDialog, setInvoiceDialog] = useState<{ businessId: string; businessName: string } | null>(null);
  const [invoiceKind, setInvoiceKind] = useState("MIXED");
  const [paymentDialog, setPaymentDialog] = useState<{ invoiceId: string; number: string; businessId: string } | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", method: "TRANSFER", reference: "" });
  const [compDialog, setCompDialog] = useState<{ businessId: string; name: string } | null>(null);
  const [compForm, setCompForm] = useState({ days: "14", reason: "" });

  const load = useCallback(async () => {
    try {
      const [o, b, p] = await Promise.all([
        getPlatformOverview() as unknown as Promise<Overview>,
        adminListBusinesses() as unknown as Awaited<ReturnType<typeof adminListBusinesses>>,
        adminListPlans() as unknown as Awaited<ReturnType<typeof adminListPlans>>,
      ]);
      setOverview(o);
      setBusinesses(b);
      setPlansData(p);
      if (p.pricing) {
        setPricingForm({
          deploymentFee: String(p.pricing.deploymentFee ?? ""),
          annualSubscriptionFee: String(p.pricing.annualSubscriptionFee ?? ""),
          gracePeriodDays: String(p.pricing.gracePeriodDays ?? 7),
        });
      }
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [toast]);

  useDataLoader(load, [load]);

  async function act(fn: () => Promise<unknown>, title: string) {
    try {
      await fn();
      toast({ title });
      void load();
    } catch (err) {
      toast({ title: "Action failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="relative min-h-screen">
      <div className="ambient-scene" aria-hidden="true" />

      {/* Glass header — platform identity + honest mode disclosure */}
      <header className="glass-strong sticky top-0 z-20">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-6">
          <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={56} height={30} />
          <div>
            <div className="font-semibold">SynkiSell Platform Console</div>
            <div className="text-xs text-muted-foreground">{userName} — SaaS administration</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {overview?.mode === "MOCK_TEST_MODE" && (
              <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary"><FlaskConical className="h-3 w-3 mr-1" /> Paystack mock mode</Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => void act(() => adminRunReminderSweep(), "Renewal reminder sweep complete")}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Run reminder sweep</Button>
            <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}><LogOut className="h-4 w-4" /> Sign out</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        <PageHeader
          title="Platform overview"
          subtitle="Businesses, deployments, billing and broadcasts across every workspace"
        />

        {/* Platform metrics */}
        {overview ? (
          <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              title="Businesses"
              value={Number(String(overview.metrics.businesses))}
              format="number"
              icon={Building2}
              sub="registered workspaces"
            />
            <KpiCard
              title="Active subscriptions"
              value={Number(String(overview.metrics.activeSubscriptions))}
              format="number"
              icon={BadgeCheck}
              tone="brand"
              sub="status ACTIVE"
            />
            <KpiCard
              title="Collected payments"
              value={Number(String(overview.metrics.collectedRevenue))}
              format="naira"
              icon={Wallet}
              tone="positive"
              sub="verified payments, all time"
            />
            <KpiCard
              title="AI calls (30d)"
              value={Number(String(overview.metrics.aiCalls30d))}
              format="number"
              icon={Sparkles}
              sub="metered usage"
            />
          </Stagger>
        ) : (
          <InlineLoading label="Loading platform metrics" />
        )}

        <Tabs defaultValue="businesses">
          <TabsList>
            <TabsTrigger value="businesses"><Building2 className="h-3.5 w-3.5 mr-1" /> Businesses</TabsTrigger>
            <TabsTrigger value="deployments"><Rocket className="h-3.5 w-3.5 mr-1" /> Deployments</TabsTrigger>
            <TabsTrigger value="invoices"><FileText className="h-3.5 w-3.5 mr-1" /> Invoices &amp; payments</TabsTrigger>
            <TabsTrigger value="pricing">Plans &amp; pricing</TabsTrigger>
            <TabsTrigger value="announcements"><Megaphone className="h-3.5 w-3.5 mr-1" /> Announcements</TabsTrigger>
          </TabsList>

          <TabsContent value="businesses" className="mt-4">
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <PanelHeader title="All businesses" sub="Newest first" trailing={businesses ? <Badge variant="outline">{businesses.length}</Badge> : undefined} />
                {!businesses ? (
                  <InlineLoading label="Loading businesses" />
                ) : businesses.length === 0 ? (
                  <div className="p-5">
                    <EmptyState icon={Building2} title="No businesses yet" hint="Registered workspaces will appear here." className="border-0" />
                  </div>
                ) : (
                  <div className="px-5 pb-4 pt-3">
                    <ScrollArea className="max-h-[65vh]">
                      <Table>
                        <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Type</TableHead><TableHead>State</TableHead><TableHead>Staff</TableHead><TableHead>Subscription</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                        <TableBody>
                          {businesses.map((b) => (
                            <TableRow key={b.id}>
                              <TableCell className="font-medium">{b.name}<div className="text-xs text-muted-foreground">joined {new Date(b.createdAt).toLocaleDateString()}</div></TableCell>
                              <TableCell className="text-xs text-muted-foreground">{b.businessType}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{b.state}</TableCell>
                              <TableCell className="text-xs tabular-nums">{b._count.memberships}</TableCell>
                              <TableCell className="text-xs">
                                {b.subscription ? (
                                  <><Badge variant="outline" className={b.subscription.status === "ACTIVE" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}>{b.subscription.status}</Badge> {b.subscription.plan?.name}</>
                                ) : "—"}
                              </TableCell>
                              <TableCell><Badge variant="outline" className={b.status === "ACTIVE" ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-600"}>{b.status}</Badge></TableCell>
                              <TableCell className="space-x-1 whitespace-nowrap">
                                <Button size="sm" variant="ghost" onClick={() => setInvoiceDialog({ businessId: b.id, businessName: b.name })}>Invoice</Button>
                                <Button size="sm" variant="ghost" onClick={() => setCompDialog({ businessId: b.id, name: b.name })}>Extend</Button>
                                <Button size="sm" variant={b.status === "ACTIVE" ? "ghost" : "outline"} className={b.status === "ACTIVE" ? "text-red-500" : "text-emerald-700"} onClick={() => void act(() => adminSetBusinessStatus(b.id, b.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"), "Business status updated")}>
                                  {b.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </div>
                )}
              </GlassCard>
            </FadeIn>
          </TabsContent>

          <TabsContent value="deployments" className="mt-4">
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <PanelHeader title="Deployment pipeline" sub="Non-live deployment orders — advance one stage at a time" />
                <div className="px-5 pb-4 pt-3">
                  <Table>
                    <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Current stage</TableHead><TableHead>Advance to</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {overview?.pendingDeployments.map((d) => {
                        const idx = (DEPLOYMENT_STAGES as readonly string[]).indexOf(d.stage);
                        const next = DEPLOYMENT_STAGES[idx + 1];
                        return (
                          <TableRow key={d.id}>
                            <TableCell className="font-medium">{d.business}<div className="text-xs text-muted-foreground">{d.state} • updated {new Date(d.updatedAt).toLocaleDateString()}</div></TableCell>
                            <TableCell><Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{d.stage.replace(/_/g, " ")}</Badge></TableCell>
                            <TableCell>
                              {next && (
                                <Button size="sm" variant="outline" className="border-primary/30 text-primary" onClick={() => void act(() => adminAdvanceDeployment(d.id, next as (typeof DEPLOYMENT_STAGES)[number]), `Stage advanced to ${next}`)}>
                                  → {next.replace(/_/g, " ")}
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {overview && !overview.pendingDeployments.length && (
                        <TableRow><TableCell colSpan={3}><EmptyState icon={Rocket} title="All deployments are live. 🎉" className="border-0" /></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </GlassCard>
            </FadeIn>
          </TabsContent>

          <TabsContent value="invoices" className="mt-4 space-y-4">
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <PanelHeader title="Open invoices" sub="Issue invoices, record manual payments; provider payments verify server-side only." />
                <div className="px-5 pb-4 pt-3">
                  <Table>
                    <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Business</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {overview?.openInvoices.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell className="font-mono text-xs">{i.number}</TableCell>
                          <TableCell className="text-sm">{i.business}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">{formatNaira(i.total)}</TableCell>
                          <TableCell><Badge variant="outline" className="border-amber-200 text-amber-700">{i.status}</Badge></TableCell>
                          <TableCell><Button size="sm" variant="outline" onClick={() => { setPaymentDialog({ invoiceId: i.id, number: i.number, businessId: i.businessId }); setPaymentForm({ amount: String(Number(i.total)), method: "TRANSFER", reference: `MAN-${Date.now()}` }); }}><Wallet className="h-3.5 w-3.5 mr-1" /> Record payment</Button></TableCell>
                        </TableRow>
                      ))}
                      {overview && !overview.openInvoices.length && (
                        <TableRow><TableCell colSpan={5}><EmptyState icon={FileText} title="No open invoices." className="border-0" /></TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </GlassCard>
            </FadeIn>
          </TabsContent>

          <TabsContent value="pricing" className="mt-4 space-y-4">
            <FadeIn>
              <GlassCard>
                <PanelHeader title="Pricing configuration" sub="Stored in the database — change prices without touching code. These are defaults for NEW invoices." />
                <div className="grid grid-cols-3 gap-3 p-5">
                  <div className="space-y-1"><Label>Deployment fee (₦)</Label><Input value={pricingForm?.deploymentFee ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, deploymentFee: e.target.value } : null)} inputMode="decimal" /></div>
                  <div className="space-y-1"><Label>Annual subscription (₦)</Label><Input value={pricingForm?.annualSubscriptionFee ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, annualSubscriptionFee: e.target.value } : null)} inputMode="decimal" /></div>
                  <div className="space-y-1"><Label>Grace period (days)</Label><Input value={pricingForm?.gracePeriodDays ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, gracePeriodDays: e.target.value } : null)} inputMode="numeric" /></div>
                  <div className="col-span-3 flex justify-end">
                    <Button disabled={!pricingForm} onClick={() => void act(() => adminSavePricingConfig({ deploymentFee: Number(pricingForm!.deploymentFee), annualSubscriptionFee: Number(pricingForm!.annualSubscriptionFee), gracePeriodDays: Number(pricingForm!.gracePeriodDays), reminderDaysBefore: [30, 14, 7, 1] }), "Pricing saved")}>
                      Save pricing
                    </Button>
                  </div>
                </div>
              </GlassCard>
            </FadeIn>

            <FadeIn>
              <GlassCard className="overflow-hidden">
                <PanelHeader title="Plans" sub="Subscription tiers offered to new businesses" />
                <div className="px-5 pb-4 pt-3">
                  <Table>
                    <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead className="text-right">Annual</TableHead><TableHead className="text-right">Deployment</TableHead><TableHead className="text-right">Terminals</TableHead><TableHead className="text-right">AI limit/mo</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {(plansData?.plans ?? []).map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNaira(p.annualFee)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNaira(p.deploymentFee)}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.maxTerminals}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.aiMonthlyLimit}</TableCell>
                          <TableCell><Badge variant="outline" className={p.isActive ? "border-emerald-200 text-emerald-700" : ""}>{p.isActive ? "active" : "hidden"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </GlassCard>
            </FadeIn>
          </TabsContent>

          <TabsContent value="announcements" className="mt-4 space-y-4">
            <FadeIn>
              <GlassCard>
                <PanelHeader title="Broadcast an announcement" sub="Shown as a banner inside every business workspace" />
                <div className="space-y-3 p-5">
                  <div className="space-y-1"><Label>Title</Label><Input value={announcement.title} onChange={(e) => setAnnouncement({ ...announcement, title: e.target.value })} /></div>
                  <div className="space-y-1"><Label>Body</Label><Textarea rows={3} value={announcement.body} onChange={(e) => setAnnouncement({ ...announcement, body: e.target.value })} /></div>
                  <Button onClick={() => void act(() => adminCreateAnnouncement(announcement.title, announcement.body), "Announcement published").then(() => setAnnouncement({ title: "", body: "" }))} disabled={announcement.title.length < 3 || announcement.body.length < 3}>Publish</Button>
                </div>
              </GlassCard>
            </FadeIn>
            {overview && overview.announcements.length > 0 && (
              <Stagger className="space-y-3">
                {overview.announcements.map((a) => (
                  <GlassCard key={a.id} intensity="subtle" className="p-4">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-sm text-muted-foreground">{a.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground/70">{new Date(a.createdAt).toLocaleString()}</p>
                  </GlassCard>
                ))}
              </Stagger>
            )}
          </TabsContent>
        </Tabs>
      </main>

      {/* Invoice dialog */}
      <Dialog open={!!invoiceDialog} onOpenChange={(o) => !o && setInvoiceDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Issue invoice — {invoiceDialog?.businessName}</DialogTitle>
            <DialogDescription>MIXED itemises deployment (once) + annual subscription as separate lines.</DialogDescription></DialogHeader>
          <div className="space-y-1">
            <Label>Invoice kind</Label>
            <Select value={invoiceKind} onValueChange={setInvoiceKind}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="MIXED">MIXED (deployment + first subscription)</SelectItem>
                <SelectItem value="SUBSCRIPTION">SUBSCRIPTION (renewal)</SelectItem>
                <SelectItem value="DEPLOYMENT">DEPLOYMENT only</SelectItem>
                <SelectItem value="CUSTOM">CUSTOM (₦0 — adjust lines via support)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialog(null)}>Cancel</Button>
            <Button onClick={() => void act(() => adminIssueInvoice(invoiceDialog!.businessId, invoiceKind as "DEPLOYMENT" | "SUBSCRIPTION" | "MIXED" | "CUSTOM"), "Invoice issued").then(() => setInvoiceDialog(null))}>Issue invoice</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={!!paymentDialog} onOpenChange={(o) => !o && setPaymentDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Record manual payment — {paymentDialog?.number}</DialogTitle>
            <DialogDescription>Manual payments are verified immediately and audit-logged under your admin account. Duplicate references are ignored (idempotent).</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Amount (₦)</Label><Input value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Method</Label><Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="CASH">Cash</SelectItem><SelectItem value="TRANSFER">Transfer</SelectItem><SelectItem value="CARD">Card</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label>Reference</Label><Input value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialog(null)}>Cancel</Button>
            <Button onClick={() => void act(() => adminRecordManualPayment(paymentDialog!.businessId, paymentDialog!.invoiceId, Number(paymentForm.amount), paymentForm.method, paymentForm.reference), "Payment verified & applied").then(() => setPaymentDialog(null))}>Verify &amp; apply</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Complimentary extension dialog */}
      <Dialog open={!!compDialog} onOpenChange={(o) => !o && setCompDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Grant complimentary extension — {compDialog?.name}</DialogTitle>
            <DialogDescription>Extends the subscription and reactivates the business. Always audit-logged with your reason.</DialogDescription></DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Days</Label><Input value={compForm.days} onChange={(e) => setCompForm({ ...compForm, days: e.target.value })} inputMode="numeric" /></div>
            <div className="space-y-1 col-span-2"><Label>Reason (required)</Label><Input value={compForm.reason} onChange={(e) => setCompForm({ ...compForm, reason: e.target.value })} placeholder="e.g. Pilot goodwill — onboarding delay" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompDialog(null)}>Cancel</Button>
            <Button onClick={() => void act(() => adminGrantComplimentaryDays(compDialog!.businessId, Number(compForm.days), compForm.reason), "Extension granted").then(() => setCompDialog(null))} disabled={compForm.reason.length < 5}>Grant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
