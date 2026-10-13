"use client";

import { SessionProvider } from "next-auth/react";
import { AppShell } from "@/components/app/app-shell";

export default function Home() {
  return (
    <SessionProvider>
      <AppShell />
    </SessionProvider>
  );
}
