"use server";

import { z } from "zod";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { guarded, requirePermission } from "@/lib/guards";
import { audit } from "@/lib/audit";
import { runAiTool, AI_TOOLS } from "@/server/ai/tools";
import { runForecast } from "@/server/ai/forecast";

/**
 * AI usage limit — per business, per calendar month, from the plan.
 */
async function checkAiQuota(businessId: string): Promise<void> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const used = await db.aiUsage.count({ where: { businessId, createdAt: { gte: monthStart } } });
  const sub = await db.subscription.findUnique({ where: { businessId }, include: { plan: { select: { aiMonthlyLimit: true } } } });
  const limit = sub?.plan?.aiMonthlyLimit ?? 200;
  if (used >= limit) {
    throw new Error(`AI monthly limit reached (${used}/${limit} calls this month). Contact SynkiSell support to raise your plan limit.`);
  }
}

async function meterUsage(businessId: string, userId: string, kind: string) {
  await db.aiUsage.create({ data: { businessId, userId, kind } });
}

const FALLBACK_NOTICE = "AI provider unavailable — showing the computed figures without narrative.";

/* ─────────────────────── AI summaries ─────────────────────── */

export async function generateAiSummary(businessId: string, periodType: "DAILY" | "WEEKLY" | "MONTHLY") {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "ai.use");
    await checkAiQuota(ctx.businessId);

    const days = periodType === "DAILY" ? 1 : periodType === "WEEKLY" ? 7 : 30;
    const periodStart = new Date(Date.now() - days * 864e5);

    // 1) Compute ALL aggregates server-side first (validated numbers only)
    const aggregates: Record<string, unknown> = {};
    for (const t of ["salesSummary", "comparePeriods", "topProducts", "slowMovers", "lowStock", "expiringStock", "expenses"]) {
      aggregates[t] = await runAiTool(ctx.businessId, "ai.use", t, { days: periodType === "DAILY" ? 1 : days });
    }

    // 2) Ask the model to narrate ONLY these numbers
    let narrative: string;
    let modelUsed: string | null = null;
    try {
      const zai = await ZAI.create();
      const prompt = `You are the business analyst assistant for a Nigerian pharmacy + supermarket. All money figures are Nigerian Naira — always write them with the ₦ symbol (e.g. ₦12,500). Write a concise, professional summary (max 180 words, 3-5 sentences) for the business owner covering: overall sales performance vs previous period, best and slow movers, stockout risks, expiring stock exposure, and expenses. Use ONLY the numbers provided — never invent figures, percentages or causes. If a data point is missing or zero, say so plainly.

DATA (JSON):
${JSON.stringify(aggregates, null, 1)}

Write the summary now.`;
      const completion = await zai.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
      });
      narrative = completion.choices[0]?.message?.content?.trim() || "";
      modelUsed = "glm-4.5-flash (server SDK)";
      if (!narrative) throw new Error("empty completion");
    } catch {
      // 3) Safe fallback: deterministic narrative from aggregates, labelled
      const s = aggregates.salesSummary as { data: { totalSales: number; grossProfit: number; salesCount: number; byDepartment: Record<string, number> } };
      const c = aggregates.comparePeriods as { data: { current: number; previous: number } };
      const l = aggregates.lowStock as { data: unknown[] };
      const e = aggregates.expiringStock as { data: { valueAtCost: number }[] };
      const diff = c.data.current - c.data.previous;
      narrative = `${FALLBACK_NOTICE} Sales for the period: ₦${s.data.totalSales.toLocaleString()} across ${s.data.salesCount} completed sale(s); estimated gross profit ₦${s.data.grossProfit.toLocaleString()} (product cost only). ${diff >= 0 ? "Sales are up" : "Sales are down"} ₦${Math.abs(diff).toLocaleString()} vs the previous equal period. ${l.data.length} product(s) are at/below reorder level. Expiring stock exposure: ₦${e.data.reduce((a, b) => a + b.valueAtCost, 0).toLocaleString()}.`;
    }

    await meterUsage(ctx.businessId, ctx.userId, "SUMMARY");

    const summary = await db.aiSummary.create({
      data: {
        businessId: ctx.businessId,
        periodType,
        periodStart,
        periodEnd: new Date(),
        contentJson: JSON.stringify({ narrative }),
        aggregatesJson: JSON.stringify(aggregates),
        model: modelUsed,
      },
    });

    return {
      ok: true,
      id: summary.id,
      narrative,
      modelUsed,
      periodType,
      generatedAt: summary.generatedAt.toISOString(),
      aggregates,
    };
  });
}

export async function listAiSummaries(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "ai.use");
    return db.aiSummary.findMany({ where: { businessId: ctx.businessId }, orderBy: { generatedAt: "desc" }, take: 10 });
  });
}

/* ─────────────────────── Ask your business ─────────────────────── */

