import fs from 'node:fs/promises';
import path from 'node:path';
import { cookies, headers } from 'next/headers';
import { AiOutputError } from './ai';
import { DATA_DIR } from './workspace';
import { WORKSPACE_COOKIE } from './workspace-id';

/**
 * Daily caps on the work that costs money, so no single visitor can spend
 * the month's AI budget for everyone. Counted per workspace and per IP
 * address (a cleared cookie is a new workspace, not a new allowance).
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

/** Counts one use of `kind`, or throws a 429 when today's allowance is spent. */
export async function consume(kind: LimitKind): Promise<void> {
  const scale = Number(process.env.LIMIT_SCALE) || 1;
  const ws = (await cookies()).get(WORKSPACE_COOKIE)?.value ?? 'none';
  const ip = await clientIp();
  const run = queue.then(async () => {
    const data = await read();
    const mine = (data.ws[ws] ??= {});
    const theirs = (data.ip[ip] ??= {});
    if ((mine[kind] ?? 0) >= PER_WORKSPACE[kind] * scale || (theirs[kind] ?? 0) >= PER_WORKSPACE[kind] * PER_IP_FACTOR * scale) {
      throw new AiOutputError(`You have reached today's limit for ${NAMES[kind]}. It resets at midnight UTC.`, 429);
    }
    mine[kind] = (mine[kind] ?? 0) + 1;
    theirs[kind] = (theirs[kind] ?? 0) + 1;
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(data), 'utf8');
  });
  queue = run.catch(() => undefined);
  return run;
}
