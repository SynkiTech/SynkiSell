"use client";

import { useSession, signOut } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
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
import { BrandLogo, BrandWordmark } from "./ui/brand";
import { DelayedLoading } from "./ui/loading";
import { FadeIn } from "./ui/primitives";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ScanBarcode, Package, Boxes, Truck, ReceiptText,
  Clock, Wallet, BarChart3, Users, Settings, CreditCard, Sparkles, LogOut,
  WifiOff, RefreshCw, ChevronLeft, PanelLeft, Menu, X,
} from "lucide-react";
import { getMyShift } from "@/server/actions/pos-actions";
import { syncOfflineSales } from "@/lib/offline/sync";
import { pendingCount } from "@/lib/offline/db";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type NavItem = { view: View; label: string; icon: React.ComponentType<{ className?: string }> };
const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
      { view: "insights", label: "AI Insights", icon: Sparkles },
    ],
  },
  {
    label: "Sales",
    items: [
      { view: "pos", label: "Point of Sale", icon: ScanBarcode },
      { view: "sales", label: "Sales & Refunds", icon: ReceiptText },
      { view: "shifts", label: "Shifts", icon: Clock },
    ],
  },
  {
    label: "Inventory",
    items: [
      { view: "products", label: "Products", icon: Package },
      { view: "inventory", label: "Inventory", icon: Boxes },
      { view: "purchasing", label: "Purchasing", icon: Truck },
    ],
  },
  {
    label: "Operations",
    items: [
      { view: "expenses", label: "Expenses", icon: Wallet },
      { view: "reports", label: "Reports", icon: BarChart3 },
      { view: "staff", label: "Staff", icon: Users },
    ],
  },
  {
    label: "Business",
    items: [
      { view: "billing", label: "Billing", icon: CreditCard },
      { view: "settings", label: "Settings", icon: Settings },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

const VIEW_FOR_ROLE: Record<string, View[]> = {
  OWNER: ALL_ITEMS.map((n) => n.view),
  MANAGER: ["dashboard", "pos", "products", "inventory", "purchasing", "sales", "shifts", "expenses", "reports", "insights", "staff", "billing"],
  CASHIER: ["dashboard", "pos", "sales", "shifts"],
  INVENTORY_MANAGER: ["dashboard", "products", "inventory", "purchasing", "reports", "sales"],
  PHARMACIST: ["dashboard", "pos", "inventory", "sales", "shifts"],
  ACCOUNTANT: ["dashboard", "expenses", "reports", "sales", "billing", "purchasing"],
};

/* ───────────────────────── Sidebar body (shared desktop / mobile) ───────────────────────── */

function SidebarNav({
  groups,
  currentView,
  onNavigate,
  collapsed = false,
  onCloseMobile,
}: {
  groups: { label: string; items: NavItem[] }[];
  currentView: View;
  onNavigate: (v: View) => void;
  collapsed?: boolean;
  onCloseMobile?: () => void;
}) {
  return (
    <TooltipProvider delayDuration={120}>
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Primary">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            {!collapsed && (
              <p className="px-2.5 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-white/35">
                {group.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((n) => {
                const active = currentView === n.view;
                const btn = (
                  <button
                    onClick={() => {
                      onNavigate(n.view);
                      onCloseMobile?.();
                    }}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium outline-none transition-colors duration-200",
                      "focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.105_200/0.7)]",
                      collapsed && "justify-center px-0",
                      active ? "text-white" : "text-[oklch(0.80_0.02_230/0.85)] hover:bg-white/6 hover:text-white"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId={collapsed ? undefined : "nav-active-pill"}
                        className="absolute inset-0 rounded-xl"
                        style={{ background: "var(--grad-brand)", boxShadow: "var(--shadow-glow-soft)" }}
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                        aria-hidden="true"
                      />
                    )}
                    {active && collapsed && (
                      <span
                        className="absolute inset-0 rounded-xl"
                        style={{ background: "var(--grad-brand)", boxShadow: "var(--shadow-glow-soft)" }}
                        aria-hidden="true"
                      />
                    )}
                    <n.icon className={cn("relative z-10 h-4 w-4 shrink-0 transition-transform duration-300 group-hover:scale-110", active && "drop-shadow")} />
                    {!collapsed && <span className="relative z-10 truncate">{n.label}</span>}
                    {active && !collapsed && (
                      <span className="relative z-10 ml-auto h-1.5 w-1.5 rounded-full bg-white/90 shadow-[0_0_6px_oklch(0.72_0.105_200/0.9)]" aria-hidden="true" />
                    )}
                  </button>
                );
                return (
                  <li key={n.view}>
                    {collapsed ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{btn}</TooltipTrigger>
                        <TooltipContent side="right" className="border-white/10 bg-[oklch(0.25_0.04_255)] text-white">
                          {n.label}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      btn
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </TooltipProvider>
  );
}

function SidebarChrome({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      style={{ background: "var(--grad-navy)", boxShadow: "var(--shadow-sidebar)" }}
    >
      {/* Slow ambient light — single subtle layer, transform-only */}
      <div
        className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full opacity-40"
        style={{
          background: "radial-gradient(circle, oklch(0.55 0.09 205 / 35%), transparent 65%)",
          animation: "ambient-drift-b calc(var(--dur-ambient) * 1.6) var(--ease-soft) infinite alternate",
        }}
        aria-hidden="true"
      />
      {/* Fine top highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" aria-hidden="true" />
      <div className="relative z-10 flex h-full flex-col">{children}</div>
    </div>
  );
}

function SidebarHeader({ collapsed }: { collapsed: boolean }) {
  return (
    <div className={cn("flex h-16 items-center gap-2.5 border-b border-white/8 px-4", collapsed && "justify-center px-0")}>
      <BrandLogo size={collapsed ? 34 : 40} priority />
      {!collapsed && <BrandWordmark light className="text-lg" />}
    </div>
  );
}

/* ─────────────────────────────────── Shell ─────────────────────────────────── */

export function AppShell() {
  const { data: session, status } = useSession();
  const { activeView, setActiveView } = useAppStore();
  const { online, pendingCount: pending } = useAppStore((s) => s.offline);
  const [shiftInfo, setShiftInfo] = useState<{ id: string; openedAt: string } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        setCollapsed(window.localStorage.getItem("sk-sidebar-collapsed") === "1");
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const toggleCollapse = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem("sk-sidebar-collapsed", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };

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
    return <DelayedLoading show message="Preparing your workspace" />;
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
      <div className="relative min-h-screen">
        <div className="ambient-scene" aria-hidden="true" />
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="glass-strong max-w-md space-y-3 rounded-2xl p-8 text-center">
            <BrandLogo size={120} className="mx-auto" />
            <h1 className="text-xl font-semibold">No business workspace</h1>
            <p className="text-sm text-muted-foreground">
              Your account is not linked to a business workspace yet. Ask the business owner to add you under Staff, or register a new business.
            </p>
            <Button variant="outline" onClick={() => signOut()}>Sign out</Button>
          </div>
        </div>
      </div>
    );
  }

  const role = session.user.role ?? "CASHIER";
  const allowedViews = VIEW_FOR_ROLE[role] ?? ["dashboard", "pos"];
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((n) => allowedViews.includes(n.view)) })).filter((g) => g.items.length > 0);
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
    <div className="relative min-h-screen">
      <div className="ambient-scene" aria-hidden="true" />

      {/* Desktop sidebar */}
      <motion.aside
        initial={false}
        animate={{ width: collapsed ? 68 : 248 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        className="fixed inset-y-0 left-0 z-30 hidden md:block"
      >
        <SidebarChrome collapsed={collapsed}>
          <SidebarHeader collapsed={collapsed} />
          <SidebarNav groups={groups} currentView={currentView} onNavigate={setActiveView} collapsed={collapsed} />
          <div className="border-t border-white/8 p-2.5">
            <button
              onClick={toggleCollapse}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-white/50 transition-colors hover:bg-white/6 hover:text-white"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? <PanelLeft className="h-4 w-4 mx-auto" /> : (
                <>
                  <ChevronLeft className="h-4 w-4" />
                  <span>Collapse</span>
                  <span className="ml-auto font-medium tracking-wide text-white/30">v1.0</span>
                </>
              )}
            </button>
          </div>
        </SidebarChrome>
      </motion.aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 border-0 w-72" style={{ background: "transparent" }}>
          <SheetHeader className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
          </SheetHeader>
          <SidebarChrome collapsed={false}>
            <div className="flex h-16 items-center justify-between border-b border-white/8 px-4">
              <div className="flex items-center gap-2.5">
                <BrandLogo size={38} priority />
                <BrandWordmark light className="text-lg" />
              </div>
              <button onClick={() => setMobileOpen(false)} aria-label="Close navigation" className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarNav groups={groups} currentView={currentView} onNavigate={setActiveView} onCloseMobile={() => setMobileOpen(false)} />
            <div className="border-t border-white/8 px-4 py-3 text-xs text-white/40">SynkiSell • Osun State pilot</div>
          </SidebarChrome>
        </SheetContent>
      </Sheet>

      {/* Main column */}
      <div className={cn("flex min-h-screen flex-col transition-[padding] duration-300", collapsed ? "md:pl-[68px]" : "md:pl-[248px]")}>
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 rounded-none border-x-0 border-t-0 px-4">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 md:hidden">
            <BrandLogo size={30} />
            <BrandWordmark className="text-base" />
          </div>

          <div className="hidden min-w-0 md:block">
            <div className="truncate text-sm font-semibold">{session.user.businessName}</div>
            <div className="text-xs text-muted-foreground">{role.replace("_", " ")} workspace</div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {shiftInfo && (
              <Badge variant="outline" className="hidden gap-1.5 border-[oklch(0.585_0.093_201/0.35)] bg-[oklch(0.585_0.093_201/0.08)] text-primary sm:inline-flex">
                <Clock className="h-3 w-3" /> Shift open
              </Badge>
            )}
            {!online && (
              <Badge variant="outline" className="gap-1.5 border-amber-400/50 bg-amber-500/10 text-amber-600">
                <WifiOff className="h-3 w-3" /> Offline
              </Badge>
            )}
            {online && pending > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5 border-amber-400/50 text-amber-600" onClick={() => void trySync()}>
                <RefreshCw className="h-3 w-3" /> {pending} pending sync
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white shadow-[var(--shadow-glow-soft)] transition-transform hover:scale-105 [background:var(--grad-brand)]"
                  aria-label="Account menu"
                >
                  {(session.user.name ?? "U").slice(0, 1).toUpperCase()}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="glass-strong border-white/40">
                <DropdownMenuLabel>
                  <div className="text-sm font-medium">{session.user.name}</div>
                  <div className="text-xs text-muted-foreground">{session.user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()} className="gap-2">
                  <LogOut className="h-4 w-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 p-4 md:p-6">
          <FadeIn key={currentView}>{renderView()}</FadeIn>
        </main>

        <footer className="px-6 pb-4 text-center text-xs text-muted-foreground/60">
          SynkiSell — pharmacy &amp; supermarket, one business. Osun State pilot.
        </footer>
      </div>
    </div>
  );
}
