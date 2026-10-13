"use client";

import { useCallback, useState } from "react";
import { listProducts, createProduct, updateProduct, setProductActive, importProducts } from "@/server/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import { Plus, Pencil, Search, Upload, PackagePlus } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

type ProductRow = {
  id: string; name: string; sku: string; description: string | null;
  department: string; type: string; trackBatches: boolean;
  costPrice: { toString(): string } | number; sellingPrice: { toString(): string } | number;
  baseUnit: string; reorderLevel: { toString(): string } | number; taxRate: { toString(): string } | number;
  isActive: boolean; categoryId: string | null; category: { name: string } | null;
  barcodes: { code: string }[]; conversions: { fromUnit: string; toUnit: string; factor: { toString(): string } }[];
  stockBalance: { quantity: { toString(): string } } | null;
};

const emptyForm = {
  name: "", sku: "", barcode: "", description: "", department: "SUPERMARKET", type: "RETAIL",
  costPrice: "", sellingPrice: "", baseUnit: "piece", reorderLevel: "10", taxRate: "0",
  categoryId: "", conversions: "",
};

export function ProductsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // Import state
  const [importOpen, setImportOpen] = useState(false);
  const [importCsv, setImportCsv] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; errors: { row: number; message: string }[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await listProducts(businessId, { search: search || undefined })) as unknown as ProductRow[];
      setProducts(rows);
    } catch (err) {
      toast({ title: "Could not load products", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [businessId, search, toast]);

  useDataLoader(load, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEdit(p: ProductRow) {
    setEditingId(p.id);
    setForm({
      name: p.name, sku: p.sku, barcode: p.barcodes[0]?.code ?? "", description: p.description ?? "",
      department: p.department, type: p.type,
      costPrice: p.costPrice.toString(), sellingPrice: p.sellingPrice.toString(),
      baseUnit: p.baseUnit, reorderLevel: p.reorderLevel.toString(), taxRate: p.taxRate.toString(),
      categoryId: p.categoryId ?? "", conversions: p.conversions.map((c) => `${c.fromUnit}:${c.factor}`).join(", "),
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        businessId,
        name: form.name,
        sku: form.sku,
        description: form.description || undefined,
        department: form.department as "PHARMACY" | "SUPERMARKET" | "BOTH",
        type: form.type as "MEDICINE" | "RETAIL",
        costPrice: Number(form.costPrice) || 0,
        sellingPrice: Number(form.sellingPrice) || 0,
        baseUnit: form.baseUnit,
        reorderLevel: Number(form.reorderLevel) || 0,
        taxRate: Number(form.taxRate) || 0,
        barcode: form.barcode || null,
        categoryId: form.categoryId || null,
        conversions: form.conversions.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
          const [fromUnit, factor] = s.split(":");
          return { fromUnit: fromUnit.trim(), factor: Number(factor) || 1 };
        }),
      };
      if (editingId) {
        await updateProduct({ ...payload, id: editingId });
        toast({ title: "Product updated", description: form.name });
      } else {
        await createProduct(payload);
        toast({ title: "Product created", description: form.name });
      }
      setDialogOpen(false);
      void load();
      bumpRefresh();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(p: ProductRow) {
    try {
      await setProductActive(businessId, p.id, !p.isActive);
      void load();
    } catch (err) {
      toast({ title: "Failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  async function handleImport() {
    try {
      // Parse simple CSV: name,sku,barcode,department,type,costPrice,sellingPrice,baseUnit,reorderLevel,category
      const lines = importCsv.trim().split("\n").filter(Boolean);
      const rows = lines.map((line) => {
        const cols = line.split(",").map((c) => c.trim());
        return {
          name: cols[0] ?? "", sku: cols[1] ?? "", barcode: cols[2] || undefined,
          department: (cols[3] ?? "SUPERMARKET").toUpperCase(), type: (cols[4] ?? "RETAIL").toUpperCase(),
          costPrice: Number(cols[5]) || 0, sellingPrice: Number(cols[6]) || 0,
          baseUnit: cols[7] || "piece", reorderLevel: Number(cols[8]) || 10, categoryName: cols[9],
        };
      });
      const result = (await importProducts({ businessId, rows, fileName: "pasted.csv" })) as unknown as { imported: number; errors: { row: number; message: string }[] };
      setImportResult(result);
      void load();
    } catch (err) {
      toast({ title: "Import failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-sm text-slate-500">{products.length} product(s) — shared catalogue with department behaviour</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setImportOpen(true); setImportResult(null); }}><Upload className="h-4 w-4 mr-1" /> Import CSV</Button>
          <Button className="bg-teal-600 hover:bg-teal-700" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New product</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
        <Input placeholder="Search products…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="max-h-[65vh]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead><TableHead>Department</TableHead><TableHead>Barcode</TableHead>
                  <TableHead className="text-right">Cost</TableHead><TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Stock</TableHead><TableHead>Status</TableHead><TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-slate-400">Loading…</TableCell></TableRow>
                ) : products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-slate-500">{p.sku} • {p.category?.name ?? "Uncategorised"}{p.trackBatches ? " • batch-tracked" : ""}</div>
                    </TableCell>
                    <TableCell><Badge variant="outline" className={p.department === "PHARMACY" ? "border-teal-200 text-teal-700" : ""}>{p.department.replace("BOTH", "BOTH DEPTS")}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{p.barcodes[0]?.code ?? "—"}</TableCell>
                    <TableCell className="text-right">₦{Number(p.costPrice).toLocaleString()}</TableCell>
                    <TableCell className="text-right font-medium">₦{Number(p.sellingPrice).toLocaleString()}</TableCell>
                    <TableCell className="text-right">{p.stockBalance ? Number(p.stockBalance.quantity).toLocaleString() : "0"} {p.baseUnit}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Switch checked={p.isActive} onCheckedChange={() => void toggleActive(p)} aria-label="active" />
                        <span className="text-xs text-slate-500">{p.isActive ? "Active" : "Inactive"}</span>
                      </div>
                    </TableCell>
                    <TableCell><Button size="sm" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Create/Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit product" : "New product"}</DialogTitle>
            <DialogDescription>Medicines are automatically batch-tracked (FEFO + expiry control).</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1"><Label>SKU</Label><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            <div className="space-y-1"><Label>Barcode</Label><Input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Department</Label>
              <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHARMACY">Pharmacy</SelectItem>
                  <SelectItem value="SUPERMARKET">Supermarket</SelectItem>
                  <SelectItem value="BOTH">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, baseUnit: v === "MEDICINE" ? "pack" : "piece" })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="RETAIL">Retail</SelectItem><SelectItem value="MEDICINE">Medicine</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Cost price (₦)</Label><Input value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Selling price (₦)</Label><Input value={form.sellingPrice} onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Base unit</Label><Input value={form.baseUnit} onChange={(e) => setForm({ ...form, baseUnit: e.target.value })} placeholder="piece/pack/bottle" /></div>
            <div className="space-y-1"><Label>Reorder level</Label><Input value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1"><Label>Tax rate %</Label><Input value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: e.target.value })} inputMode="decimal" /></div>
            <div className="space-y-1 col-span-2">
              <Label>Unit conversions</Label>
              <Input value={form.conversions} onChange={(e) => setForm({ ...form, conversions: e.target.value })} placeholder="carton:12, pack:10  (1 carton = 12 base units)" />
              <p className="text-[11px] text-slate-400">Only explicitly configured conversions are valid — e.g. buy cartons, sell pieces.</p>
            </div>
            <div className="space-y-1 col-span-2"><Label>Description</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleSave()} disabled={saving || !form.name || !form.sku}>{saving ? "Saving…" : "Save product"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import products from CSV</DialogTitle>
            <DialogDescription>
              Columns: name, sku, barcode, department, type, costPrice, sellingPrice, baseUnit, reorderLevel, category. Invalid rows are reported — never silently dropped.
            </DialogDescription>
          </DialogHeader>
          <Textarea rows={6} value={importCsv} onChange={(e) => setImportCsv(e.target.value)} placeholder={`name,sku,barcode,department,type,costPrice,sellingPrice,baseUnit,reorderLevel,category\nPanadol Extra,PAN-EX,5012345678,PHARMACY,MEDICINE,300,450,pack,20,Analgesics`} />
          {importResult && (
            <div className="rounded-lg border p-3 text-sm space-y-1">
              <p className="font-medium">Import result: {importResult.imported} imported, {importResult.errors.length} row(s) rejected</p>
              <ScrollArea className="max-h-32">
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-600">Row {e.row}: {e.message}</p>
                ))}
              </ScrollArea>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Close</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleImport()} disabled={!importCsv.trim()}><PackagePlus className="h-4 w-4 mr-1" /> Validate & import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