export async function askBusinessQuestion(businessId: string, question: string) {
  return guarded(async () => {
    const d = z.object({ question: z.string().min(5).max(400) }).parse({ question });
    const ctx = await requirePermission(businessId, "ai.use");
    await checkAiQuota(ctx.businessId);

    let answer: string;
    let toolsUsed: { tool: string; result: unknown }[] = [];
    let modelUsed: string | null = null;

    try {
      const zai = await ZAI.create();
      // Ask the model to pick tools; we execute them with tenant pinning
      const toolList = AI_TOOLS.map((t) => `- ${t.name}: ${t.description} (args: ${JSON.stringify(t.args)})`).join("\n");
      const planner = await zai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a data analyst for a business dashboard. The user asks a question about their business data. Choose up to 3 tools that would answer it. Respond ONLY with a JSON array like [{"tool":"salesSummary","args":{"days":7}}]. Tools:\n${toolList}\nIf NO tool can answer the question, respond with [].`,
          },
          { role: "user", content: d.question },
        ],
      });
      let planRaw = planner.choices[0]?.message?.content?.trim() || "[]";
      const jsonMatch = planRaw.match(/\[[\s\S]*\]/);
      let plan: { tool: string; args?: Record<string, unknown> }[] = [];
      try {
        plan = JSON.parse(jsonMatch ? jsonMatch[0] : "[]");
      } catch {
        plan = [];
      }

      // Execute authorised tools ONLY (server-pinned tenant, validated args)
      const executed: Record<string, unknown>[] = [];
      for (const p of plan.slice(0, 3)) {
        if (!AI_TOOLS.some((t) => t.name === p.tool)) continue;
        try {
          const result = await runAiTool(ctx.businessId, "ai.use", p.tool, p.args ?? {});
          executed.push(result);
          toolsUsed.push({ tool: p.tool, result: result.data });
        } catch {
          // skip failing tool, continue
        }
      }

      if (!executed.length) {
        answer = `I couldn't map that question to available business data tools. I can answer questions about: ${AI_TOOLS.map((t) => t.description.toLowerCase()).join("; ")}. Please rephrase, or ask e.g. "Which products sold best last week?"`;
      } else {
        const completion = await zai.chat.completions.create({
          messages: [
            {
              role: "system",
              content:
                "You answer business-owner questions using ONLY the provided computed data (JSON). All money values are Nigerian Naira — always use the ₦ symbol (e.g. ₦12,500). Cite the period covered and the basis of calculation. Never invent numbers. Be concise (max 150 words). If the data does not fully answer the question, say what is missing.",
            },
            { role: "user", content: `Question: ${d.question}\n\nCOMPUTED DATA:\n${JSON.stringify(executed, null, 1)}` },
          ],
        });
        answer = completion.choices[0]?.message?.content?.trim() || "No answer produced.";
        modelUsed = "glm-4.5-flash (server SDK)";
      }
    } catch {
      // Deterministic fallback for the most common question shapes
      try {
        const result = await runAiTool(ctx.businessId, "ai.use", "salesSummary", { days: 7 });
        toolsUsed = [{ tool: "salesSummary", result: result.data }];
        const data = result.data as { totalSales: number; grossProfit: number; salesCount: number };
        answer = `${FALLBACK_NOTICE} Over ${result.period}, total sales were ₦${data.totalSales.toLocaleString()} from ${data.salesCount} completed sale(s); estimated gross profit ₦${data.grossProfit.toLocaleString()} (excludes operating expenses).`;
      } catch {
        answer = FALLBACK_NOTICE + " Please try again shortly.";
      }
    }

    await meterUsage(ctx.businessId, ctx.userId, "QA");

    await audit({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorLabel: ctx.userName,
      action: "AI_QUESTION",
      entityType: "AiUsage",
      meta: { question: d.question, tools: toolsUsed.map((t) => t.tool) },
    });

    return { ok: true, answer, toolsUsed, modelUsed, askedAt: new Date().toISOString() };
  });
}

/* ─────────────────────── Forecasting ─────────────────────── */

export async function generateForecast(businessId: string, productId: string, horizonDays?: number) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "ai.forecast");
    const result = await runForecast(ctx.businessId, productId, Math.min(60, Math.max(7, horizonDays ?? 14)));

    // AI explanation of the computed numbers (numbers are already final)
    let explanation: string | null = null;
    try {
      await checkAiQuota(ctx.businessId);
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "system",
            content:
              "Explain this inventory demand forecast to a shop owner in max 80 words. Use ONLY the provided figures. Distinguish estimates from recorded facts. Mention the uncertainty band and any stockout caveat.",
          },
          { role: "user", content: JSON.stringify(result) },
        ],
      });
      explanation = completion.choices[0]?.message?.content?.trim() || null;
      await meterUsage(ctx.businessId, ctx.userId, "FORECAST_EXPLAIN");
    } catch {
      explanation = null;
    }

    return { ok: true, ...result, explanation };
  });
}

export async function listForecasts(businessId: string) {
  return guarded(async () => {
    const ctx = await requirePermission(businessId, "ai.forecast");
    const forecasts = await db.forecast.findMany({
      where: { businessId: ctx.businessId },
      include: { product: { select: { name: true, baseUnit: true, reorderLevel: true } } },
      orderBy: { generatedAt: "desc" },
      take: 40,
    });
    // keep only the latest per product
    const seen = new Set<string>();
    return forecasts.filter((f) => {
      if (seen.has(f.productId)) return false;
      seen.add(f.productId);
      return true;
    });
  });
}

export async function getAiQuota(businessId: string) {
  return guarded(async () => {
    await requirePermission(businessId, "ai.use");
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const used = await db.aiUsage.count({ where: { businessId, createdAt: { gte: monthStart } } });
    const sub = await db.subscription.findUnique({ where: { businessId }, include: { plan: { select: { aiMonthlyLimit: true } } } });
    return { used, limit: sub?.plan?.aiMonthlyLimit ?? 200 };
  });
}
