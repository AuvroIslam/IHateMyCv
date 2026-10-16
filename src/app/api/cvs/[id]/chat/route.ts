import type Anthropic from '@anthropic-ai/sdk';
import { assertBudget, claudeClient, modelFor, provider, recordClaudeUsage } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { CHAT_SYSTEM, applyEdit, toolDefinitions, turnPrompt, viewDoc, type ChatTurn } from '@/lib/cv-chat';
import { readStore } from '@/lib/store';
import type { CvDocumentData } from '@/types/cv';
import { consume } from '@/lib/limits';

export const maxDuration = 300;

/** Rounds of edits per message: edits, results back, a fix or the reply. */
const MAX_ROUNDS = 4;
/** Earlier messages sent along for context. */
const HISTORY = 12;

/**
 * One chat message. Streams server-sent events while the model works:
 *   text  - a piece of the reply
 *   reset - discard the reply so far (it was said before more edits)
 *   edit  - an edit applied: the whole updated CV, and a line describing it
 *   done  - finished: the final CV and every change made
 *   error - something failed; edits already sent stand
 */
export async function POST(request: Request, context: RouteContext<'/api/cvs/[id]/chat'>) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      message?: string;
      data?: CvDocumentData;
      history?: ChatTurn[];
      pages?: { now?: number; original?: number };
    };
    const message = body.message?.trim();
    if (!message) return jsonError('Type a message first.');
    if (message.length > 4000) return jsonError('That message is too long. Keep it under 4,000 characters.');
    if (provider() !== 'anthropic') return jsonError('Chat editing needs ANTHROPIC_API_KEY in .env.local.', 428);

    const store = await readStore();
    const cv = store.cvs.find((c) => c.id === id);
    if (!cv) return jsonError('CV not found.', 404);
    if (!store.design) return jsonError('Upload a CV first.', 409);
    await assertBudget();
    await consume('chat');

    const design = store.design;
    const library = store.library;
    const working: CvDocumentData = structuredClone(body.data ?? cv.data);
    const model = modelFor('cv_chat');
    const client = claudeClient();

    const history: Anthropic.MessageParam[] = (body.history ?? []).slice(-HISTORY).map((t) => ({
      role: t.role,
      content:
        t.role === 'assistant' && t.changes?.length
          ? `${t.text}\n\n(Edits made: ${t.changes.join('; ')})`
          : t.text || '(no reply)',
    }));
    // The API needs turns to alternate and to open with the user.
    while (history.length && history[0].role !== 'user') history.shift();

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: Record<string, unknown>) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        const changes: string[] = [];
        let reply = '';
        try {
          let view = viewDoc(working, design, library);
          const messages: Anthropic.MessageParam[] = [
            ...history,
            { role: 'user', content: turnPrompt(view, message, body.pages ?? {}, cv.jobDescription) },
          ];

          for (let round = 0; round < MAX_ROUNDS; round++) {
            const results: Anthropic.ToolResultBlockParam[] = [];
            const started = Date.now();
            const refs = view.refs;
            const response = client.messages.stream(
              {
                model,
                max_tokens: 16_000,
                system: [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
                tools: toolDefinitions(),
                messages,
                thinking: { type: 'adaptive' },
                output_config: { effort: 'low' },
              },
              { signal: request.signal },
            );
            response.on('text', (delta) => {
              reply += delta;
              send({ type: 'text', delta });
            });
            // Each edit lands as soon as its tool call is complete, so the
            // preview changes while the model is still working.
            response.on('contentBlock', (block) => {
              if (block.type !== 'tool_use') return;
              const r = applyEdit(working, design, library, refs, block.name, block.input);
              results.push({ type: 'tool_result', tool_use_id: block.id, content: r.message, is_error: !r.ok });
              if (r.ok && r.change) {
                changes.push(r.change);
                send({ type: 'edit', data: working, change: r.change });
              }
            });
            const final = await response.finalMessage();
            await recordClaudeUsage(model, 'cv_chat', final.usage, Date.now() - started);

            if (final.stop_reason !== 'tool_use' || !results.length) break;
            // Results go back so the model can fix a bad reference or write
            // its reply. A fresh view gives it references for the new state.
            view = viewDoc(working, design, library);
            messages.push({ role: 'assistant', content: final.content });
            messages.push({
              role: 'user',
              content: [
                ...results,
                { type: 'text', text: `The CV now reads:\n<cv>\n${view.text}\n</cv>\nUse these new references for any further edits.` },
              ],
            });
            // Only the last round's text is the reply; anything said before
            // the edits was narration.
            reply = '';
            send({ type: 'reset' });
          }
          send({ type: 'done', data: working, text: reply.trim(), changes });
        } catch (err) {
          const aborted = request.signal.aborted;
          if (!aborted) {
            const message = err instanceof Error ? err.message : 'The chat failed.';
            send({ type: 'error', message, data: working, changes });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
