import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { toJSONSchema, type z } from 'zod';
import { freeKeys, markExhausted, monthSpend, orderKeys, recordSpend, recordUsage, type Tier, usableKeys } from './usage';

/** Every job the app sends to a model. */
export type Task = 'cv_design' | 'cv_content' | 'cv_tags' | 'library_import' | 'profile_import' | 'tailoring_plan' | 'cv_chat';

/**
 * Claude model per job, each the cheapest that does it well. Override any
 * with AI_MODEL_<TASK> in .env.local (AI_MODEL_TAILORING_PLAN=claude-opus-5-5).
 *
 * - cv_design: reads layout and typography off page images.
 * - cv_content, profile_import: copy every entry and bullet verbatim.
 * - tailoring_plan: judges which experience fits a job - the result users see.
 * - cv_tags, library_import: short, mechanical restructuring.
 */
const CLAUDE_MODELS: Record<Task, string> = {
  cv_design: 'claude-sonnet-5-5',
  cv_content: 'claude-sonnet-5-5',
  profile_import: 'claude-sonnet-5-5',
  tailoring_plan: 'claude-sonnet-5-5',
  cv_chat: 'claude-sonnet-5-5',
  cv_tags: 'claude-haiku-5-5',
  library_import: 'claude-haiku-5-5',
};

/**
 * Tasks run on OpenAI's free daily allowance whenever OpenAI keys are set,
 * even with an Anthropic key: reading CVs into My Info is frequent, and the
 * allowance makes it free. See callOpenAiFree.
 */
const OPENAI_FREE_TASKS = new Set<Task>(['profile_import']);

/** The OpenAI models: the fallback without an Anthropic key, and OPENAI_FREE_TASKS. */
const OPENAI_MODELS = {
  main: process.env.OPENAI_MODEL?.trim() || 'gpt-5.4',
  fast: process.env.OPENAI_FAST_MODEL?.trim() || 'gpt-5.4-mini',
} as const;

/** Spending stops here each calendar month (UTC); set AI_MONTHLY_BUDGET_USD to change it. */
const MONTHLY_BUDGET_USD = Number(process.env.AI_MONTHLY_BUDGET_USD) || 500;

export class MissingApiKeyError extends Error {
  constructor() {
    super('No AI API key found. Add ANTHROPIC_API_KEY to .env.local and restart the dev server.');
    this.name = 'MissingApiKeyError';
  }
}

/** The model declined, stopped early, or the budget is spent. Carries an HTTP status for the route. */
export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiOutputError';
  }
}

const anthropicKey = () => {
  const k = process.env.ANTHROPIC_API_KEY?.trim();
  return k && /^sk-ant-[\w-]{20,}$/.test(k) ? k : null;
};

const looksLikeOpenAiKey = (k: string | undefined): k is string => Boolean(k && /^sk-(?!ant-)[\w-]{20,}$/.test(k.trim()));

/** OpenAI keys, primary first; a backup takes over once the primary's free allowance is spent. */
function openAiKeys(): string[] {
  return [process.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY_BACKUP].map((k) => k?.trim()).filter(looksLikeOpenAiKey);
}

export function provider(): 'anthropic' | 'openai' | null {
  if (anthropicKey()) return 'anthropic';
  return openAiKeys().length ? 'openai' : null;
}

export function hasApiKey(): boolean {
  return provider() !== null;
}

/** The model a job runs on with the current keys and settings. */
export function modelFor(task: Task, tier: 'main' | 'fast' = 'main'): string {
  if (provider() === 'openai') return OPENAI_MODELS[tier];
  return process.env[`AI_MODEL_${task.toUpperCase()}`]?.trim() || CLAUDE_MODELS[task];
}

// ---------------------------------------------------------------------------
// Test cache. Only when AI_CACHE_DIR is set (never in normal use): identical
// requests return the stored response, so a test suite that exercises the
// deterministic parts can re-run without spending tokens.

const CACHE_DIR = process.env.AI_CACHE_DIR ? path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.AI_CACHE_DIR) : null;

async function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  if (!CACHE_DIR) return make();
  const file = path.join(CACHE_DIR, `${key}.json`);
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    const value = await make();
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(value), 'utf8');
    return value;
  }
}

