/**
 * Sequential document numbers per business: SLS-000001, RFD-000001,
 * PO-000001, GRN-000001, INV-000001.
 * Called inside the same transaction as the creating operation.
 *
 * PostgreSQL implementation: an atomic per-(business, prefix) SEQUENCE.
 * The previous read-max-then-increment approach races under concurrent
 * checkouts — two cashiers selling at once both read the same max and the
 * loser fails with P2002 on (businessId, number). `nextval` is atomic, needs
 * no locks, and works at any concurrency. Sequence values consumed by rolled
 * back transactions produce occasional gaps — document numbers already had
 * gaps (rejected/simulated flows) and Nigerian e-invoicing does not require
 * gapless numbering.
 *
 * First-use self-heal: if the sequence does not exist yet, the failing
 * nextval aborts the transaction (25P02), so the attempt is wrapped in a
 * SAVEPOINT; after ROLLBACK TO SAVEPOINT the sequence is created INSIDE the
 * same transaction (the tx sees its own uncommitted DDL, so the immediate
 * retry succeeds; if the sale later rolls back, the sequence creation rolls
 * back with it and the next sale re-heals).
 */
type Tx = { [key: string]: any }; // Prisma transaction client (structural)

const SEQ_RE = /^[A-Za-z0-9_-]+$/; // sequence identifiers are built from these only
const SP = "docnum_alloc_sp"; // per-call savepoint (a tx allocates one number at a time)

export async function nextDocNumber(tx: Tx, businessId: string, prefix: "SLS" | "RFD" | "PO" | "GRN" | "INV" | "DPO"): Promise<string> {
  const table =
    prefix === "SLS" ? tx.sale : prefix === "RFD" ? tx.refund : prefix === "PO" ? tx.purchaseOrder : prefix === "GRN" ? tx.goodsReceipt : tx.invoice;

  // regclass folds unquoted identifiers to lowercase — keep the whole name
  // lowercase so CREATE SEQUENCE and nextval() always resolve the same object.
  const seqName = `doc_${prefix.toLowerCase()}_${businessId}`;
  if (!SEQ_RE.test(seqName)) throw new Error("BAD_SEQUENCE_IDENTIFIER");

  // Fallback for non-PostgreSQL test doubles without raw SQL support.
  if (typeof tx.$queryRawUnsafe !== "function") return legacyNext(tx, table, businessId, prefix);

  await tx.$executeRawUnsafe(`SAVEPOINT ${SP}`);
  try {
    const rows = (await tx.$queryRawUnsafe("SELECT nextval($1::regclass) AS next", seqName)) as { next: bigint | string }[];
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SP}`).catch(() => {});
    return formatSeq(prefix, rows[0]?.next);
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    // Recover the aborted transaction before doing anything else.
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SP}`).catch(() => {});
    if (!/42P01|does not exist/i.test(msg)) throw err;

    // First allocation for this (business, prefix): create the sequence inside
    // the recovered transaction — its own DDL is immediately visible to it.
    const last = await legacyLast(tx, table, businessId, prefix);
    const start = last + 1;
    await tx.$executeRawUnsafe(`CREATE SEQUENCE IF NOT EXISTS "${seqName}" START ${start}`);
    const rows2 = (await tx.$queryRawUnsafe("SELECT nextval($1::regclass) AS next", seqName)) as { next: bigint | string }[];
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SP}`).catch(() => {});
    return formatSeq(prefix, rows2[0]?.next);
  }
}

async function legacyLast(tx: Tx, table: Tx, businessId: string, prefix: string): Promise<number> {
  const last = await table.findFirst({
    where: { businessId, number: { startsWith: `${prefix}-` } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last ? parseInt(last.number.split("-")[1] ?? "0", 10) : 0;
  return isNaN(lastSeq) ? 0 : lastSeq;
}

/** Legacy read-max-then-increment — only for non-PostgreSQL test doubles. */
async function legacyNext(tx: Tx, table: Tx, businessId: string, prefix: string): Promise<string> {
  const next = (await legacyLast(tx, table, businessId, prefix)) + 1;
  return `${prefix}-${String(next).padStart(6, "0")}`;
}

function formatSeq(prefix: string, raw: bigint | string | undefined): string {
  const n = typeof raw === "bigint" ? Number(raw) : Number(raw ?? 1);
  return `${prefix}-${String(Number.isFinite(n) ? n : 1).padStart(6, "0")}`;
}
