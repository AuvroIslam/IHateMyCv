import OpenAI from 'openai';
import { AiOutputError, MissingApiKeyError } from './ai';

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** Turns SDK and validation failures into something a user can act on. */
export function handleRouteError(err: unknown) {
  if (err instanceof MissingApiKeyError) return jsonError(err.message, 428);
  if (err instanceof AiOutputError) return jsonError(err.message, err.status);

  if (err instanceof OpenAI.RateLimitError) {
    return jsonError('OpenAI rate limit or quota hit. Wait a moment, or check your billing.', 429);
  }
  if (err instanceof OpenAI.AuthenticationError) {
    return jsonError('OpenAI rejected the API key. Check OPENAI_API_KEY in .env.local.', 401);
  }
  if (err instanceof OpenAI.NotFoundError) {
    return jsonError(
      `OpenAI does not recognise that model for your key. Set OPENAI_MODEL in .env.local. (${err.message})`,
      502,
    );
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return jsonError('Could not reach the OpenAI API. Check your network connection.', 503);
  }
  if (err instanceof OpenAI.APIError) {
    return jsonError(`OpenAI API error (${err.status ?? 'unknown'}): ${err.message}`, 502);
  }

  console.error(err);
  const message = err instanceof Error ? err.message : 'Something went wrong.';
  return jsonError(message, 500);
}
