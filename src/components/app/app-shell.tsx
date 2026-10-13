"use client";

import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useAppStore, type View } from "@/store/app-store";
import { LoginView } from "./login-view";
import { AdminConsole } from "./admin-view";
import { DashboardView } from "./dashboard-view";
import { PosView } from "@/components/pos/pos-view";
import { ProductsView } from "./products-view";
import { InventoryView } from "./inventory-view";
import { PurchasingView } from "./purchasing-view";
import { SalesView } from "./sales-view";
import { ShiftsView } from "./shifts-view";
import { ExpensesView } from "./expenses-view";
import { ReportsView } from "./reports-view";
import { StaffView } from "./staff-view";
import { SettingsView } from "./settings-view";
import { BillingView } from "./billing-view";
import { InsightsView } from "./insights-view";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ScanBarcode, Package, Boxes, Truck, ReceiptText,
  Clock, Wallet, BarChart3, Users, Settings, CreditCard, Sparkles, LogOut, Bell, Store, WifiOff, RefreshCw,
} from "lucide-react";
import { getMyShift } from "@/server/actions/pos-actions";
import { syncOfflineSales } from "@/lib/offline/sync";
import { pendingCount } from "@/lib/offline/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const NAV: { view: View; label: string; icon: React.ComponentType<{ className?: string }>; permission?: string; roles?: string[] }[] = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "pos", label: "Point of Sale", icon: ScanBarcode },
  { view: "products", label: "Products", icon: Package },
  { view: "inventory", label: "Inventory", icon: Boxes },
  { view: "purchasing", label: "Purchasing", icon: Truck },
  { view: "sales", label: "Sales & Refunds", icon: ReceiptText },
  { view: "shifts", label: "Shifts", icon: Clock },
  { view: "expenses", label: "Expenses", icon: Wallet },
  { view: "reports", label: "Reports", icon: BarChart3 },
  { view: "insights", label: "AI Insights", icon: Sparkles },
  { view: "staff", label: "Staff", icon: Users },
  { view: "settings", label: "Settings", icon: Settings },
  { view: "billing", label: "Billing", icon: CreditCard },
];

const VIEW_FOR_ROLE: Record<string, View[]> = {
  OWNER: NAV.map((n) => n.view),
  MANAGER: ["dashboard", "pos", "products", "inventory", "purchasing", "sales", "shifts", "expenses", "reports", "insights", "staff", "billing"],
  CASHIER: ["dashboard", "pos", "sales", "shifts"],
  INVENTORY_MANAGER: ["dashboard", "products", "inventory", "purchasing", "reports", "sales"],
  PHARMACIST: ["dashboard", "pos", "inventory", "sales", "shifts"],
  ACCOUNTANT: ["dashboard", "expenses", "reports", "sales", "billing", "purchasing"],
};

