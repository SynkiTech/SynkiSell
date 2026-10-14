"use client";

import { useCallback, useState } from "react";
import { listStaff, saveStaff, setStaffActive, resetStaffPassword, listAuditEvents } from "@/server/actions/staff-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Plus, KeyRound, Users, ScrollText } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";

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
  const [loaded, setLoaded] = useState(false);
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
    } finally {
      setLoaded(true);
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
    <div className="space-y-5">
      <PageHeader
        title="Staff & Audit"
        subtitle="Role-based permissions enforced on the server — hiding menus is never the security control."
        actions={
          <Button onClick={() => { setEditingId(null); setForm({ name: "", email: "", role: "CASHIER", phone: "", tempPassword: "" }); setTempPassword(null); setDialogOpen(true); }}>
            <Plus className="h-4 w-4" /> Add staff
          </Button>
        }
      />

      {!loaded ? (
        <GlassCard className="p-5">
          <InlineLoading label="Loading staff & audit" />
        </GlassCard>
      ) : (
        <Tabs defaultValue="staff">
          <TabsList><TabsTrigger value="staff">Staff ({staff.length})</TabsTrigger><TabsTrigger value="audit">Audit log ({audit.length})</TabsTrigger></TabsList>

          <TabsContent value="staff" className="mt-4">
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                  <h3 className="flex items-center gap-1.5 text-[0.95rem] font-semibold">
                    <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Team members
                  </h3>
                  <Badge variant="outline">{staff.filter((s) => s.isActive).length} of {staff.length} active</Badge>
                </div>
                <div className="px-5 pb-4 pt-3">
                  <Table>
                    <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Last login</TableHead><TableHead>Active</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {staff.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="font-medium">
                            {s.user.name}
                            {!s.user.isActive && <span className="ml-2 text-xs text-muted-foreground/70">(login disabled)</span>}
                          </TableCell>
                          <TableCell className="text-sm">{s.user.email}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={s.role === "OWNER" ? "border-primary/30 bg-primary/10 text-primary" : ""}
                            >
                              {s.role.replace("_", " ")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">{s.user.lastLoginAt ? new Date(s.user.lastLoginAt).toLocaleString() : "never"}</TableCell>
                          <TableCell>
                            {s.role === "OWNER" ? <Badge variant="outline">owner</Badge> : <Switch checked={s.isActive} onCheckedChange={() => void handleToggle(s)} />}
                          </TableCell>
                          <TableCell className="space-x-1">
                            <Button size="sm" variant="ghost" onClick={() => { setEditingId(s.id); setForm({ name: s.user.name, email: s.user.email, role: s.role, phone: s.user.phone ?? "", tempPassword: "" }); setDialogOpen(true); }}>Edit</Button>
                            <Button size="sm" variant="ghost" aria-label={`Reset password for ${s.user.name}`} onClick={() => setResetTarget(s)}><KeyRound className="h-3.5 w-3.5" /></Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!staff.length && (
                        <TableRow>
                          <TableCell colSpan={6} className="p-2">
                            <EmptyState
                              icon={Users}
                              title="No staff yet"
                              hint="Add managers, cashiers and specialists — each role maps to explicit server-enforced permissions."
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
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                  <h3 className="flex items-center gap-1.5 text-[0.95rem] font-semibold">
                    <ScrollText className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> Audit trail
                  </h3>
                  <Badge variant="outline">latest {audit.length}</Badge>
                </div>
                <div className="px-5 pb-4 pt-3">
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
                            <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{a.reason ?? a.metaJson ?? "—"}</TableCell>
                          </TableRow>
                        ))}
                        {!audit.length && (
                          <TableRow>
                            <TableCell colSpan={5} className="p-2">
                              <EmptyState
                                icon={ScrollText}
                                title="No audit events yet"
                                hint="Sensitive actions (approvals, role changes, voids, settings) are recorded here automatically."
                                className="border-0"
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              </GlassCard>
            </FadeIn>
            <p className="mt-2 text-xs text-muted-foreground/70">Audit records are append-only through the application — users cannot rewrite history.</p>
          </TabsContent>
        </Tabs>
      )}

      {/* Staff dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setTempPassword(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit staff" : "Add staff member"}</DialogTitle>
            <DialogDescription>{tempPassword ? "Share this one-time password securely — it will not be shown again." : "Roles map to explicit server-enforced permission sets."}</DialogDescription></DialogHeader>
          {tempPassword ? (
            <div className="rounded-lg border bg-secondary/60 p-4 text-center">
              <p className="mb-1 text-xs text-muted-foreground">Temporary password for {form.email}</p>
              <p className="font-mono text-lg font-bold tabular-nums">{tempPassword}</p>
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
            {!tempPassword && <Button onClick={() => void handleSave()} disabled={!form.name || !form.email}>{editingId ? "Save changes" : "Add staff"}</Button>}
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
            <Button onClick={() => void handleReset()} disabled={newPassword.length < 8}>Reset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
