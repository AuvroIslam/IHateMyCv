import fs from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { AiOutputError } from './ai';
import { storageMode } from './backend';
import { db } from './firebase-admin';
import { PLANS, type PlanId, USAGE_LABEL, type UsageKind, effectivePlan } from './plans';
import { readStore } from './store';
import { DATA_DIR, workspaceId } from './workspace';

/**
 * Caps on the work that costs money.
 *
 * - Monthly, per account, by plan (see plans.ts): what a plan includes.
 * - Daily, per account and per IP address: so nobody can spend a month's AI
 *   budget in an afternoon, nor dodge the caps with fresh accounts.
 *
 * LIMIT_SCALE multiplies them all (tests).
 */
const DAILY = { upload: 8, tailor: 40, chat: 150, import: 40 } as const satisfies Record<UsageKind, number>;
/** Several people can share an address (an office, a campus). */
const PER_IP_FACTOR = 4;

export type LimitKind = UsageKind;

interface DayCounts {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  ws: Record<string, Partial<Record<LimitKind, number>>>;
  ip: Record<string, Partial<Record<LimitKind, number>>>;
}
interface MonthCounts {
  /** UTC month, YYYY-MM. */
  month: string;
  ws: Record<string, Partial<Record<LimitKind, number>>>;
}

const DAY_FILE = path.join(DATA_DIR, 'limits.json');
const MONTH_FILE = path.join(DATA_DIR, 'limits-month.json');
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7);

let queue: Promise<unknown> = Promise.resolve();

async function readDay(): Promise<DayCounts> {
  try {
    const data = JSON.parse(await fs.readFile(DAY_FILE, 'utf8')) as DayCounts;
    if (data.day === today()) return data;
  } catch {
    // Missing or unreadable: a fresh day.
  }
  return { day: today(), ws: {}, ip: {} };
}

async function readMonth(): Promise<MonthCounts> {
  try {
    const data = JSON.parse(await fs.readFile(MONTH_FILE, 'utf8')) as MonthCounts;
    if (data.month === thisMonth()) return data;
  } catch {
    // Missing or unreadable: a fresh month.
  }
  return { month: thisMonth(), ws: {} };
}

/** The caller's address as the nearest proxy saw it. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
}

const dailyError = (kind: LimitKind) =>
  new AiOutputError(`You have reached today's limit for ${USAGE_LABEL[kind].many}. It resets at midnight UTC.`, 429);

const monthlyError = (kind: LimitKind, plan: PlanId, max: number) =>
  new AiOutputError(
    plan === 'power'
      ? `You have used all ${max} ${USAGE_LABEL[kind].many} in your plan this month. They reset on the 1st.`
      : `You have used all ${max} ${USAGE_LABEL[kind].many} in the ${PLANS[plan].name} plan this month. Upgrade on the Pricing page for more, or wait until the 1st.`,
    402,
  );

const monthDocId = (ws: string) => `${thisMonth()}_m_${ws}`;

/** Counts one use of `kind`, or throws when the plan's month or today's allowance is spent. */
export async function consume(kind: LimitKind): Promise<void> {
  const scale = Number(process.env.LIMIT_SCALE) || 1;
  const ws = await workspaceId();
  const ip = await clientIp();
  const plan = effectivePlan((await readStore(ws)).billing);
  const monthMax = PLANS[plan].monthly[kind] * scale;
  const mineMax = DAILY[kind] * scale;
  const theirsMax = DAILY[kind] * PER_IP_FACTOR * scale;

  if (storageMode() === 'firebase') {
    // Small documents per user (day and month) and per address (day),
    // counted in a transaction so concurrent requests cannot both take the
    // last use.
    const day = today();
    const col = db().collection('limits');
    const monthRef = col.doc(monthDocId(ws));
    const mineRef = col.doc(`${day}_u_${ws}`);
    const theirsRef = col.doc(`${day}_ip_${ip.replace(/[^\w.:-]/g, '_')}`);
    await db().runTransaction(async (tx) => {
      const [mo, m, t] = await Promise.all([tx.get(monthRef), tx.get(mineRef), tx.get(theirsRef)]);
      const used = (mo.get(kind) as number | undefined) ?? 0;
      const mine = (m.get(kind) as number | undefined) ?? 0;
      const theirs = (t.get(kind) as number | undefined) ?? 0;
      if (used >= monthMax) throw monthlyError(kind, plan, monthMax);
      if (mine >= mineMax || theirs >= theirsMax) throw dailyError(kind);
      tx.set(monthRef, { [kind]: used + 1, month: thisMonth() }, { merge: true });
      tx.set(mineRef, { [kind]: mine + 1, day }, { merge: true });
      tx.set(theirsRef, { [kind]: theirs + 1, day }, { merge: true });
    });
    return;
  }

  const run = queue.then(async () => {
    const [d, mo] = await Promise.all([readDay(), readMonth()]);
    const used = (mo.ws[ws] ??= {});
    const mine = (d.ws[ws] ??= {});
    const theirs = (d.ip[ip] ??= {});
    if ((used[kind] ?? 0) >= monthMax) throw monthlyError(kind, plan, monthMax);
    if ((mine[kind] ?? 0) >= mineMax || (theirs[kind] ?? 0) >= theirsMax) throw dailyError(kind);
    used[kind] = (used[kind] ?? 0) + 1;
    mine[kind] = (mine[kind] ?? 0) + 1;
    theirs[kind] = (theirs[kind] ?? 0) + 1;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await Promise.all([fs.writeFile(DAY_FILE, JSON.stringify(d), 'utf8'), fs.writeFile(MONTH_FILE, JSON.stringify(mo), 'utf8')]);
  });
  queue = run.catch(() => undefined);
  return run;
}

/** What the account has used this month, by kind. */
export async function usageThisMonth(ws: string): Promise<Record<LimitKind, number>> {
  const zero: Record<LimitKind, number> = { upload: 0, tailor: 0, chat: 0, import: 0 };
  if (storageMode() === 'firebase') {
    const snap = await db().collection('limits').doc(monthDocId(ws)).get();
    if (!snap.exists) return zero;
    return { upload: snap.get('upload') ?? 0, tailor: snap.get('tailor') ?? 0, chat: snap.get('chat') ?? 0, import: snap.get('import') ?? 0 };
  }
  return { ...zero, ...((await readMonth()).ws[ws] ?? {}) };
}
