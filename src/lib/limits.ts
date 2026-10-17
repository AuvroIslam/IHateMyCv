import fs from 'node:fs/promises';
import path from 'node:path';
import { headers } from 'next/headers';
import { AiOutputError } from './ai';
import { storageMode } from './backend';
import { db } from './firebase-admin';
import { DATA_DIR, workspaceId } from './workspace';

/**
 * Daily caps on the work that costs money, so no single visitor can spend
 * the month's AI budget for everyone. Counted per workspace and per IP
 * address (a fresh account or cleared cookie is not a new allowance).
 * Generous for real use; LIMIT_SCALE multiplies them all.
 */
const PER_WORKSPACE = { upload: 8, tailor: 40, chat: 150, import: 40 } as const;
/** Several people can share an address (an office, a campus). */
const PER_IP_FACTOR = 4;

export type LimitKind = keyof typeof PER_WORKSPACE;

const NAMES: Record<LimitKind, string> = {
  upload: 'CV uploads',
  tailor: 'tailored CVs',
  chat: 'chat messages',
  import: 'imports from notes',
};

interface Counts {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  ws: Record<string, Partial<Record<LimitKind, number>>>;
  ip: Record<string, Partial<Record<LimitKind, number>>>;
}

const FILE = path.join(DATA_DIR, 'limits.json');
const today = () => new Date().toISOString().slice(0, 10);

let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<Counts> {
  try {
    const data = JSON.parse(await fs.readFile(FILE, 'utf8')) as Counts;
    if (data.day === today()) return data;
  } catch {
    // Missing or unreadable: a fresh day.
  }
  return { day: today(), ws: {}, ip: {} };
}

/** The caller's address as the nearest proxy saw it. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'local';
}

const limitError = (kind: LimitKind) =>
  new AiOutputError(`You have reached today's limit for ${NAMES[kind]}. It resets at midnight UTC.`, 429);

/** Counts one use of `kind`, or throws a 429 when today's allowance is spent. */
export async function consume(kind: LimitKind): Promise<void> {
  const scale = Number(process.env.LIMIT_SCALE) || 1;
  const ws = await workspaceId();
  const ip = await clientIp();
  const mineMax = PER_WORKSPACE[kind] * scale;
  const theirsMax = PER_WORKSPACE[kind] * PER_IP_FACTOR * scale;

  if (storageMode() === 'firebase') {
    // One small document per user and per address per day, counted in a
    // transaction so concurrent requests cannot both take the last use.
    const day = today();
    const col = db().collection('limits');
    const mineRef = col.doc(`${day}_u_${ws}`);
    const theirsRef = col.doc(`${day}_ip_${ip.replace(/[^\w.:-]/g, '_')}`);
    await db().runTransaction(async (tx) => {
      const [m, t] = await Promise.all([tx.get(mineRef), tx.get(theirsRef)]);
      const mine = (m.get(kind) as number | undefined) ?? 0;
      const theirs = (t.get(kind) as number | undefined) ?? 0;
      if (mine >= mineMax || theirs >= theirsMax) throw limitError(kind);
      tx.set(mineRef, { [kind]: mine + 1, day }, { merge: true });
      tx.set(theirsRef, { [kind]: theirs + 1, day }, { merge: true });
    });
    return;
  }

  const run = queue.then(async () => {
    const data = await read();
    const mine = (data.ws[ws] ??= {});
    const theirs = (data.ip[ip] ??= {});
    if ((mine[kind] ?? 0) >= mineMax || (theirs[kind] ?? 0) >= theirsMax) throw limitError(kind);
    mine[kind] = (mine[kind] ?? 0) + 1;
    theirs[kind] = (theirs[kind] ?? 0) + 1;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(data), 'utf8');
  });
  queue = run.catch(() => undefined);
  return run;
}
