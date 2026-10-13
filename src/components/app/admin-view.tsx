"use client";

import { useCallback, useState } from "react";
import { signOut } from "next-auth/react";
import Image from "next/image";
import { getPlatformOverview, adminListBusinesses, adminSetBusinessStatus, adminGrantComplimentaryDays, adminAdvanceDeployment, adminIssueInvoice, adminRecordManualPayment, adminCreateAnnouncement, adminRunReminderSweep, adminListWebhookEvents, adminListPlans, adminSavePlan, adminSavePricingConfig } from "@/server/actions/admin-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatNaira } from "@/lib/money";
import { LogOut, Building2, Rocket, FileText, Megaphone, RefreshCw, FlaskConical, Wallet } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type Overview = {
  mode: string;
  metrics: { businesses: number; activeSubscriptions: number; collectedRevenue: string; aiCalls30d: number };
  pendingDeployments: { id: string; business: string; state: string; stage: string; updatedAt: string }[];
  recentBusinesses: { id: string; name: string; state: string; businessType: string; status: string; createdAt: string; subscription: { status: string; plan: string; endDate: string | null } | null; staffCount: number }[];
  openInvoices: { id: string; number: string; businessId: string; business: string; total: { toString(): string }; status: string; issuedAt: string | null }[];
  announcements: { id: string; title: string; body: string; createdAt: string }[];
};

