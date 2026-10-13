"use client";

import { useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { registerBusiness } from "@/server/actions/auth-actions";
import { NIGERIAN_STATES } from "./states";

export function LoginView() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [reg, setReg] = useState({
    ownerName: "", regEmail: "", regPassword: "", phone: "", businessName: "",
    businessType: "COMBINED", state: "Osun", address: "",
  });
  const [regError, setRegError] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regDone, setRegDone] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const result = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Invalid email or password.");
    } else {
      router.refresh();
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setRegError(null);
    setRegLoading(true);
    try {
      const result = await registerBusiness({
        ownerName: reg.ownerName,
        email: reg.regEmail,
        password: reg.regPassword,
        phone: reg.phone || undefined,
        businessName: reg.businessName,
        businessType: reg.businessType,
        state: reg.state,
        address: reg.address || undefined,
      });
      if (result?.ok) {
        setRegDone(true);
        // auto sign-in
        await signIn("credentials", { email: reg.regEmail, password: reg.regPassword, redirect: false });
        router.refresh();
      }
    } catch (err) {
      setRegError(err instanceof Error ? err.message : "Registration failed.");
    } finally {
      setRegLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900">
      {/* Brand panel */}
      <div className="flex-1 flex flex-col justify-center items-center p-10 text-white">
        <Image src="/branding/synkisell-logo.png" alt="SynkiSell" width={180} height={98} className="mb-6" />
        <h1 className="text-3xl font-bold tracking-tight text-center">Run your pharmacy & supermarket as one business.</h1>
        <p className="mt-3 text-teal-100 text-center max-w-md">
          One shared point of sale. Batch &amp; expiry control for medicines. Purchasing, staff, expenses and reports — with AI insights built in.
        </p>
        <div className="mt-8 grid grid-cols-3 gap-3 text-xs text-teal-100/90 max-w-md w-full">
          <div className="rounded-lg bg-white/10 p-3 text-center">FEFO batch control</div>
          <div className="rounded-lg bg-white/10 p-3 text-center">Offline-capable POS</div>
          <div className="rounded-lg bg-white/10 p-3 text-center">AI business insights</div>
        </div>
      </div>

      {/* Auth panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-white lg:m-6 lg:rounded-2xl lg:shadow-2xl rounded-t-3xl">
        <div className="w-full max-w-md">
          <Tabs defaultValue="login">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="login">Sign in</TabsTrigger>
              <TabsTrigger value="register">Register business</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0">
                  <CardTitle>Welcome back</CardTitle>
                  <CardDescription>Sign in to your SynkiSell workspace.</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.ng" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                    </div>
                    {error && <p className="text-sm text-red-600">{error}</p>}
                    <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={loading}>
                      {loading ? "Signing in…" : "Sign in"}
                    </Button>
                  </form>
                  <div className="mt-6 rounded-lg bg-slate-50 border p-3 text-xs text-slate-600 space-y-1">
                    <p className="font-medium text-slate-700">Demo accounts (seeded)</p>
                    <p>Platform admin — admin@synkisell.com / SynkiAdmin#2026</p>
                    <p>Business owner — owner@firstpharmplus.ng / Owner#2026</p>
                    <p>Cashier — cashier@firstpharmplus.ng / Cashier#2026</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card className="border-0 shadow-none">
                <CardHeader className="px-0">
                  <CardTitle>Create your business account</CardTitle>
                  <CardDescription>Start your SynkiSell onboarding. Your workspace is created immediately.</CardDescription>
                </CardHeader>
                <CardContent className="px-0">
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5 col-span-2">
                        <Label>Business name</Label>
                        <Input required value={reg.businessName} onChange={(e) => setReg({ ...reg, businessName: e.target.value })} placeholder="e.g. Fountain Pharma & Mart" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Business type</Label>
                        <Select value={reg.businessType} onValueChange={(v) => setReg({ ...reg, businessType: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="COMBINED">Pharmacy + Supermarket</SelectItem>
                            <SelectItem value="PHARMACY">Pharmacy only</SelectItem>
                            <SelectItem value="SUPERMARKET">Supermarket only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>State</Label>
                        <Select value={reg.state} onValueChange={(v) => setReg({ ...reg, state: v })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {NIGERIAN_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label>Owner&apos;s full name</Label>
                        <Input required value={reg.ownerName} onChange={(e) => setReg({ ...reg, ownerName: e.target.value })} placeholder="e.g. Adewale Ogunleye" />
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label>Business email</Label>
                        <Input type="email" required value={reg.regEmail} onChange={(e) => setReg({ ...reg, regEmail: e.target.value })} placeholder="owner@business.ng" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Phone</Label>
                        <Input value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+234…" />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Password</Label>
                        <Input type="password" required minLength={8} value={reg.regPassword} onChange={(e) => setReg({ ...reg, regPassword: e.target.value })} placeholder="min 8 characters" />
                      </div>
                      <div className="space-y-1.5 col-span-2">
                        <Label>Address (optional)</Label>
                        <Input value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} placeholder="Shop address" />
                      </div>
                    </div>
                    {regError && <p className="text-sm text-red-600">{regError}</p>}
                    {regDone && <p className="text-sm text-teal-700">Business created! Signing you in…</p>}
                    <Button type="submit" className="w-full bg-teal-600 hover:bg-teal-700" disabled={regLoading || regDone}>
                      {regLoading ? "Creating workspace…" : "Create business workspace"}
                    </Button>
                    <p className="text-xs text-slate-500">
                      By registering you agree to SynkiSell&apos;s pilot terms. One-time deployment fee ₦60,000 + annual subscription ₦120,000 (proposed pilot pricing — billed separately after setup).
                    </p>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
