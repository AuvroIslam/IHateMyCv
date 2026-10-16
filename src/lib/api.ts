import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AiOutputError, MissingApiKeyError } from './ai';

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Turns SDK and validation failures into something a user can act on. */
export function handleRouteError(err: unknown) {
  if (err instanceof MissingApiKeyError) return jsonError(err.message, 428);
  if (err instanceof AiOutputError) return jsonError(err.message, err.status);

  // Anthropic (the main provider) and OpenAI (the fallback) raise the same
  // kinds of failure under their own classes.
  for (const [Sdk, name, keyVar] of [
    [Anthropic, 'Anthropic', 'ANTHROPIC_API_KEY'],
    [OpenAI, 'OpenAI', 'OPENAI_API_KEY'],
  ] as const) {
    if (err instanceof Sdk.RateLimitError) {
      return jsonError(`${name} is busy or the account's rate limit was hit. Wait a moment and try again.`, 429);
    }
    if (err instanceof Sdk.AuthenticationError) {
      return jsonError(`${name} rejected the API key. Check ${keyVar} in .env.local.`, 401);
    }
    if (err instanceof Sdk.NotFoundError) {
      return jsonError(`${name} does not recognise that model for this key. (${err.message})`, 502);
    }
    if (err instanceof Sdk.APIConnectionError) {
      return jsonError(`Could not reach the ${name} API. Check your network connection.`, 503);
    }
    if (err instanceof Sdk.APIError) {
      return jsonError(`${name} API error (${err.status ?? 'unknown'}): ${err.message}`, 502);
    }
  }

  console.error(err);
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return jsonError(message, 500);
}
