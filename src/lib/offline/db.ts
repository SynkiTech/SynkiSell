"use client";

/**
 * Offline POS — IndexedDB persistence (no external dependency).
 * - Catalogue snapshot cache (versioned)
 * - Durable sale queue with client UUIDs (survives browser restart)
 * - States: pending → synced | failed
 */

const DB_NAME = "synkisell-pos";
const DB_VERSION = 1;

export type CachedProduct = {
  id: string;
  name: string;
  sku: string;
  barcodes: string[];
  department: string;
  type: string;
  trackBatches: boolean;
  sellingPrice: number;
  taxRate: number;
  baseUnit: string;
  conversions: { fromUnit: string; toUnit: string; factor: number }[];
  stock: number;
};

export type QueuedSale = {
  idempotencyKey: string;
  businessId: string;
  shiftId: string | null;
  lines: { productId: string; quantity: number; soldUnit: string; discountAmount: number }[];
  payments: { method: "CASH" | "TRANSFER" | "CARD"; amount: number; reference?: string | null }[];
  transactionDiscount: number;
  clientCreatedAt: string;
  status: "pending" | "synced" | "failed";
  serverNumber?: string;
  error?: string;
  attempts: number;
};

export type CatalogCache = {
  businessId: string;
  fetchedAt: string;
  products: CachedProduct[];
  business: { name: string; receiptHeader: string; receiptFooter: string; defaultTaxRate: number } | null;
  disclosedNote: string;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("catalog")) db.createObjectStore("catalog", { keyPath: "businessId" });
      if (!db.objectStoreNames.contains("sales")) db.createObjectStore("sales", { keyPath: "idempotencyKey" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/* ── Catalogue cache ── */

export async function saveCatalogCache(cache: CatalogCache): Promise<void> {
  await withStore("catalog", "readwrite", (s) => s.put(cache));
}

export async function loadCatalogCache(businessId: string): Promise<CatalogCache | null> {
  const c = await withStore<CatalogCache | undefined>("catalog", "readonly", (s) => s.get(businessId));
  return c ?? null;
}

/* ── Sale queue ── */

export async function queueSale(sale: QueuedSale): Promise<void> {
  await withStore("sales", "readwrite", (s) => s.put(sale));
}

export async function updateQueuedSale(sale: QueuedSale): Promise<void> {
  await withStore("sales", "readwrite", (s) => s.put(sale));
}

export async function listQueuedSales(businessId: string): Promise<QueuedSale[]> {
  const all = await withStore<QueuedSale[]>("sales", "readonly", (s) => s.getAll());
  return (all ?? []).filter((q) => q.businessId === businessId).sort((a, b) => a.clientCreatedAt.localeCompare(b.clientCreatedAt));
}

export async function pendingCount(businessId: string): Promise<number> {
  const all = await listQueuedSales(businessId);
  return all.filter((q) => q.status === "pending").length;
}

export function newSaleKey(): string {
  return `off-${crypto.randomUUID()}`;
}
