import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { permissionsForRole, type Permission, type Role } from "@/lib/permissions";

/**
 * Server-side authorisation context.
 *
 * Every server action / protected route handler MUST go through these
 * guards. The businessId is ALWAYS derived from the server session +
 * database membership — never accepted from client input.
 */

export class AuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type BusinessContext = {
  userId: string;
  userName: string;
  businessId: string;
  businessName: string;
  membershipId: string;
  role: Role;
  permissions: Set<Permission>;
};

export type PlatformContext = {
  userId: string;
  userName: string;
};

/** Authenticated user (any kind). Throws AuthError if not signed in. */
export async function requireAuth(): Promise<{ userId: string; userName: string; platformAdmin: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new AuthError("UNAUTHENTICATED", "Please sign in to continue.");
  return {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? "User",
    platformAdmin: session.user.platformAdmin === true,
  };
}

/**
 * Authenticated user with an ACTIVE membership in the given business.
 * Re-reads the membership from the DB (JWT claims are not trusted).
 */
export async function requireBusiness(businessId?: string | null): Promise<BusinessContext> {
  const auth = await requireAuth();
  if (auth.platformAdmin && !businessId) {
    throw new AuthError("NO_BUSINESS_CONTEXT", "Platform administrators must use the admin console.");
  }
  const bid = businessId ?? null;
  if (!bid) throw new AuthError("NO_BUSINESS_CONTEXT", "No active business context.");

  const membership = await db.membership.findFirst({
    where: { userId: auth.userId, businessId: bid, isActive: true },
    include: { business: { select: { id: true, name: true, status: true } } },
  });
  if (!membership) {
    throw new AuthError("FORBIDDEN", "You do not have access to this business workspace.");
  }
  if (membership.business.status === "SUSPENDED") {
    // Only billing-related access is permitted while suspended
    throw new AuthError("BUSINESS_SUSPENDED", "This business account is suspended. Contact SynkiSell support.");
  }

  const role = membership.role as Role;
  return {
    userId: auth.userId,
    userName: auth.userName,
    businessId: membership.businessId,
    businessName: membership.business.name,
    membershipId: membership.id,
    role,
    permissions: permissionsForRole(role, safeParseArray(membership.extraPermissions)),
  };
}

/** Business context + explicit permission check. */
export async function requirePermission(businessId: string | null | undefined, permission: Permission): Promise<BusinessContext> {
  const ctx = await requireBusiness(businessId);
  if (!ctx.permissions.has(permission)) {
    throw new AuthError("PERMISSION_DENIED", `Your role (${ctx.role}) is not permitted to perform this action.`);
  }
  return ctx;
}

/** Platform admin only (SaaS Layer A). */
export async function requirePlatformAdmin(): Promise<PlatformContext> {
  const auth = await requireAuth();
  if (!auth.platformAdmin) {
    throw new AuthError("PERMISSION_DENIED", "Platform administrator access required.");
  }
  return { userId: auth.userId, userName: auth.userName };
}

/**
 * Wrap a server action with uniform error handling: AuthError codes pass
 * through (UI shows the message); unexpected errors are logged safely.
 */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthError) throw err;
    console.error("[guarded-action]", err instanceof Error ? err.message : err);
    throw new Error("Something went wrong on the server. Please try again.");
  }
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
