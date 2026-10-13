"use client";

import { create } from "zustand";

export type View =
  | "dashboard" | "pos" | "products" | "inventory" | "purchasing" | "sales"
  | "shifts" | "expenses" | "reports" | "staff" | "settings" | "billing"
  | "insights" | "notifications";

type CartLine = {
  productId: string;
  name: string;
  department: string;
  quantity: number;
  soldUnit: string;
  unitPrice: number;
  discountAmount: number;
  stock: number;
  trackBatches: boolean;
};

type OfflineState = {
  online: boolean;
  pendingCount: number;
  lastSyncAt: string | null;
};

type AppState = {
  activeView: View;
  setActiveView: (v: View) => void;

  cart: CartLine[];
  addToCart: (line: Omit<CartLine, "quantity"> & { quantity?: number }) => void;
  updateCartQty: (productId: string, quantity: number) => void;
  updateCartDiscount: (productId: string, discount: number) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;

  offline: OfflineState;
  setOffline: (s: Partial<OfflineState>) => void;

  refreshTrigger: number;
  bumpRefresh: () => void;
};

export const useAppStore = create<AppState>((set) => ({
  activeView: "dashboard",
  setActiveView: (v) => set({ activeView: v }),

  cart: [],
  addToCart: (line) =>
    set((state) => {
      const existing = state.cart.find((c) => c.productId === line.productId);
      if (existing) {
        return {
          cart: state.cart.map((c) =>
            c.productId === line.productId ? { ...c, quantity: c.quantity + (line.quantity ?? 1) } : c
          ),
        };
      }
      return { cart: [...state.cart, { ...line, quantity: line.quantity ?? 1 } as CartLine] };
    }),
  updateCartQty: (productId, quantity) =>
    set((state) => ({
      cart: state.cart.map((c) => (c.productId === productId ? { ...c, quantity: Math.max(0, quantity) } : c)),
    })),
  updateCartDiscount: (productId, discount) =>
    set((state) => ({
      cart: state.cart.map((c) => (c.productId === productId ? { ...c, discountAmount: Math.max(0, discount) } : c)),
    })),
  removeFromCart: (productId) =>
    set((state) => ({ cart: state.cart.filter((c) => c.productId !== productId) })),
  clearCart: () => set({ cart: [] }),

  offline: { online: true, pendingCount: 0, lastSyncAt: null },
  setOffline: (s) => set((state) => ({ offline: { ...state.offline, ...s } })),

  refreshTrigger: 0,
  bumpRefresh: () => set((state) => ({ refreshTrigger: state.refreshTrigger + 1 })),
}));

export const cartTotal = (cart: CartLine[]) =>
  cart.reduce((acc, c) => acc + (c.quantity * c.unitPrice - c.discountAmount), 0);
