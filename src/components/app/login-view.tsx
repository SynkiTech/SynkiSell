"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { registerBusiness } from "@/server/actions/auth-actions";
import { NIGERIAN_STATES } from "./states";
import { BrandLogo, BrandWordmark } from "./ui/brand";
import { FadeIn } from "./ui/primitives";

/** Password input with visibility toggle (secure entry, accessible label). */
function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  required = true,
  minLength,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

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
    <div className="relative min-h-screen overflow-hidden lg:flex">
      {/* Living gradient scene — richer than the app ambient (marketing surface) */}
      <div
        className="fixed inset-0 -z-10"
        style={{ background: "var(--grad-navy)" }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -left-40 -top-40 h-[42rem] w-[42rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.52 0.10 200 / 42%), transparent 65%)", animation: "ambient-drift-a 22s var(--ease-soft) infinite alternate" }}
        />
        <div
          className="absolute -bottom-52 -right-32 h-[46rem] w-[46rem] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, oklch(0.45 0.08 240 / 45%), transparent 65%)", animation: "ambient-drift-b 30s var(--ease-soft) infinite alternate" }}
        />
        <div
          className="absolute left-1/2 top-1/3 h-72 w-72 -translate-x-1/2 rounded-full blur-3xl opacity-30"
          style={{ background: "radial-gradient(circle, oklch(0.70 0.06 210 / 40%), transparent 70%)", animation: "ambient-drift-a 26s var(--ease-soft) infinite alternate-reverse" }}
        />
      </div>

      {/* Brand panel */}
      <div className="flex flex-1 flex-col items-center justify-center p-8 text-white lg:p-12">
        <FadeIn className="flex w-full max-w-lg flex-col items-center text-center">
          <div className="rounded-3xl p-5 glass-nav shadow-2xl">
            <BrandLogo size={170} withGlow withSweep priority />
          </div>
          <h1 className="mt-8 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            Run your pharmacy &amp; supermarket as <span className="text-gradient-light">one business</span>.
          </h1>
          <p className="mt-4 max-w-md text-[0.95rem] leading-relaxed text-white/65">
            One shared point of sale. Batch &amp; expiry control for medicines. Purchasing, staff, expenses and reports — with AI insights built in.
          </p>
          <div className="mt-9 grid w-full max-w-md grid-cols-3 gap-3">
            {["FEFO batch control", "Offline-capable POS", "AI business insights"].map((f) => (
              <div key={f} className="glass-nav rounded-xl px-3 py-3.5 text-center text-xs font-medium text-white/80 transition-colors hover:bg-white/10">
                {f}
              </div>
            ))}
          </div>
          <p className="mt-10 flex items-center gap-1.5 text-xs text-white/40">
            <ShieldCheck className="h-3.5 w-3.5" /> Role-based access • audited actions • tenant-isolated data
          </p>
        </FadeIn>
      </div>

      {/* Auth panel — frosted glass over the living gradient */}
      <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
        <FadeIn className="w-full max-w-md">
          <div className="glass-strong rounded-3xl p-6 sm:p-8">
            <div className="mb-6 flex items-center gap-2.5 lg:hidden">
              <BrandLogo size={44} />
              <BrandWordmark className="text-lg" />
            </div>
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Sign in</TabsTrigger>
                <TabsTrigger value="register">Register business</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <div className="pt-5">
                  <h2 className="text-lg font-semibold">Welcome back</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Sign in to your SynkiSell workspace.</p>
                </div>
                <form onSubmit={handleLogin} className="mt-5 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.ng" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" placeholder="••••••••" />
                  </div>
                  {error && (
                    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
                  )}
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
                <div className="mt-6 rounded-xl border bg-secondary/60 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-semibold text-foreground">Demo accounts (seeded)</p>
                  <p>Platform admin — admin@synkisell.com / SynkiAdmin#2026</p>
                  <p>Business owner — owner@firstpharmplus.ng / Owner#2026</p>
                  <p>Cashier — cashier@firstpharmplus.ng / Cashier#2026</p>
                </div>
              </TabsContent>

              <TabsContent value="register">
                <div className="pt-5">
                  <h2 className="text-lg font-semibold">Create your business account</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">Start your SynkiSell onboarding. Your workspace is created immediately.</p>
                </div>
                <form onSubmit={handleRegister} className="mt-5 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="reg-business">Business name</Label>
                      <Input id="reg-business" required value={reg.businessName} onChange={(e) => setReg({ ...reg, businessName: e.target.value })} placeholder="e.g. Fountain Pharma & Mart" />
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
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="reg-owner">Owner&apos;s full name</Label>
                      <Input id="reg-owner" required value={reg.ownerName} onChange={(e) => setReg({ ...reg, ownerName: e.target.value })} placeholder="e.g. Adewale Ogunleye" />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="reg-email">Business email</Label>
                      <Input id="reg-email" type="email" required value={reg.regEmail} onChange={(e) => setReg({ ...reg, regEmail: e.target.value })} placeholder="owner@business.ng" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-phone">Phone</Label>
                      <Input id="reg-phone" value={reg.phone} onChange={(e) => setReg({ ...reg, phone: e.target.value })} placeholder="+234…" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password">Password</Label>
                      <PasswordInput id="reg-password" value={reg.regPassword} onChange={(v) => setReg({ ...reg, regPassword: v })} minLength={8} placeholder="min 8 characters" />
                    </div>
                    <div className="col-span-2 space-y-1.5">
                      <Label htmlFor="reg-address">Address (optional)</Label>
                      <Input id="reg-address" value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} placeholder="Shop address" />
                    </div>
                  </div>
                  {regError && (
                    <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{regError}</p>
                  )}
                  {regDone && (
                    <p role="status" className="rounded-lg bg-[oklch(0.585_0.115_163/0.12)] px-3 py-2 text-sm text-[oklch(0.50_0.11_163)]">
                      Business created! Signing you in…
                    </p>
                  )}
                  <Button type="submit" className="w-full" disabled={regLoading || regDone}>
                    {regLoading ? "Creating workspace…" : "Create business workspace"}
                  </Button>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    By registering you agree to SynkiSell&apos;s pilot terms. One-time deployment fee ₦60,000 + annual subscription ₦120,000 (proposed pilot pricing — billed separately after setup).
                  </p>
                </form>
              </TabsContent>
            </Tabs>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