const DEPLOYMENT_STAGES = ["AWAITING_PAYMENT", "PAYMENT_CONFIRMED", "AWAITING_SETUP", "SETUP_IN_PROGRESS", "AWAITING_CUSTOMER_DATA", "READY_FOR_VERIFICATION", "LIVE"] as const;

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
    <div className="min-h-screen bg-slate-50">
      <header className="h-16 border-b bg-white flex items-center gap-3 px-4 sticky top-0 z-20">
        <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={56} height={30} />
        <div>
          <div className="font-semibold">SynkiSell Platform Console</div>
          <div className="text-xs text-slate-500">{userName} — SaaS administration</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {overview?.mode === "MOCK_TEST_MODE" && (
            <Badge variant="outline" className="border-teal-300 bg-teal-50 text-teal-700"><FlaskConical className="h-3 w-3 mr-1" /> Paystack mock mode</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => void act(() => adminRunReminderSweep(), "Renewal reminder sweep complete")}><RefreshCw className="h-3.5 w-3.5 mr-1" /> Run reminder sweep</Button>
          <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: "/" })}><LogOut className="h-4 w-4" /> Sign out</Button>
        </div>
      </header>

      <main className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
        {overview && (
          <div className="grid gap-3 md:grid-cols-4">
            <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Businesses</p><p className="text-2xl font-bold">{overview.metrics.businesses}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Active subscriptions</p><p className="text-2xl font-bold text-teal-700">{overview.metrics.activeSubscriptions}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-slate-500">Collected payments</p><p className="text-2xl font-bold">{overview.metrics.collectedRevenue}</p></CardContent></Card>
            <Card><CardContent className="p-4"><p className="text-xs text-slate-500">AI calls (30d)</p><p className="text-2xl font-bold">{overview.metrics.aiCalls30d}</p></CardContent></Card>
          </div>
        )}

        <Tabs defaultValue="businesses">
          <TabsList>
            <TabsTrigger value="businesses"><Building2 className="h-3.5 w-3.5 mr-1" /> Businesses</TabsTrigger>
            <TabsTrigger value="deployments"><Rocket className="h-3.5 w-3.5 mr-1" /> Deployments</TabsTrigger>
            <TabsTrigger value="invoices"><FileText className="h-3.5 w-3.5 mr-1" /> Invoices & payments</TabsTrigger>
            <TabsTrigger value="pricing">Plans & pricing</TabsTrigger>
            <TabsTrigger value="announcements"><Megaphone className="h-3.5 w-3.5 mr-1" /> Announcements</TabsTrigger>
          </TabsList>

          <TabsContent value="businesses" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[65vh]">
                  <Table>
                    <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Type</TableHead><TableHead>State</TableHead><TableHead>Staff</TableHead><TableHead>Subscription</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {(businesses ?? []).map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{b.name}<div className="text-xs text-slate-400">joined {new Date(b.createdAt).toLocaleDateString()}</div></TableCell>
                          <TableCell className="text-xs">{b.businessType}</TableCell>
                          <TableCell className="text-xs">{b.state}</TableCell>
                          <TableCell className="text-xs">{b._count.memberships}</TableCell>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deployments" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Business</TableHead><TableHead>Current stage</TableHead><TableHead>Advance to</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {overview?.pendingDeployments.map((d) => {
                      const idx = (DEPLOYMENT_STAGES as readonly string[]).indexOf(d.stage);
                      const next = DEPLOYMENT_STAGES[idx + 1];
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="font-medium">{d.business}<div className="text-xs text-slate-400">{d.state} • updated {new Date(d.updatedAt).toLocaleDateString()}</div></TableCell>
                          <TableCell><Badge variant="outline" className="border-teal-200 text-teal-700">{d.stage.replace(/_/g, " ")}</Badge></TableCell>
                          <TableCell>
                            {next && (
                              <Button size="sm" variant="outline" className="border-teal-200 text-teal-700" onClick={() => void act(() => adminAdvanceDeployment(d.id, next as (typeof DEPLOYMENT_STAGES)[number]), `Stage advanced to ${next}`)}>
                                → {next.replace(/_/g, " ")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!overview?.pendingDeployments.length && <TableRow><TableCell colSpan={3} className="text-center py-8 text-slate-400">All deployments are live. 🎉</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="invoices" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Open invoices</CardTitle><CardDescription>Issue invoices, record manual payments; provider payments verify server-side only.</CardDescription></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Invoice</TableHead><TableHead>Business</TableHead><TableHead className="text-right">Total</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {overview?.openInvoices.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-mono text-xs">{i.number}</TableCell>
                        <TableCell className="text-sm">{i.business}</TableCell>
                        <TableCell className="text-right font-semibold">{formatNaira(i.total)}</TableCell>
                        <TableCell><Badge variant="outline" className="border-amber-200 text-amber-700">{i.status}</Badge></TableCell>
                        <TableCell><Button size="sm" variant="outline" onClick={() => { setPaymentDialog({ invoiceId: i.id, number: i.number, businessId: i.businessId }); setPaymentForm({ amount: String(Number(i.total)), method: "TRANSFER", reference: `MAN-${Date.now()}` }); }}><Wallet className="h-3.5 w-3.5 mr-1" /> Record payment</Button></TableCell>
                      </TableRow>
                    ))}
                    {!overview?.openInvoices.length && <TableRow><TableCell colSpan={5} className="text-center py-8 text-slate-400">No open invoices.</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pricing" className="mt-4 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Pricing configuration</CardTitle><CardDescription>Stored in the database — change prices without touching code. These are defaults for NEW invoices.</CardDescription></CardHeader>
              <CardContent className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label>Deployment fee (₦)</Label><Input value={pricingForm?.deploymentFee ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, deploymentFee: e.target.value } : null)} inputMode="decimal" /></div>
                <div className="space-y-1"><Label>Annual subscription (₦)</Label><Input value={pricingForm?.annualSubscriptionFee ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, annualSubscriptionFee: e.target.value } : null)} inputMode="decimal" /></div>
                <div className="space-y-1"><Label>Grace period (days)</Label><Input value={pricingForm?.gracePeriodDays ?? ""} onChange={(e) => setPricingForm(pricingForm ? { ...pricingForm, gracePeriodDays: e.target.value } : null)} inputMode="numeric" /></div>
                <div className="col-span-3 flex justify-end">
                  <Button className="bg-teal-600 hover:bg-teal-700" disabled={!pricingForm} onClick={() => void act(() => adminSavePricingConfig({ deploymentFee: Number(pricingForm!.deploymentFee), annualSubscriptionFee: Number(pricingForm!.annualSubscriptionFee), gracePeriodDays: Number(pricingForm!.gracePeriodDays), reminderDaysBefore: [30, 14, 7, 1] }), "Pricing saved")}>
                    Save pricing
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Plans</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader><TableRow><TableHead>Plan</TableHead><TableHead className="text-right">Annual</TableHead><TableHead className="text-right">Deployment</TableHead><TableHead className="text-right">Terminals</TableHead><TableHead className="text-right">AI limit/mo</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {(plansData?.plans ?? []).map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="text-right">{formatNaira(p.annualFee)}</TableCell>
                        <TableCell className="text-right">{formatNaira(p.deploymentFee)}</TableCell>
                        <TableCell className="text-right">{p.maxTerminals}</TableCell>
                        <TableCell className="text-right">{p.aiMonthlyLimit}</TableCell>
                        <TableCell><Badge variant="outline" className={p.isActive ? "border-emerald-200 text-emerald-700" : ""}>{p.isActive ? "active" : "hidden"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="announcements" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Broadcast an announcement</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1"><Label>Title</Label><Input value={announcement.title} onChange={(e) => setAnnouncement({ ...announcement, title: e.target.value })} /></div>
                <div className="space-y-1"><Label>Body</Label><Textarea rows={3} value={announcement.body} onChange={(e) => setAnnouncement({ ...announcement, body: e.target.value })} /></div>
                <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void act(() => adminCreateAnnouncement(announcement.title, announcement.body), "Announcement published").then(() => setAnnouncement({ title: "", body: "" }))} disabled={announcement.title.length < 3 || announcement.body.length < 3}>Publish</Button>
              </CardContent>
            </Card>
            {overview?.announcements.map((a) => (
              <Card key={a.id}><CardContent className="p-4"><p className="font-medium">{a.title}</p><p className="text-sm text-slate-600">{a.body}</p><p className="text-xs text-slate-400 mt-1">{new Date(a.createdAt).toLocaleString()}</p></CardContent></Card>
            ))}
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
            <Button className="bg-teal-600" onClick={() => void act(() => adminIssueInvoice(invoiceDialog!.businessId, invoiceKind as "DEPLOYMENT" | "SUBSCRIPTION" | "MIXED" | "CUSTOM"), "Invoice issued").then(() => setInvoiceDialog(null))}>Issue invoice</Button>
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
            <Button className="bg-teal-600" onClick={() => void act(() => adminRecordManualPayment(paymentDialog!.businessId, paymentDialog!.invoiceId, Number(paymentForm.amount), paymentForm.method, paymentForm.reference), "Payment verified & applied").then(() => setPaymentDialog(null))}>Verify & apply</Button>
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
            <Button className="bg-teal-600" onClick={() => void act(() => adminGrantComplimentaryDays(compDialog!.businessId, Number(compForm.days), compForm.reason), "Extension granted").then(() => setCompDialog(null))} disabled={compForm.reason.length < 5}>Grant</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