type Effort = 'low' | 'medium' | 'high';

interface Request<S extends z.ZodType> {
  system: string;
  user: string;
  images: { mediaType: string; data: string }[];
  schema: S;
  name: Task;
  effort: Effort;
}

/**
 * One structured-output call: instructions, a user message (optionally with
 * page images), and a Zod schema the reply must satisfy. Returns the parsed,
 * validated object or throws something a route can hand straight to the user.
 */
export async function generateStructured<S extends z.ZodType>({
  system,
  user,
  images = [],
  schema,
  name,
  tier = 'main',
  effort = 'medium',
}: {
  system: string;
  user: string;
  images?: { mediaType: string; data: string }[];
  schema: S;
  name: Task;
  tier?: 'main' | 'fast';
  effort?: Effort;
}): Promise<z.infer<S>> {
  const free = OPENAI_FREE_TASKS.has(name) && openAiKeys().length > 0;
  const which = free ? 'openai' : provider();
  if (!which) throw new MissingApiKeyError();
  const model = free ? `${OPENAI_MODELS.main}>${OPENAI_MODELS.fast}` : modelFor(name, tier);
  const cacheKey = createHash('sha256')
    .update(JSON.stringify([which, model, effort, name, system, user, images.map((i) => i.data.length + i.data.slice(-64)), toJSONSchema(schema)]))
    .digest('hex')
    .slice(0, 32);
  const req = { system, user, images, schema, name, effort };
  return cached(cacheKey, () =>
    free ? callOpenAiFree(req) : which === 'anthropic' ? callClaude(model, req) : callOpenAi(model, req),
  );
}

// ---------------------------------------------------------------------------
// Anthropic

export function claudeClient(): Anthropic {
  const apiKey = anthropicKey();
  if (!apiKey) throw new MissingApiKeyError();
  return new Anthropic({ apiKey, maxRetries: 3 });
}

/** Refuses new work once the month's spend reaches the budget. */
export async function assertBudget(): Promise<void> {
  const spent = await monthSpend();
  if (spent.usd >= MONTHLY_BUDGET_USD) {
    throw new AiOutputError(`This month's AI budget ($${MONTHLY_BUDGET_USD}) is used up. It resets on the 1st.`, 429);
  }
}

/** Prices one Claude response and adds it to the month. */
export function recordClaudeUsage(model: string, task: Task, u: Anthropic.Usage, ms: number): Promise<number> {
  return recordSpend(
    model,
    task,
    {
      input: u.input_tokens,
      output: u.output_tokens,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    },
    ms,
  );
}

async function callClaude<S extends z.ZodType>(model: string, req: Request<S>): Promise<z.infer<S>> {
  await assertBudget();
  const client = claudeClient();
  const started = Date.now();
  // Streamed so a long extraction is never cut off by a request timeout.
  const stream = client.messages.stream({
    model,
    max_tokens: 32_000,
    // The instructions are identical on every call of a job: cached, they
    // cost a twentieth on each later call within five minutes.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          ...req.images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType as 'image/png' | 'image/jpeg', data: img.data },
          })),
          { type: 'text' as const, text: req.user },
        ],
      },
    ],
    ...(/haiku/.test(model) ? {} : { thinking: { type: 'adaptive' as const } }),
    output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
  });
  const message = await stream.finalMessage();

  await recordClaudeUsage(model, req.name, message.usage, Date.now() - started);

  if (message.stop_reason === 'refusal') throw new AiOutputError('The model declined to process this request.', 422);
  if (message.stop_reason === 'max_tokens') {
    throw new AiOutputError('The model ran out of room before finishing. Try again, or shorten the input.', 502);
  }
  const parsed = (message as { parsed_output?: unknown }).parsed_output;
  if (parsed == null) throw new AiOutputError('The model returned an unreadable result. Try again.', 502);
  return parsed as z.infer<S>;
}

// ---------------------------------------------------------------------------
// OpenAI fallback

// Non-reasoning models (gpt-4.1, gpt-4o) reject the reasoning parameter.
const supportsReasoning = (model: string) => /^(gpt-5|o\d)/.test(model);

