import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

/**
 * NextAuth v4 configuration — credentials provider with JWT sessions.
 *
 * The JWT stores identity claims (id, platformAdmin, active business
 * context). Guards (lib/guards.ts) ALWAYS re-verify the membership in the
 * database on every guarded server call — JWT claims are convenience, not
 * authority. Deactivating a membership takes effect immediately.
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 }, // 12h shift-friendly
  secret: process.env.NEXTAUTH_SECRET ?? "synkisell-dev-secret-do-not-use-in-prod",
  pages: { signIn: "/" },
  providers: [
    CredentialsProvider({
      name: "SynkiSell account",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = credentials.email.trim().toLowerCase();
        const user = await db.user.findUnique({ where: { email } });
        if (!user || !user.isActive) return null;
        if (!verifyPassword(credentials.password, user.passwordHash)) return null;

        // Attach the user's first active business membership as initial context
        const membership = await db.membership.findFirst({
          where: { userId: user.id, isActive: true },
          include: { business: { select: { name: true, status: true } } },
          orderBy: { createdAt: "asc" },
        });

        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          platformAdmin: user.platformAdmin,
          businessId: membership?.businessId,
          businessName: membership?.business.name,
          role: membership?.role,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.platformAdmin = user.platformAdmin;
        token.businessId = user.businessId;
        token.businessName = user.businessName;
        token.role = user.role;
      }
      // Re-resolve business context when explicitly triggered (switchBusiness)
      if (trigger === "update" && token.id) {
        const membership = await db.membership.findFirst({
          where: { userId: token.id as string, isActive: true },
          include: { business: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        });
        token.businessId = membership?.businessId;
        token.businessName = membership?.business.name;
        token.role = membership?.role;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.platformAdmin = token.platformAdmin as boolean;
      session.user.businessId = token.businessId as string | undefined;
      session.user.businessName = token.businessName as string | undefined;
      session.user.role = token.role as string | undefined;
      return session;
    },
  },
};
