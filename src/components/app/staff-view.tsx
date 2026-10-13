"use client";

import { useCallback, useState } from "react";
import { listStaff, saveStaff, setStaffActive, resetStaffPassword, listAuditEvents } from "@/server/actions/staff-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, KeyRound } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type StaffRow = {
  id: string; role: string; isActive: boolean;
  user: { name: string; email: string; phone: string | null; lastLoginAt: string | null; isActive: boolean };
};
type AuditRow = { id: string; action: string; actorLabel: string; entityType: string; entityId: string | null; reason: string | null; createdAt: string; metaJson: string | null };

const ROLES = ["MANAGER", "CASHIER", "INVENTORY_MANAGER", "PHARMACIST", "ACCOUNTANT"];

export function StaffView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", role: "CASHIER", phone: "", tempPassword: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<StaffRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([
        listStaff(businessId) as unknown as Promise<StaffRow[]>,
        listAuditEvents(businessId, 80) as unknown as Promise<AuditRow[]>,
      ]);
      setStaff(s);
      setAudit(a);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handleSave() {
    try {
      const result = (await saveStaff({
        businessId, id: editingId ?? undefined, name: form.name, email: form.email,
        role: form.role, phone: form.phone || undefined,
        tempPassword: form.tempPassword || undefined,
      })) as unknown as { tempPassword: string | null };
      setTempPassword(result.tempPassword);
      toast({ title: editingId ? "Staff updated" : "Staff added", description: `${form.name} (${form.role})` });
      if (!result.tempPassword) setDialogOpen(false);
      void load();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleToggle(s: StaffRow) {
    try {
      await setStaffActive(businessId, s.id, !s.isActive);
      toast({ title: s.isActive ? "Staff deactivated — effective immediately" : "Staff reactivated" });
      void load();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleReset() {
    if (!resetTarget) return;
    try {
      await resetStaffPassword(businessId, resetTarget.id, newPassword);
      toast({ title: "Password reset", description: resetTarget.user.email });
      setResetTarget(null);
      setNewPassword("");
    } catch (err) {
      toast({ title: "Reset failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff & Audit</h1>
          <p className="text-sm text-slate-500">Role-based permissions enforced on the server — hiding menus is never the security control.</p>
        </div>
        <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => { setEditingId(null); setForm({ name: "", email: "", role: "CASHIER", phone: "", tempPassword: "" }); setTempPassword(null); setDialogOpen(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add staff
        </Button>
      </div>

      <Tabs defaultValue="staff">
        <TabsList><TabsTrigger value="staff">Staff ({staff.length})</TabsTrigger><TabsTrigger value="audit">Audit log ({audit.length})</TabsTrigger></TabsList>

        <TabsContent value="staff" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Last login</TableHead><TableHead>Active</TableHead><TableHead /></TableRow></TableHeader>
                <TableBody>
                  {staff.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.user.name}</TableCell>
                      <TableCell className="text-sm">{s.user.email}</TableCell>
                      <TableCell><Badge variant="outline" className={s.role === "OWNER" ? "border-teal-200 text-teal-700" : ""}>{s.role.replace("_", " ")}</Badge></TableCell>
                      <TableCell className="text-xs">{s.user.lastLoginAt ? new Date(s.user.lastLoginAt).toLocaleString() : "never"}</TableCell>
                      <TableCell>
                        {s.role === "OWNER" ? <Badge variant="outline">owner</Badge> : <Switch checked={s.isActive} onCheckedChange={() => void handleToggle(s)} />}
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditingId(s.id); setForm({ name: s.user.name, email: s.user.email, role: s.role, phone: s.user.phone ?? "", tempPassword: "" }); setDialogOpen(true); }}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetTarget(s)}><KeyRound className="h-3.5 w-3.5" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="p-0">
              <ScrollArea className="max-h-[60vh]">
                <Table>
                  <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Reason / meta</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {audit.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="text-xs whitespace-nowrap">{new Date(a.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{a.actorLabel}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{a.action}</Badge></TableCell>
                        <TableCell className="text-xs">{a.entityType}</TableCell>
                        <TableCell className="text-xs max-w-72 truncate text-slate-500">{a.reason ?? a.metaJson ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
          <p className="text-xs text-slate-400 mt-2">Audit records are append-only through the application — users cannot rewrite history.</p>
        </TabsContent>
      </Tabs>

      {/* Staff dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setTempPassword(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit staff" : "Add staff member"}</DialogTitle>
            <DialogDescription>{tempPassword ? "Share this one-time password securely — it will not be shown again." : "Roles map to explicit server-enforced permission sets."}</DialogDescription></DialogHeader>
          {tempPassword ? (
            <div className="rounded-lg border bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">Temporary password for {form.email}</p>
              <p className="font-mono text-lg font-bold">{tempPassword}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2"><Label>Full name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!!editingId} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-1">
                <Label>Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {!editingId && (
                <div className="space-y-1"><Label>Temp password (optional)</Label><Input value={form.tempPassword} onChange={(e) => setForm({ ...form, tempPassword: e.target.value })} placeholder="auto-generate if empty" /></div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); setTempPassword(null); }}>{tempPassword ? "Done" : "Cancel"}</Button>
            {!tempPassword && <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleSave()} disabled={!form.name || !form.email}>{editingId ? "Save changes" : "Add staff"}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => !o && setResetTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Reset password — {resetTarget?.user.name}</DialogTitle></DialogHeader>
          <div className="space-y-1"><Label>New password</Label><Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="min 8 characters" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button className="bg-teal-600" onClick={() => void handleReset()} disabled={newPassword.length < 8}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
