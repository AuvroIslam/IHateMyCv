import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './store';

/**
 * Tokens used per API key per day, so work can move to a backup key before
 * the first one's free daily allowance runs out. OpenAI does not fail when
 * that allowance is spent - it starts billing - so counting is the only way
 * to stay inside it.
 *
 * The allowance resets at 00:00 UTC; so does this count.
 */

export type Tier = 'large' | 'small';

/** OpenAI's free daily tokens for organisations that share traffic. */
export const DAILY_FREE: Record<Tier, number> = { large: 250_000, small: 2_500_000 };

/** Headroom kept back: one big call (a long CV, high reasoning) can use this much. */
const RESERVE: Record<Tier, number> = { large: 35_000, small: 100_000 };

const FILE = path.join(DATA_DIR, 'usage.json');

interface UsageFile {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  /** Key fingerprint -> tier -> tokens used today. */
  keys: Record<string, Partial<Record<Tier, number>>>;
  /** Keys OpenAI reported as out of quota today. */
  exhausted: string[];
}

const today = () => new Date().toISOString().slice(0, 10);

/** Never the key itself: the last 6 characters are enough to tell keys apart. */
export const fingerprint = (key: string) => `…${key.slice(-6)}`;

let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function read(): Promise<UsageFile> {
  try {
    const data = JSON.parse(await fs.readFile(FILE, 'utf8')) as UsageFile;
    if (data.day === today()) return data;
  } catch {
    // Missing or unreadable: start the day fresh.
  }
  return { day: today(), keys: {}, exhausted: [] };
}

async function write(data: UsageFile) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 1), 'utf8');
}

export function recordUsage(key: string, tier: Tier, tokens: number): Promise<void> {
  return serial(async () => {
    const data = await read();
    const fp = fingerprint(key);
    const entry = (data.keys[fp] ??= {});
    entry[tier] = (entry[tier] ?? 0) + tokens;
    await write(data);
  });
}

export function markExhausted(key: string): Promise<void> {
  return serial(async () => {
    const data = await read();
    const fp = fingerprint(key);
    if (!data.exhausted.includes(fp)) data.exhausted.push(fp);
    await write(data);
  });
}

/**
 * Keys in the order to try them: those with free allowance left first (in
 * their configured order), then the rest, so work still gets done - billed -
 * when every allowance is spent.
 */
export async function orderKeys(keys: string[], tier: Tier): Promise<string[]> {
  const data = await read();
  const usedOf = (k: string) => data.keys[fingerprint(k)]?.[tier] ?? 0;
  const free = (k: string) =>
    !data.exhausted.includes(fingerprint(k)) && usedOf(k) + RESERVE[tier] < DAILY_FREE[tier];
  return [...keys.filter(free), ...keys.filter((k) => !free(k))];
}

/** Today's usage per key, for display. */
export async function usageToday(keys: string[]) {
  const data = await read();
  return keys.map((k) => ({
    key: fingerprint(k),
    large: data.keys[fingerprint(k)]?.large ?? 0,
    small: data.keys[fingerprint(k)]?.small ?? 0,
    exhausted: data.exhausted.includes(fingerprint(k)),
  }));
}

// ---------------------------------------------------------------------------
// Spend (Anthropic). Billed per token, against a monthly budget, so every
// call is priced and added to the month's total.

/** USD per million tokens: input, 5-minute cache write, cache read, output. */
const PRICES: { match: RegExp; in: number; write: number; read: number; out: number; longIn?: number; longOut?: number }[] = [
  { match: /opus-5-5/, in: 4, write: 5, read: 0.2, out: 20 },
  { match: /opus-5/, in: 5, write: 6.25, read: 0.5, out: 25 },
  { match: /sonnet-5-5/, in: 2, write: 2.5, read: 0.1, out: 10 },
  { match: /sonnet-5/, in: 2, write: 2.5, read: 0.2, out: 10 },
  // Haiku 5.5 charges more once a prompt passes 100K tokens.
  { match: /haiku-5-5/, in: 0.1, write: 0.125, read: 0.01, out: 0.5, longIn: 0.5, longOut: 2.5 },
  { match: /fable|mythos/, in: 10, write: 12.5, read: 0.25, out: 50 },
];

export interface CallUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function priceOf(model: string, u: CallUsage): number {
  const p = PRICES.find((x) => x.match.test(model));
  if (!p) return 0;
  const long = p.longIn != null && u.input + u.cacheRead + u.cacheWrite > 100_000;
  const scale = long ? p.longIn! / p.in : 1;
  const out = long ? p.longOut! : p.out;
  return ((u.input * p.in + u.cacheWrite * p.write + u.cacheRead * p.read) * scale + u.output * out) / 1_000_000;
}

interface Tally extends CallUsage {
  calls: number;
  usd: number;
  ms: number;
}

export interface SpendFile {
  /** UTC month, YYYY-MM. */
  month: string;
  usd: number;
  byModel: Record<string, Tally>;
  byTask: Record<string, Tally>;
}

const SPEND_FILE = path.join(DATA_DIR, 'spend.json');
const thisMonth = () => new Date().toISOString().slice(0, 7);

export async function monthSpend(): Promise<SpendFile> {
  try {
    const data = JSON.parse(await fs.readFile(SPEND_FILE, 'utf8')) as SpendFile;
    if (data.month === thisMonth()) return data;
  } catch {
    // Missing or unreadable: a fresh month.
  }
  return { month: thisMonth(), usd: 0, byModel: {}, byTask: {} };
}

export function recordSpend(model: string, task: string, u: CallUsage, ms: number): Promise<number> {
  return serial(async () => {
    const data = await monthSpend();
    const usd = priceOf(model, u);
    const add = (t: Tally | undefined): Tally => ({
      calls: (t?.calls ?? 0) + 1,
      input: (t?.input ?? 0) + u.input,
      output: (t?.output ?? 0) + u.output,
      cacheRead: (t?.cacheRead ?? 0) + u.cacheRead,
      cacheWrite: (t?.cacheWrite ?? 0) + u.cacheWrite,
      usd: (t?.usd ?? 0) + usd,
      ms: (t?.ms ?? 0) + ms,
    });
    data.usd += usd;
    data.byModel[model] = add(data.byModel[model]);
    data.byTask[task] = add(data.byTask[task]);
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SPEND_FILE, JSON.stringify(data, null, 1), 'utf8');
    return usd;
  });
}
