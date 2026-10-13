import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      platformAdmin: boolean;
      businessId?: string; // active business context
      businessName?: string;
      role?: string; // active membership role
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    name: string;
    email: string;
    platformAdmin: boolean;
    businessId?: string;
    businessName?: string;
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    platformAdmin: boolean;
    businessId?: string;
    businessName?: string;
    role?: string;
  }
}
