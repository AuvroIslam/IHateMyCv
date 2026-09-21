import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { z } from 'zod';

/**
 * Two tiers so each job gets the cheapest model that does it well. Defaults
 * sit inside OpenAI's free daily allowance for data-sharing organisations;
 * override either in .env.local.
 *
 * - main: reads the CV's design from page images and judges job fit.
 * - fast: restructures a few lines of notes.
 */
export const MODELS = {
  main: process.env.OPENAI_MODEL?.trim() || 'gpt-5.4',
  fast: process.env.OPENAI_FAST_MODEL?.trim() || 'gpt-5.4-mini',
} as const;

// Non-reasoning models (gpt-4.1, gpt-4o) reject the reasoning parameter.
const supportsReasoning = (model: string) => /^(gpt-5|o\d)/.test(model);

export class MissingApiKeyError extends Error {
  constructor() {
    super('No OpenAI API key found. Add OPENAI_API_KEY to .env.local and restart the dev server.');
    this.name = 'MissingApiKeyError';
  }
}

/** The model declined, or stopped before finishing. Carries an HTTP status for the route. */
export class AiOutputError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiOutputError';
  }
}

export function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new MissingApiKeyError();
  return new OpenAI({ apiKey });
}

export function hasApiKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
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
  name: string;
  tier?: keyof typeof MODELS;
  effort?: 'low' | 'medium' | 'high';
}): Promise<z.infer<S>> {
  const model = MODELS[tier];
  const response = await getClient().responses.parse({
    model,
    ...(supportsReasoning(model) ? { reasoning: { effort } } : {}),
    instructions: system,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: user },
          ...images.map((img) => ({
            type: 'input_image' as const,
            // Rules and small type are what the design pass is judging.
            detail: 'high' as const,
            image_url: `data:${img.mediaType};base64,${img.data}`,
          })),
        ],
      },
    ],
    text: { format: zodTextFormat(schema, name) },
  });

  const refused = response.output.some(
    (item) => item.type === 'message' && item.content.some((c) => c.type === 'refusal'),
  );
  if (refused) throw new AiOutputError('The model declined to process this request.', 422);

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason;
    throw new AiOutputError(
      reason === 'max_output_tokens'
        ? 'The model ran out of room before finishing. Try again, or shorten the input.'
        : 'The model stopped before finishing. Try again.',
      502,
    );
  }

  if (response.output_parsed == null) {
    throw new AiOutputError('The model returned an unreadable result. Try again.', 502);
  }
  return response.output_parsed as z.infer<S>;
}
