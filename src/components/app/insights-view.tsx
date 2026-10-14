"use client";

import { useCallback, useState } from "react";
import { generateAiSummary, listAiSummaries, askBusinessQuestion, generateForecast, listForecasts, getAiQuota } from "@/server/actions/ai-actions";
import { listProducts } from "@/server/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import { Sparkles, MessageCircleQuestion, TrendingUp, Send, Info } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";
import { GlassCard, PageHeader, EmptyState, Stagger, FadeIn } from "./ui/primitives";
import { InlineLoading } from "./ui/loading";
import { cn } from "@/lib/utils";

type SummaryRow = { id: string; periodType: string; generatedAt: string; contentJson: string; model: string | null };
type ForecastRow = {
  id: string; method: string; isPreliminary: boolean; horizonDays: number;
  dailyDemand: { toString(): string }; lowBand: { toString(): string }; highBand: { toString(): string };
  availableStock: { toString(): string }; incomingQty: { toString(): string };
  suggestedReorderQty: { toString(): string } | null; assumptionsJson: string | null; generatedAt: string;
  product: { name: string; baseUnit: string; reorderLevel: { toString(): string } };
};

export function InsightsView({ businessId }: { businessId: string }) {
  const { toast } = useToast();
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const [summaries, setSummaries] = useState<SummaryRow[]>([]);
  const [forecasts, setForecasts] = useState<ForecastRow[]>([]);
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ narrative: string; modelUsed: string | null; periodType: string } | null>(null);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; toolsUsed: { tool: string }[]; modelUsed: string | null } | null>(null);
  const [asking, setAsking] = useState(false);

  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [forecastProduct, setForecastProduct] = useState("");
  const [horizon, setHorizon] = useState("14");
  const [forecastResult, setForecastResult] = useState<{ productName: string; method: string; isPreliminary: boolean; horizonDays?: number; dailyDemand: number; lowBand: number; highBand: number; availableStock: number; incomingQty: number; suggestedReorderQty: number | null; assumptions: string[]; explanation: string | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, f, q, p] = await Promise.all([
        listAiSummaries(businessId) as unknown as Promise<SummaryRow[]>,
        listForecasts(businessId) as unknown as Promise<ForecastRow[]>,
        getAiQuota(businessId) as unknown as Promise<{ used: number; limit: number }>,
        listProducts(businessId) as unknown as Promise<{ id: string; name: string }[]>,
      ]);
      setSummaries(s);
      setForecasts(f);
      setQuota(q);
      setProducts(p);
    } catch (err) {
      toast({ title: "Load failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }, [businessId, toast]);

  useDataLoader(load, [load]);

  async function handleGenerate(periodType: "DAILY" | "WEEKLY" | "MONTHLY") {
    setGenerating(periodType);
    try {
      const result = (await generateAiSummary(businessId, periodType)) as unknown as { narrative: string; modelUsed: string | null; periodType: string };
      setLatest(result);
      toast({ title: `${periodType.charAt(0) + periodType.slice(1).toLowerCase()} summary generated` });
      void load();
    } catch (err) {
      toast({ title: "Generation failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setGenerating(null);
    }
  }

  async function handleAsk() {
    setAsking(true);
    setAnswer(null);
    try {
      const result = (await askBusinessQuestion(businessId, question)) as unknown as { answer: string; toolsUsed: { tool: string }[]; modelUsed: string | null };
      setAnswer(result);
      void load();
    } catch (err) {
      toast({ title: "Could not answer", description: err instanceof Error ? err.message : "", variant: "destructive" });
    } finally {
      setAsking(false);
    }
  }

  async function handleForecast() {
    if (!forecastProduct) return;
    try {
      const result = (await generateForecast(businessId, forecastProduct, Number(horizon))) as unknown as typeof forecastResult;
      setForecastResult(result);
      bumpRefresh();
      void load();
    } catch (err) {
      toast({ title: "Forecast failed", description: err instanceof Error ? err.message : "", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Insights"
        subtitle="Every number is computed by validated queries first — the AI narrates, it never invents."
        actions={
          quota && (
            <Badge
              variant="outline"
              className={cn(
                "tabular-nums",
                quota.used >= quota.limit ? "border-destructive/40 text-destructive" : "border-primary/30 text-primary"
              )}
            >
              AI usage: {quota.used}/{quota.limit} this month
            </Badge>
          )
        }
      />

      <Tabs defaultValue="summaries">
        <TabsList>
          <TabsTrigger value="summaries"><Sparkles className="h-3.5 w-3.5 mr-1" /> Summaries</TabsTrigger>
          <TabsTrigger value="ask"><MessageCircleQuestion className="h-3.5 w-3.5 mr-1" /> Ask your business</TabsTrigger>
          <TabsTrigger value="forecast"><TrendingUp className="h-3.5 w-3.5 mr-1" /> Forecasting</TabsTrigger>
        </TabsList>

        <TabsContent value="summaries" className="mt-4 space-y-4">
          <div className="no-print flex flex-wrap gap-2">
            {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((p) => (
              <Button key={p} size="sm" variant="outline" onClick={() => void handleGenerate(p)} disabled={generating !== null}>
                {generating === p ? "Generating…" : `Generate ${p.toLowerCase()}`}
              </Button>
            ))}
          </div>

          {generating !== null && (
            <GlassCard intensity="subtle" className="rounded-2xl">
              <InlineLoading label="Generating from your records" className="py-8" />
            </GlassCard>
          )}

          {latest && (
            <FadeIn>
              {/* AI panel — animated gradient border is reserved for AI surfaces */}
              <div className="border-flow glass rounded-2xl" aria-label={`${latest.periodType.toLowerCase()} AI summary`}>
                <div className="flex flex-wrap items-center gap-2.5 px-5 pt-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[0.95rem] font-semibold leading-tight">{latest.periodType.charAt(0) + latest.periodType.slice(1).toLowerCase()} summary</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{latest.modelUsed ? `AI: ${latest.modelUsed}` : "Deterministic fallback"} • {new Date().toLocaleString()}</p>
                  </div>
                </div>
                <div className="whitespace-pre-wrap px-5 pb-5 pt-3 text-sm leading-relaxed">{latest.narrative}</div>
              </div>
            </FadeIn>
          )}

          <div className="space-y-3">
            {summaries.filter((s) => !latest || s.contentJson !== JSON.stringify({ narrative: latest.narrative })).map((s) => {
              let narrative = "";
              try { narrative = JSON.parse(s.contentJson).narrative; } catch { narrative = "(unreadable summary)"; }
              return (
                <GlassCard key={s.id} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">{s.periodType.charAt(0) + s.periodType.slice(1).toLowerCase()} • {new Date(s.generatedAt).toLocaleString()}</h3>
                    {s.model && <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">AI: {s.model}</Badge>}
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">{narrative}</p>
                </GlassCard>
              );
            })}
            {!latest && !summaries.length && (
              <EmptyState
                icon={Sparkles}
                title="No summaries yet"
                hint="Generate a daily, weekly or monthly summary above — every insight is built strictly from your own records."
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="ask" className="mt-4 space-y-3">
          <FadeIn>
            <GlassCard className="space-y-3 p-4 sm:p-5">
              <div className="no-print flex gap-2">
                <Input
                  aria-label="Ask a question about your business"
                  placeholder='e.g. "Which products generated the highest gross profit last month?"'
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && question.length >= 5 && void handleAsk()}
                />
                <Button aria-label="Ask" onClick={() => void handleAsk()} disabled={asking || question.length < 5}><Send className="h-4 w-4" /></Button>
              </div>
              <div className="no-print flex flex-wrap gap-1.5">
                {["What is the value of stock expiring in the next 60 days?", "Which products need restocking?", "Compare pharmacy and supermarket sales this week.", "How did today's sales compare with yesterday?"].map((q) => (
                  <button key={q} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary" onClick={() => setQuestion(q)}>{q}</button>
                ))}
              </div>
              {asking && <p className="animate-pulse text-sm text-muted-foreground" role="status">Consulting your business data…</p>}
              {answer && (
                <div className="border-flow glass space-y-2 rounded-xl p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer.answer}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {answer.toolsUsed.map((t, i) => <Badge key={i} variant="outline" className="border-primary/30 text-[10px] text-primary">tool: {t.tool}</Badge>)}
                    {answer.modelUsed && <Badge variant="outline" className="text-[10px]">{answer.modelUsed}</Badge>}
                  </div>
                </div>
              )}
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Answers come from an authorised set of analytical tools — never raw SQL, never other businesses&apos; data. The AI cannot change stock, prices, refunds or permissions; it can only recommend.
                </AlertDescription>
              </Alert>
            </GlassCard>
          </FadeIn>
        </TabsContent>

        <TabsContent value="forecast" className="mt-4 space-y-4">
          <FadeIn>
            <GlassCard className="no-print p-4 sm:p-5">
              <div className="grid gap-3 md:grid-cols-3 md:items-end">
                <div className="space-y-1.5">
                  <Label htmlFor="fc-product">Product</Label>
                  <Select value={forecastProduct} onValueChange={setForecastProduct}>
                    <SelectTrigger id="fc-product"><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>
                      <ScrollArea className="max-h-60">{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</ScrollArea>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fc-horizon">Horizon (days)</Label>
                  <Input id="fc-horizon" value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" />
                </div>
                <Button onClick={() => void handleForecast()} disabled={!forecastProduct}><TrendingUp className="h-4 w-4 mr-1" /> Forecast demand</Button>
              </div>
            </GlassCard>
          </FadeIn>

          {forecastResult && (
            <FadeIn>
              <GlassCard className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-4">
                  <div>
                    <h3 className="text-[0.95rem] font-semibold leading-tight">{forecastResult.productName} — {forecastResult.horizonDays ?? 14}-day outlook</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Method: {forecastResult.method}</p>
                  </div>
                  {forecastResult.isPreliminary && <Badge variant="outline" className="border-amber-300 text-amber-700">PRELIMINARY — insufficient history</Badge>}
                </div>
                <div className="space-y-4 px-5 pb-5 pt-4">
                  <section aria-label="Forecast for the selected horizon">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forecast — next {forecastResult.horizonDays ?? 14} days</p>
                    <Stagger className="mt-2 grid gap-3 sm:grid-cols-2">
                      <div className="glass-subtle rounded-xl p-4">
                        <p className="text-xs text-muted-foreground">Est. daily demand</p>
                        <p className="mt-1 text-2xl font-bold tabular-nums">{forecastResult.dailyDemand}</p>
                      </div>
                      <div className="glass-subtle rounded-xl p-4">
                        <p className="text-xs text-muted-foreground">Uncertainty band</p>
                        <p className="mt-1 text-2xl font-semibold tabular-nums">{forecastResult.lowBand} – {forecastResult.highBand}</p>
                        <p className="mt-1 text-xs text-muted-foreground">low – high</p>
                      </div>
                    </Stagger>
                  </section>
                  <section aria-label="Current stock position">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">On hand now</p>
                    <Stagger className="mt-2 grid gap-3 sm:grid-cols-2" delay={0.05}>
                      <div className="glass-subtle rounded-xl p-4">
                        <p className="text-xs text-muted-foreground">Available stock</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{forecastResult.availableStock}</p>
                      </div>
                      <div className="glass-subtle rounded-xl p-4">
                        <p className="text-xs text-muted-foreground">Incoming (open POs)</p>
                        <p className="mt-1 text-xl font-semibold tabular-nums">{forecastResult.incomingQty}</p>
                      </div>
                    </Stagger>
                  </section>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                    <span className="text-sm font-medium">Suggested reorder</span>
                    <span className="text-xl font-bold tabular-nums text-primary">{forecastResult.suggestedReorderQty ?? "—"}</span>
                  </div>
                  {forecastResult.explanation && (
                    <div className="glass-subtle rounded-xl p-4 text-sm">{forecastResult.explanation}</div>
                  )}
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">Assumptions &amp; limitations</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {forecastResult.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                    </ul>
                  </div>
                </div>
              </GlassCard>
            </FadeIn>
          )}

          <FadeIn>
            <GlassCard className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
                <h3 className="text-[0.95rem] font-semibold leading-tight">Latest forecasts per product</h3>
                {forecasts.length > 0 && <Badge variant="outline">{forecasts.length}</Badge>}
              </div>
              <div className="pb-4 pt-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Daily demand</TableHead>
                      <TableHead className="text-right">Band</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead className="text-right">Reorder?</TableHead>
                      <TableHead>When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {forecasts.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-medium">{f.product.name}</TableCell>
                        <TableCell><Badge variant="outline" className={cnBadge(f)}>{f.method}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{Number(f.dailyDemand)}</TableCell>
                        <TableCell className="text-right text-xs tabular-nums">{Number(f.lowBand)}–{Number(f.highBand)}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number(f.availableStock)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums text-[oklch(0.50_0.11_163)]">{f.suggestedReorderQty ? Number(f.suggestedReorderQty) : "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(f.generatedAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                    {!forecasts.length && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <EmptyState icon={TrendingUp} title="No forecasts yet" hint="Generate one above." className="border-0" />
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </GlassCard>
          </FadeIn>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function cnBadge(f: ForecastRow) {
  return f.isPreliminary ? "border-amber-300 text-amber-700" : "border-[oklch(0.585_0.115_163/0.4)] text-[oklch(0.50_0.11_163)]";
}