/** Which free allowance a model draws on: mini/nano models have their own, larger one. */
const tierOf = (model: string): Tier => (/mini|nano/.test(model) ? 'small' : 'large');

/** OpenAI's "this key has no quota left" - distinct from an ordinary rate limit. */
function isOutOfQuota(err: unknown): boolean {
  return err instanceof OpenAI.APIError && (err.code === 'insufficient_quota' || /quota/i.test(err.message));
}

/** One request on one key. Returns the result and the tokens it took. */
async function openAiOnce<S extends z.ZodType>(apiKey: string, model: string, req: Request<S>) {
  const response = await new OpenAI({ apiKey }).responses.parse({
    model,
    ...(supportsReasoning(model) ? { reasoning: { effort: req.effort } } : {}),
    instructions: req.system,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: req.user },
          ...req.images.map((img) => ({
            type: 'input_image' as const,
            detail: 'high' as const,
            image_url: `data:${img.mediaType};base64,${img.data}`,
          })),
        ],
      },
    ],
    text: { format: zodTextFormat(req.schema, req.name) },
  });
  const usage = response.usage;
  const tokens = usage?.total_tokens ?? 0;

  const refused = response.output.some(
    (item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'),
  );
  if (refused) throw new AiOutputError('The model declined to process this request.', 422);
  if (response.status === 'incomplete') {
    throw new AiOutputError('The model stopped before finishing. Try again.', 502);
  }
  if (response.output_parsed == null) {
    throw new AiOutputError('The model returned an unreadable result. Try again.', 502);
  }
  return {
    parsed: response.output_parsed as z.infer<S>,
    tokens,
    usage: {
      input: (usage?.input_tokens ?? 0) - (usage?.input_tokens_details?.cached_tokens ?? 0),
      cacheRead: usage?.input_tokens_details?.cached_tokens ?? 0,
      cacheWrite: 0,
      output: usage?.output_tokens ?? 0,
    },
  };
}

/** The fallback without an Anthropic key: free allowance first, then billed. */
async function callOpenAi<S extends z.ZodType>(model: string, req: Request<S>): Promise<z.infer<S>> {
  const tier = tierOf(model);
  let lastError: unknown;
  for (const apiKey of await orderKeys(openAiKeys(), tier)) {
    try {
      const r = await openAiOnce(apiKey, model, req);
      await recordUsage(apiKey, tier, r.tokens);
      return r.parsed;
    } catch (err) {
      // Out of quota on this key: note it for the day and try the next one.
      if (!isOutOfQuota(err)) throw err;
      await markExhausted(apiKey);
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Best quality for free, then the cheapest billed: the main model while any
 * key has large-model allowance left, then the mini model on its (ten times
 * larger) allowance, and only when every allowance is spent, the mini model
 * billed - priced into the month like any other paid call.
 */
async function callOpenAiFree<S extends z.ZodType>(req: Request<S>): Promise<z.infer<S>> {
  const keys = openAiKeys();
  let lastError: unknown;
  const attempt = async (apiKey: string, model: string, billed: boolean) => {
    const started = Date.now();
    const r = await openAiOnce(apiKey, model, req);
    await recordUsage(apiKey, tierOf(model), r.tokens);
    if (billed) await recordSpend(model, req.name, r.usage, Date.now() - started);
    return r.parsed;
  };
  for (const model of [OPENAI_MODELS.main, OPENAI_MODELS.fast]) {
    for (const apiKey of await freeKeys(keys, tierOf(model))) {
      try {
        return await attempt(apiKey, model, false);
      } catch (err) {
        if (!isOutOfQuota(err)) throw err;
        await markExhausted(apiKey);
        lastError = err;
      }
    }
  }
  await assertBudget();
  for (const apiKey of await usableKeys(keys)) {
    try {
      return await attempt(apiKey, OPENAI_MODELS.fast, true);
    } catch (err) {
      if (!isOutOfQuota(err)) throw err;
      await markExhausted(apiKey);
      lastError = err;
    }
  }
  throw lastError ?? new AiOutputError('Every OpenAI key is out of quota today. Try again tomorrow.', 429);
}
