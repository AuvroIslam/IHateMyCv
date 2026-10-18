'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ErrorNote, Spinner, Textarea, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import type { ChatTurn, CvDocumentData } from '@/types/cv';

const STARTERS_FOR_JOB = [
  'Rewrite my summary for this job',
  'Lead with the projects that fit this job best',
  'Make every bullet one line',
  'What is this CV missing for the job?',
];
const STARTERS = [
  'Make my bullets more concise',
  'Fit everything on one page',
  'Make my summary stronger',
  'Which part of my CV is weakest?',
];

/**
 * Chat that edits the CV. Each reply streams in while its edits land on the
 * preview one by one; the latest reply's edits can be undone in one click.
 */
export default function CvChat({
  cvId,
  data,
  history,
  pages,
  hasJob,
  onLiveData,
  onTurnComplete,
}: {
  cvId: string;
  data: CvDocumentData;
  history: ChatTurn[];
  pages: { now?: number; original?: number };
  hasJob: boolean;
  /** Every edit as it lands, for the live preview. */
  onLiveData: (data: CvDocumentData) => void;
  /** A finished turn (or an undo): the CV and conversation to save. */
  onTurnComplete: (data: CvDocumentData, history: ChatTurn[]) => void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<{ text: string; changes: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The CV before the latest reply's edits, while that reply can be undone.
  const [undo, setUndo] = useState<{ index: number; before: CvDocumentData } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [history.length, streaming?.text, streaming?.changes.length]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    const before = data;
    const asked: ChatTurn[] = [...history, { role: 'user', text: message }];
    setInput('');
    setError(null);
    setBusy(true);
    setStreaming({ text: '', changes: [] });
    onTurnComplete(before, asked);

    const controller = new AbortController();
    abortRef.current = controller;
    let latest = before;
    let reply = '';
    let changes: string[] = [];
    let failure: string | null = null;
    try {
      await api.chatCv(
        cvId,
        { message, data: before, history, pages },
        (event) => {
          if (event.type === 'text') {
            reply += event.delta;
            setStreaming({ text: reply, changes });
          } else if (event.type === 'reset') {
            reply = '';
            setStreaming({ text: '', changes });
          } else if (event.type === 'edit') {
            latest = event.data;
            changes = [...changes, event.change];
            onLiveData(event.data);
            setStreaming({ text: reply, changes });
          } else if (event.type === 'done') {
            latest = event.data;
            reply = event.text || reply;
            changes = event.changes;
          } else if (event.type === 'error') {
            latest = event.data;
            changes = event.changes;
            failure = event.message;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) failure = err instanceof Error ? err.message : 'The chat failed.';
    }

    const answer: ChatTurn = {
      role: 'assistant',
      text: reply.trim() || (controller.signal.aborted ? 'Stopped.' : failure ? 'Something went wrong.' : 'Done.'),
      ...(changes.length ? { changes } : {}),
    };
    const next = [...asked, answer];
    setUndo(changes.length ? { index: next.length - 1, before } : null);
    setStreaming(null);
    setBusy(false);
    abortRef.current = null;
    if (failure) setError(failure);
    onTurnComplete(latest, next);
  };

  const revert = () => {
    if (!undo) return;
    const next = history.map((t, i) => (i === undo.index ? { ...t, text: `${t.text}\n\n(Undone.)`, changes: undefined } : t));
    onTurnComplete(undo.before, next);
    setUndo(null);
  };

  const starters = hasJob ? STARTERS_FOR_JOB : STARTERS;

  return (
    <div className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {history.length === 0 && !streaming && (
          <div className="pt-2 text-sm">
            <p className="text-subtle">
              Ask for changes in plain words and watch them appear on the CV. Your design stays as it is, and
              nothing is made up: rewrites keep your facts, and anything new comes from you.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {starters.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded-full border border-line px-3 py-1.5 text-xs text-subtle transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-lg bg-foreground px-3 py-2 text-sm whitespace-pre-wrap text-background">
                {turn.text}
              </p>
            </div>
          ) : (
            <AssistantTurn key={i} text={turn.text} changes={turn.changes}>
              {undo?.index === i && !busy && (
                <Button size="sm" onClick={revert} className="mt-2">
                  Undo these changes
                </Button>
              )}
            </AssistantTurn>
          ),
        )}

        {streaming && (
          <AssistantTurn text={streaming.text} changes={streaming.changes} live>
            {!streaming.text && (
              <p className="flex items-center gap-2 text-xs text-subtle">
                <Spinner /> {streaming.changes.length ? 'Editing your CV…' : 'Thinking…'}
              </p>
            )}
          </AssistantTurn>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="mt-2">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={2}
          placeholder={example(data)}
          className="min-h-[3.25rem] flex-1 resize-none text-sm"
          disabled={busy}
        />
        {busy ? (
          <Button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!input.trim()}>
            Send
          </Button>
        )}
      </form>
    </div>
  );
}

function AssistantTurn({
  text,
  changes,
  live,
  children,
}: {
  text: string;
  changes?: string[];
  live?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="max-w-[92%] rounded-lg border border-line px-3 py-2 text-sm">
      {changes && changes.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-xs">
          {changes.map((c, i) => (
            <li key={i} className={cx('flex gap-1.5', live && i === changes.length - 1 && 'font-medium')}>
              <span className="text-emerald-600">✓</span>
              <span>{c}</span>
            </li>
          ))}
        </ul>
      )}
      {text && <p className="whitespace-pre-wrap">{text}</p>}
      {children}
    </div>
  );
}

/** An example request about this CV's own content. */
function example(data: CvDocumentData): string {
  const entry = data.sections
    .flatMap((s) => (s.hidden ? [] : s.entries))
    .filter((e) => e.bullets.length > 1 && e.title.trim())
    .sort((x, y) => y.bullets.length - x.bullets.length)[0];
  return entry ? `e.g. Shorten the ${entry.title.trim()} bullets` : 'e.g. Make my summary shorter';
}