export function AppShell() {
  const { data: session, status } = useSession();
  const { activeView, setActiveView } = useAppStore();
  const { online, pendingCount: pending } = useAppStore((s) => s.offline);
  const [shiftInfo, setShiftInfo] = useState<{ id: string; openedAt: string } | null>(null);

  const trySync = useCallback(async () => {
    const businessId = session?.user?.businessId;
    if (!businessId) return;
    try {
      const result = await syncOfflineSales(businessId);
      const pending = await pendingCount(businessId);
      useAppStore.getState().setOffline({
        pendingCount: pending,
        lastSyncAt: new Date().toISOString(),
      });
      if (result.synced > 0) useAppStore.getState().bumpRefresh();
    } catch {
      // silent — indicator shows pending state
    }
  }, [session?.user?.businessId]);

  useEffect(() => {
    const onlineHandler = () => {
      useAppStore.getState().setOffline({ online: true });
      void trySync();
    };
    const offlineHandler = () => useAppStore.getState().setOffline({ online: false });
    window.addEventListener("online", onlineHandler);
    window.addEventListener("offline", offlineHandler);
    useAppStore.getState().setOffline({ online: navigator.onLine });
    return () => {
      window.removeEventListener("online", onlineHandler);
      window.removeEventListener("offline", offlineHandler);
    };
  }, [trySync]);

  useEffect(() => {
    if (session?.user?.businessId) {
      getMyShift(session.user.businessId)
        .then((r) => setShiftInfo(r?.shift ? { id: r.shift.id, openedAt: r.shift.openedAt } : null))
        .catch(() => setShiftInfo(null));
      void trySync();
    }
  }, [session?.user?.businessId, trySync]);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={96} height={52} className="opacity-80" />
          <div className="animate-pulse text-sm text-slate-500">Loading SynkiSell…</div>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginView />;
  }

  if (session.user.platformAdmin) {
    return <AdminConsole userName={session.user.name ?? "Admin"} onSignOut={() => signOut()} />;
  }

  const businessId = session.user.businessId;
  if (!businessId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md text-center space-y-3">
          <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={120} height={65} className="mx-auto" />
          <h1 className="text-xl font-semibold">No business workspace</h1>
          <p className="text-sm text-slate-600">
            Your account is not linked to a business workspace yet. Ask the business owner to add you under Staff, or register a new business.
          </p>
          <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
        </div>
      </div>
    );
  }

  const role = session.user.role ?? "CASHIER";
  const allowedViews = VIEW_FOR_ROLE[role] ?? ["dashboard", "pos"];
  const nav = NAV.filter((n) => allowedViews.includes(n.view));
  const currentView = allowedViews.includes(activeView) ? activeView : allowedViews[0];

  const renderView = () => {
    switch (currentView) {
      case "dashboard": return <DashboardView businessId={businessId} />;
      case "pos": return <PosView businessId={businessId} onShiftChanged={() => {
        getMyShift(businessId).then((r) => setShiftInfo(r?.shift ? { id: r.shift.id, openedAt: r.shift.openedAt } : null)).catch(() => {});
      }} />;
      case "products": return <ProductsView businessId={businessId} />;
      case "inventory": return <InventoryView businessId={businessId} />;
      case "purchasing": return <PurchasingView businessId={businessId} />;
      case "sales": return <SalesView businessId={businessId} />;
      case "shifts": return <ShiftsView businessId={businessId} />;
      case "expenses": return <ExpensesView businessId={businessId} />;
      case "reports": return <ReportsView businessId={businessId} />;
      case "staff": return <StaffView businessId={businessId} />;
      case "settings": return <SettingsView businessId={businessId} />;
      case "billing": return <BillingView businessId={businessId} />;
      case "insights": return <InsightsView businessId={businessId} />;
      default: return <DashboardView businessId={businessId} />;
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="hidden md:flex flex-col w-60 shrink-0 border-r bg-white">
        <div className="flex items-center gap-2 px-4 h-16 border-b">
          <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={72} height={39} />
          <span className="font-semibold tracking-tight">SynkiSell</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {nav.map((n) => (
            <button
              key={n.view}
              onClick={() => setActiveView(n.view)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                currentView === n.view ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-teal-50 hover:text-teal-800"
              )}
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t text-xs text-slate-400">SynkiSell • Osun State pilot</div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 border-b bg-white flex items-center gap-3 px-4 sticky top-0 z-20">
          {/* Mobile nav */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="md:hidden"><Store className="h-4 w-4" /> Menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              {nav.map((n) => (
                <DropdownMenuItem key={n.view} onClick={() => setActiveView(n.view)}>
                  <n.icon className="h-4 w-4 mr-2" /> {n.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="min-w-0">
            <div className="font-semibold truncate">{session.user.businessName}</div>
            <div className="text-xs text-slate-500">{role.replace("_", " ")} workspace</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {shiftInfo && (
              <Badge variant="outline" className="hidden sm:inline-flex border-teal-200 bg-teal-50 text-teal-700">
                <Clock className="h-3 w-3 mr-1" /> Shift open
              </Badge>
            )}
            {!online && (
              <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
                <WifiOff className="h-3 w-3 mr-1" /> Offline
              </Badge>
            )}
            {online && pending > 0 && (
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700" onClick={() => void trySync()}>
                <RefreshCw className="h-3 w-3 mr-1" /> {pending} pending sync
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="h-9 w-9 rounded-full bg-teal-600 text-white flex items-center justify-center text-sm font-semibold" aria-label="Account menu">
                  {(session.user.name ?? "U").slice(0, 1).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{session.user.name}</div>
                  <div className="text-xs text-slate-500">{session.user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className="h-4 w-4 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">{renderView()}</main>
      </div>
    </div>
  );
}
