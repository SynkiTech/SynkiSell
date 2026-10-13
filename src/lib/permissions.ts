/**
 * SynkiSell permission matrix — the server-side source of truth.
 * Front-end visibility is derived from this, but enforcement always
 * happens here (guards.ts) on every server action / route call.
 */

export const ROLES = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  CASHIER: "CASHIER",
  INVENTORY_MANAGER: "INVENTORY_MANAGER",
  PHARMACIST: "PHARMACIST",
  ACCOUNTANT: "ACCOUNTANT",
} as const;

export type Role = keyof typeof ROLES;

export const PERMISSIONS = {
  // catalogue
  "product.view": "View products & catalogue",
  "product.create": "Create products",
  "product.update": "Update products (incl. prices)",
  "product.priceChange": "Change selling/cost prices",
  "product.import": "Bulk import products",
  // inventory
  "inventory.view": "View stock & batches",
  "inventory.adjust": "Stock adjustments with reason",
  "inventory.receive": "Goods receiving",
  "inventory.batchManage": "Manage pharmacy batches / quarantine",
  // purchasing
  "supplier.view": "View suppliers",
  "supplier.manage": "Create/update suppliers",
  "po.manage": "Create/manage purchase orders",
  // pos
  "pos.sell": "Operate the POS",
  "pos.discountLine": "Apply line-item discounts",
  "pos.discountTransaction": "Apply transaction discounts",
  "pos.reprint": "Reprint receipts",
  "sale.view": "View sale history",
  "sale.void": "Void sales (manager approval)",
  "refund.request": "Request refunds",
  "refund.approve": "Approve & process refunds",
  // shifts
  "shift.own": "Open/close own shift",
  "shift.viewAll": "View all shifts & reconciliation",
  // finance
  "expense.view": "View expenses",
  "expense.create": "Record expenses",
  "expense.approve": "Approve expenses",
  "reports.view": "View operational reports",
  "reports.financial": "View financial reports & exports",
  "reports.export": "Export data",
  // staff
  "staff.view": "View staff list",
  "staff.manage": "Invite/manage staff & roles",
  // business settings
  "settings.manage": "Manage business settings & branding",
  "audit.view": "View audit log",
  // AI
  "ai.use": "Use AI summaries & Q&A",
  "ai.forecast": "View/trigger forecasts",
  // billing (business side)
  "billing.view": "View subscription & invoices",
  // dashboard
  "dashboard.view": "View business dashboard",
} as const;

export type Permission = keyof typeof PERMISSIONS;

const OWNER_ALL: Permission[] = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  OWNER: OWNER_ALL,
  MANAGER: [
    "product.view", "product.create", "product.update", "product.import",
    "inventory.view", "inventory.adjust", "inventory.receive", "inventory.batchManage",
    "supplier.view", "supplier.manage", "po.manage",
    "pos.sell", "pos.discountLine", "pos.discountTransaction", "pos.reprint",
    "sale.view", "sale.void", "refund.request", "refund.approve",
    "shift.own", "shift.viewAll",
    "expense.view", "expense.create", "expense.approve",
    "reports.view", "reports.financial",
    "staff.view", "dashboard.view", "audit.view",
    "ai.use", "ai.forecast", "billing.view",
  ],
  CASHIER: [
    "product.view", "inventory.view",
    "pos.sell", "pos.reprint",
    "sale.view", "refund.request",
    "shift.own", "dashboard.view",
  ],
  INVENTORY_MANAGER: [
    "product.view", "product.create", "product.update", "product.import",
    "inventory.view", "inventory.adjust", "inventory.receive", "inventory.batchManage",
    "supplier.view", "supplier.manage", "po.manage",
    "reports.view", "dashboard.view", "sale.view",
  ],
  PHARMACIST: [
    "product.view", "inventory.view", "inventory.adjust", "inventory.batchManage",
    "pos.sell", "pos.discountLine", "sale.view", "refund.request",
    "shift.own", "dashboard.view",
  ],
  ACCOUNTANT: [
    "product.view", "inventory.view",
    "expense.view", "expense.create", "expense.approve",
    "reports.view", "reports.financial", "reports.export",
    "dashboard.view", "sale.view", "billing.view", "audit.view",
    "supplier.view",
  ],
};

export function permissionsForRole(role: Role, extraPermissions: string[] = []): Set<Permission> {
  const base = ROLE_PERMISSIONS[role] ?? [];
  return new Set<Permission>([...base, ...(extraPermissions as Permission[])]);
}

export function isValidRole(role: string): role is Role {
  return role in ROLES;
}
