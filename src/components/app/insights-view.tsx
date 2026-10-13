"use client";

import { useCallback, useState } from "react";
import { generateAiSummary, listAiSummaries, askBusinessQuestion, generateForecast, listForecasts, getAiQuota } from "@/server/actions/ai-actions";
import { listProducts } from "@/server/actions/catalog-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/app-store";
import { Sparkles, MessageCircleQuestion, TrendingUp, Send, Info } from "lucide-react";
import { useDataLoader } from "@/hooks/use-data-loader";

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">AI Insights</h1>
          <p className="text-sm text-slate-500">Every number is computed by validated queries first — the AI narrates, it never invents.</p>
        </div>
        {quota && <Badge variant="outline" className={quota.used >= quota.limit ? "border-red-300 text-red-600" : "border-teal-200 text-teal-700"}>AI usage: {quota.used}/{quota.limit} this month</Badge>}
      </div>

      <Tabs defaultValue="summaries">
        <TabsList>
          <TabsTrigger value="summaries"><Sparkles className="h-3.5 w-3.5 mr-1" /> Summaries</TabsTrigger>
          <TabsTrigger value="ask"><MessageCircleQuestion className="h-3.5 w-3.5 mr-1" /> Ask your business</TabsTrigger>
          <TabsTrigger value="forecast"><TrendingUp className="h-3.5 w-3.5 mr-1" /> Forecasting</TabsTrigger>
        </TabsList>

        <TabsContent value="summaries" className="mt-4 space-y-4">
          <div className="flex gap-2">
            {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((p) => (
              <Button key={p} size="sm" variant="outline" className="border-teal-200 text-teal-700" onClick={() => void handleGenerate(p)} disabled={generating !== null}>
                {generating === p ? "Generating…" : `Generate ${p.toLowerCase()}`}
              </Button>
            ))}
          </div>

          {latest && (
            <Card className="border-teal-200 bg-teal-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{latest.periodType.charAt(0) + latest.periodType.slice(1).toLowerCase()} summary</CardTitle>
                <CardDescription>{latest.modelUsed ? `AI: ${latest.modelUsed}` : "Deterministic fallback"} • {new Date().toLocaleString()}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">{latest.narrative}</CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {summaries.filter((s) => !latest || s.contentJson !== JSON.stringify({ narrative: latest.narrative })).map((s) => {
              let narrative = "";
              try { narrative = JSON.parse(s.contentJson).narrative; } catch { narrative = "(unreadable summary)"; }
              return (
                <Card key={s.id}>
                  <CardHeader className="pb-1">
                    <CardTitle className="text-sm">{s.periodType.charAt(0) + s.periodType.slice(1).toLowerCase()} • {new Date(s.generatedAt).toLocaleString()}</CardTitle>
                    {s.model && <CardDescription className="text-xs">AI: {s.model}</CardDescription>}
                  </CardHeader>
                  <CardContent className="text-sm leading-relaxed">{narrative}</CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="ask" className="mt-4 space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder='e.g. "Which products generated the highest gross profit last month?"'
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && question.length >= 5 && void handleAsk()}
                />
                <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleAsk()} disabled={asking || question.length < 5}><Send className="h-4 w-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["What is the value of stock expiring in the next 60 days?", "Which products need restocking?", "Compare pharmacy and supermarket sales this week.", "How did today's sales compare with yesterday?"].map((q) => (
                  <button key={q} className="text-xs rounded-full border px-2.5 py-1 text-slate-500 hover:border-teal-400 hover:text-teal-700" onClick={() => setQuestion(q)}>{q}</button>
                ))}
              </div>
              {asking && <p className="text-sm text-slate-400 animate-pulse">Consulting your business data…</p>}
              {answer && (
                <div className="rounded-lg border bg-slate-50 p-4 space-y-2">
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{answer.answer}</p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {answer.toolsUsed.map((t, i) => <Badge key={i} variant="outline" className="text-[10px] border-teal-200 text-teal-700">tool: {t.tool}</Badge>)}
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
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forecast" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 grid gap-3 md:grid-cols-3 items-end">
              <div className="space-y-1">
                <Label>Product</Label>
                <Select value={forecastProduct} onValueChange={setForecastProduct}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    <ScrollArea className="max-h-60">{products.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</ScrollArea>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Horizon (days)</Label><Input value={horizon} onChange={(e) => setHorizon(e.target.value)} inputMode="numeric" /></div>
              <Button className="bg-teal-600 hover:bg-teal-700" onClick={() => void handleForecast()} disabled={!forecastProduct}><TrendingUp className="h-4 w-4 mr-1" /> Forecast demand</Button>
            </CardContent>
          </Card>

          {forecastResult && (
            <Card className="border-teal-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{forecastResult.productName} — {forecastResult.horizonDays ?? 14}-day outlook</CardTitle>
                <CardDescription>
                  Method: {forecastResult.method} {forecastResult.isPreliminary && <Badge variant="outline" className="ml-1 border-amber-300 text-amber-700">PRELIMINARY — insufficient history</Badge>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                  <div><p className="text-xs text-slate-500">Est. daily demand</p><p className="font-bold">{forecastResult.dailyDemand}</p></div>
                  <div><p className="text-xs text-slate-500">Uncertainty band</p><p className="font-semibold">{forecastResult.lowBand} – {forecastResult.highBand}</p></div>
                  <div><p className="text-xs text-slate-500">Available stock</p><p className="font-semibold">{forecastResult.availableStock}</p></div>
                  <div><p className="text-xs text-slate-500">Incoming (open POs)</p><p className="font-semibold">{forecastResult.incomingQty}</p></div>
                  <div><p className="text-xs text-slate-500">Suggested reorder</p><p className="font-bold text-teal-700">{forecastResult.suggestedReorderQty ?? "—"}</p></div>
                </div>
                {forecastResult.explanation && (
                  <div className="rounded-lg bg-slate-50 border p-3 text-sm">{forecastResult.explanation}</div>
                )}
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">Assumptions & limitations</p>
                  <ul className="text-xs text-slate-500 list-disc pl-4 space-y-0.5">
                    {forecastResult.assumptions.map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Latest forecasts per product</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Method</TableHead><TableHead className="text-right">Daily demand</TableHead><TableHead className="text-right">Band</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Reorder?</TableHead><TableHead>When</TableHead></TableRow></TableHeader>
                <TableBody>
                  {forecasts.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.product.name}</TableCell>
                      <TableCell><Badge variant="outline" className={cnBadge(f)}>{f.method}</Badge></TableCell>
                      <TableCell className="text-right">{Number(f.dailyDemand)}</TableCell>
                      <TableCell className="text-right text-xs">{Number(f.lowBand)}–{Number(f.highBand)}</TableCell>
                      <TableCell className="text-right">{Number(f.availableStock)}</TableCell>
                      <TableCell className="text-right font-semibold text-teal-700">{f.suggestedReorderQty ? Number(f.suggestedReorderQty) : "—"}</TableCell>
                      <TableCell className="text-xs text-slate-400">{new Date(f.generatedAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {!forecasts.length && <TableRow><TableCell colSpan={7} className="text-center py-8 text-slate-400">No forecasts yet — generate one above.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function cnBadge(f: ForecastRow) {
  return f.isPreliminary ? "border-amber-300 text-amber-700" : "border-emerald-200 text-emerald-700";
}
