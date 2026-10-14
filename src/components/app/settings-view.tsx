"use client";

import { useCallback, useState } from "react";
import { getBusinessSettings, saveBusinessSettings } from "@/server/actions/settings-actions";
import { changePassword } from "@/server/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { NIGERIAN_STATES } from "./states";
import Image from "next/image";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, Stagger } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";
import { Building2, ReceiptText, KeyRound } from "lucide-react";

type Settings = {
  name: string; businessType: string; state: string; address: string | null; phone: string | null; email: string | null;
  receiptHeader: string; receiptFooter: string; defaultTaxRate: number; expiryWarningDays: number;
  logoUrl: string | null; currency: string; timezone: string;
};

export function SettingsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });

  const load = useCallback(async () => {
    try {
      const s = (await getBusinessSettings(businessId)) as unknown as Settings;
      setSettings(s);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      await saveBusinessSettings({
        businessId,
        name: settings.name,
        state: settings.state,
        address: settings.address ?? undefined,
        phone: settings.phone ?? undefined,
        email: settings.email ?? "",
        receiptHeader: settings.receiptHeader,
        receiptFooter: settings.receiptFooter,
        defaultTaxRate: settings.defaultTaxRate,
        expiryWarningDays: settings.expiryWarningDays,
        logoUrl: settings.logoUrl,
      });
      toast({ title: "Settings saved", description: "Branding & receipt changes apply immediately." });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleChangePassword() {
    try {
      if (pw.next !== pw.confirm) throw new Error("New passwords do not match.");
      await changePassword(pw.current, pw.next);
      toast({ title: "Password changed" });
      setPw({ current: "", next: "", confirm: "" });
    } catch (err) {
      toast({ title: "Change failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  if (!settings) {
    return (
      <div className="max-w-3xl space-y-5">
        <PageHeader title="Business Settings" subtitle="Identity, branding and receipt configuration — changes are audit-logged." />
        <GlassCard className="p-5">
          <InlineLoading label="Loading settings" />
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Business Settings" subtitle="Identity, branding and receipt configuration — changes are audit-logged." />

      <Stagger className="space-y-5">
        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2 className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-[0.95rem] font-semibold leading-tight">Business identity</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">Shown on dashboards, receipts and reports.</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2 flex items-center gap-4">
              <Image src="/branding/synkisell-logo.png" alt="logo" width={64} height={35} className="rounded-lg border bg-background/70 p-1" />
              <div className="text-xs text-muted-foreground">Your logo is configurable per business — default SynkiSell branding shown. (Logo upload UI ships with the file-storage integration.)</div>
            </div>
            <div className="space-y-1 col-span-2"><Label>Business name</Label><Input value={settings.name} onChange={(e) => setSettings({ ...settings, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>Business type</Label><Input value={settings.businessType} disabled /></div>
            <div className="space-y-1">
              <Label>State</Label>
              <Select value={settings.state} onValueChange={(v) => setSettings({ ...settings, state: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{NIGERIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1 col-span-2"><Label>Address</Label><Input value={settings.address ?? ""} onChange={(e) => setSettings({ ...settings, address: e.target.value })} /></div>
            <div className="space-y-1"><Label>Phone</Label><Input value={settings.phone ?? ""} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>Email</Label><Input value={settings.email ?? ""} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></div>
            <div className="space-y-1"><Label>Currency</Label><Input value={settings.currency} disabled /></div>
            <div className="space-y-1"><Label>Timezone</Label><Input value={settings.timezone} disabled /></div>
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="text-[0.95rem] font-semibold leading-tight">Receipts &amp; operational rules</h3>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2"><Label>Receipt header</Label><Input value={settings.receiptHeader} onChange={(e) => setSettings({ ...settings, receiptHeader: e.target.value })} /></div>
            <div className="space-y-1 col-span-2"><Label>Receipt footer</Label><Input value={settings.receiptFooter} onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })} /></div>
            <div className="space-y-1"><Label>Default tax rate %</Label><Input type="number" value={settings.defaultTaxRate} onChange={(e) => setSettings({ ...settings, defaultTaxRate: Number(e.target.value) })} /><p className="text-[11px] text-muted-foreground/70">Configurable — review applicable Nigerian tax rules for your business.</p></div>
            <div className="space-y-1"><Label>Expiry warning window (days)</Label><Input type="number" value={settings.expiryWarningDays} onChange={(e) => setSettings({ ...settings, expiryWarningDays: Number(e.target.value) })} /></div>
          </div>
        </GlassCard>

        <div className="flex justify-end">
          <Button onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
        </div>

        <GlassCard className="p-5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </span>
            <h3 className="text-[0.95rem] font-semibold leading-tight">Your password</h3>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="space-y-1"><Label>Current</Label><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
            <div className="space-y-1"><Label>New</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
            <div className="space-y-1"><Label>Confirm new</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
            <div className="col-span-3 flex justify-end"><Button variant="outline" onClick={() => void handleChangePassword()} disabled={!pw.current || pw.next.length < 8}>Change password</Button></div>
          </div>
        </GlassCard>
      </Stagger>
    </div>
  );
}
