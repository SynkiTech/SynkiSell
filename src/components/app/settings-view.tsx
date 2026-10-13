"use client";

import { useCallback, useState } from "react";
import { getBusinessSettings, saveBusinessSettings } from "@/server/actions/settings-actions";
import { changePassword } from "@/server/actions/auth-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { NIGERIAN_STATES } from "./states";
import Image from "next/image";
import { useDataLoader } from "@/hooks/use-data-loader";

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

  if (!settings) return <p className="text-sm text-slate-400">Loading settings…</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Business Settings</h1>
        <p className="text-sm text-slate-500">Identity, branding and receipt configuration — changes are audit-logged.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Business identity</CardTitle>
          <CardDescription>Shown on dashboards, receipts and reports.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2 flex items-center gap-4">
            <Image src="/branding/synkisell-logo.png" alt="logo" width={64} height={35} className="rounded border p-1 bg-white" />
            <div className="text-xs text-slate-500">Your logo is configurable per business — default SynkiSell branding shown. (Logo upload UI ships with the file-storage integration.)</div>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Receipts & operational rules</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2"><Label>Receipt header</Label><Input value={settings.receiptHeader} onChange={(e) => setSettings({ ...settings, receiptHeader: e.target.value })} /></div>
          <div className="space-y-1 col-span-2"><Label>Receipt footer</Label><Input value={settings.receiptFooter} onChange={(e) => setSettings({ ...settings, receiptFooter: e.target.value })} /></div>
          <div className="space-y-1"><Label>Default tax rate %</Label><Input type="number" value={settings.defaultTaxRate} onChange={(e) => setSettings({ ...settings, defaultTaxRate: Number(e.target.value) })} /><p className="text-[11px] text-slate-400">Configurable — review applicable Nigerian tax rules for your business.</p></div>
          <div className="space-y-1"><Label>Expiry warning window (days)</Label><Input type="number" value={settings.expiryWarningDays} onChange={(e) => setSettings({ ...settings, expiryWarningDays: Number(e.target.value) })} /></div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleSave()} disabled={saving}>{saving ? "Saving…" : "Save settings"}</Button>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Your password</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          <div className="space-y-1"><Label>Current</Label><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
          <div className="space-y-1"><Label>New</Label><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></div>
          <div className="space-y-1"><Label>Confirm new</Label><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></div>
          <div className="col-span-3 flex justify-end"><Button variant="outline" onClick={() => void handleChangePassword()} disabled={!pw.current || pw.next.length < 8}>Change password</Button></div>
        </CardContent>
      </Card>
    </div>
  );
}
