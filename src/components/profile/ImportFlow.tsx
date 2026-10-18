'use client';

import { useRef, useState } from 'react';
import { Button, ErrorNote, Spinner, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import { parseUpload } from '@/lib/parse-client';
import { PROFILE_KINDS } from '@/lib/profile';
import {
  DETAIL_LABEL,
  type EntryChoice,
  type ImportChoices,
  type ImportPlan,
  applyImport,
  defaultChoices,
  planImport,
  planIsEmpty,
} from '@/lib/profile-import';
import type { LibraryEntry, Profile } from '@/types/cv';

type Stage =
  | { step: 'closed' }
  | { step: 'pick' }
  | { step: 'reading'; done: number; total: number; name: string }
  | { step: 'review'; plan: ImportPlan; choices: ImportChoices; sources: string[] }
  | { step: 'nothing'; sources: string[] };

/**
 * "Import from CVs": reads one or more CVs - the one already uploaded, or new
 * files - and shows what they would add to My Info. New things are ticked;
 * where a CV says something different, the owner picks which to keep. Nothing
 * changes until they apply.
 */
export default function ImportFlow({
  current,
  original,
  onApply,
}: {
  current: Profile;
  /** The uploaded CV, already in Profile form, when there is one. */
  original: Profile | null;
  onApply: (next: Profile) => Promise<void>;
}) {
  const [stage, setStage] = useState<Stage>({ step: 'closed' });
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const review = (incoming: { profile: Profile; from: string }[]) => {
    const plan = planImport(current, incoming);
    const sources = incoming.map((s) => s.from);
    setStage(planIsEmpty(plan) ? { step: 'nothing', sources } : { step: 'review', plan, choices: defaultChoices(plan), sources });
  };

  const readFiles = async (files: File[]) => {
    setError(null);
    const read: { profile: Profile; from: string }[] = [];
    const failed: string[] = [];
    for (const [i, file] of files.entries()) {
      setStage({ step: 'reading', done: i, total: files.length, name: file.name });
      try {
        const parsed = await parseUpload(file, { textOnly: true });
        const { profile } = await api.readCvIntoProfile({ textDump: parsed.textDump, fileName: file.name });
        read.push({ profile, from: file.name });
      } catch (err) {
        failed.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be read'}`);
      }
    }
    if (failed.length) setError(failed.join('\n'));
    if (!read.length) {
      setStage({ step: 'pick' });
      return;
    }
    review(read);
  };

  const close = () => {
    setStage({ step: 'closed' });
    setError(null);
  };

  if (stage.step === 'closed') {
    return (
      <Button onClick={() => setStage({ step: 'pick' })}>Import from CVs</Button>
    );
  }

  return (
    <>
      <Button disabled>Import from CVs</Button>
      <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8" role="dialog" aria-modal>
        <div className="w-full max-w-3xl rounded-xl border border-line bg-background p-5 shadow-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Import from CVs</h2>
              <p className="mt-1 text-sm text-subtle">
                {stage.step === 'review'
                  ? `From ${stage.sources.join(', ')}. New things are ticked; where a CV says something different, choose which to keep.`
                  : 'Add what your CVs say to My Info. You will see every change and choose before anything is saved.'}
              </p>
            </div>
            <button onClick={close} className="text-xl leading-none text-subtle hover:text-foreground" aria-label="Close">
              ×
            </button>
          </div>

          {error && (
            <div className="mt-4 whitespace-pre-line">
              <ErrorNote>{error}</ErrorNote>
            </div>
          )}

          {stage.step === 'pick' && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {original && (
                <button
                  onClick={() => review([{ profile: original, from: 'your uploaded CV' }])}
                  className="rounded-lg border border-line p-4 text-left hover:border-foreground/40"
                >
                  <p className="font-medium">Your uploaded CV</p>
                  <p className="mt-1 text-sm text-subtle">The CV whose design you use. Instant.</p>
                </button>
              )}
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-line p-4 text-left hover:border-foreground/40"
              >
                <p className="font-medium">Other CV files</p>
                <p className="mt-1 text-sm text-subtle">
                  PDF, DOCX or text. Pick several at once: older CVs, other versions. About 20 seconds each.
                </p>
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdf,.docx,.txt,.md"
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = '';
                  if (files.length) void readFiles(files);
                }}
              />
            </div>
          )}

          {stage.step === 'reading' && (
            <p className="mt-6 flex items-center gap-2 text-sm text-subtle">
              <Spinner /> Reading {stage.name}
              {stage.total > 1 ? ` (${stage.done + 1} of ${stage.total})` : ''}…
            </p>
          )}

          {stage.step === 'nothing' && (
            <div className="mt-5 text-sm">
              <p>
                Nothing new: My Info already has everything in {stage.sources.join(', ')}.
              </p>
              <div className="mt-4 flex gap-2">
                <Button onClick={() => setStage({ step: 'pick' })}>Import another</Button>
                <Button variant="primary" onClick={close}>
                  Done
                </Button>
              </div>
            </div>
          )}

          {stage.step === 'review' && (
            <Review
              plan={stage.plan}
              choices={stage.choices}
              onChange={(choices) => setStage({ ...stage, choices })}
            />
          )}

          {stage.step === 'review' && (
            <div className="sticky bottom-0 mt-6 flex justify-end gap-2 border-t border-line bg-background pt-4">
              <Button onClick={close} disabled={applying}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={applying}
                onClick={async () => {
                  setApplying(true);
                  setError(null);
                  try {
                    await onApply(applyImport(current, stage.plan, stage.choices));
                    close();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not save.');
                  } finally {
                    setApplying(false);
                  }
                }}
              >
                {applying && <Spinner />} Apply and save
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Review({ plan, choices, onChange }: { plan: ImportPlan; choices: ImportChoices; onChange: (c: ImportChoices) => void }) {
  const set = <K extends keyof ImportChoices>(key: K, id: string | number, value: ImportChoices[K][keyof ImportChoices[K]]) =>
    onChange({ ...choices, [key]: { ...choices[key], [id]: value } });
  const kindLabel = (kind: string) => PROFILE_KINDS.find((k) => k.kind === kind)?.label ?? kind;
  const questions = plan.details.length + plan.changedLinks.length + plan.changedEntries.length;

  return (
    <div className="mt-5 space-y-6 text-sm">
      {questions > 0 && (
        <section>
          <h3 className="font-medium">
            Different in your CVs <span className="font-normal text-subtle">· choose which to keep</span>
          </h3>
          <div className="mt-3 space-y-3">
            {plan.details.map((d) => (
              <Choice
                key={d.key}
                title={DETAIL_LABEL[d.key]}
                options={d.options.map((o, i) => ({
                  value: String(i),
                  label: o.from === 'My Info' ? 'Keep My Info' : `From ${o.from}`,
                  body: o.value.length > 220 ? `${o.value.slice(0, 220)}…` : o.value,
                }))}
                value={String(choices.details[d.key] ?? 0)}
                onPick={(v) => set('details', d.key, Number(v))}
              />
            ))}
            {plan.changedLinks.map((l) => (
              <Choice
                key={l.label}
                title={`Link: ${l.label}`}
                options={[
                  { value: 'current', label: 'Keep My Info', body: l.current },
                  { value: 'incoming', label: 'Use the CV', body: l.incoming },
                ]}
                value={choices.changedLinks[l.label]}
                onPick={(v) => set('changedLinks', l.label, v as 'current' | 'incoming')}
              />
            ))}
            {plan.changedEntries.map((c) => (
              <Choice
                key={c.current.id}
                title={`${kindLabel(c.current.sectionId)}: ${c.current.title || c.incoming.title}`}
                note={`The CV has ${c.adds.join(', ')}.`}
                options={[
                  { value: 'both', label: 'Combine', body: 'Keep yours and add what is new from the CV' },
                  { value: 'current', label: 'Keep My Info', body: <EntryText entry={c.current} /> },
                  { value: 'incoming', label: 'Use the CV', body: <EntryText entry={c.incoming} /> },
                ]}
                value={choices.changedEntries[c.current.id]}
                onPick={(v) => set('changedEntries', c.current.id, v as EntryChoice)}
              />
            ))}
          </div>
        </section>
      )}

      {(plan.fills.length > 0 || plan.newEntries.length > 0 || plan.newLinks.length > 0 || plan.newFacts.length > 0 || plan.newSkills.length > 0) && (
        <section>
          <h3 className="font-medium">
            New <span className="font-normal text-subtle">· untick anything you do not want</span>
          </h3>
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
            {plan.fills.map((f) => (
              <li key={f.key} className="flex gap-3 px-3 py-2">
                <span className="w-4 text-emerald-600">✓</span>
                <span>
                  <span className="text-subtle">{DETAIL_LABEL[f.key]}:</span> {f.value.length > 160 ? `${f.value.slice(0, 160)}…` : f.value}
                </span>
              </li>
            ))}
            {plan.newEntries.map((e) => (
              <Tick key={e.id} checked={choices.newEntries[e.id]} onChange={(v) => set('newEntries', e.id, v)}>
                <span className="text-subtle">{kindLabel(e.sectionId)}:</span> <EntryText entry={e} />
              </Tick>
            ))}
            {plan.newLinks.map((l) => (
              <Tick key={l.label} checked={choices.newLinks[l.label]} onChange={(v) => set('newLinks', l.label, v)}>
                <span className="text-subtle">Link:</span> {l.label} <span className="text-subtle">{l.href || l.value}</span>
              </Tick>
            ))}
            {plan.newFacts.map((f, i) => (
              <Tick key={i} checked={choices.newFacts[i]} onChange={(v) => set('newFacts', i, v)}>
                <span className="text-subtle">About you:</span> {f}
              </Tick>
            ))}
            {plan.newSkills.map((s) => (
              <Tick key={s.category} checked={choices.newSkills[s.category]} onChange={(v) => set('newSkills', s.category, v)}>
                <span className="text-subtle">Skills{s.category ? ` (${s.category})` : ''}:</span> {s.skills.join(', ')}
              </Tick>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EntryText({ entry }: { entry: LibraryEntry }) {
  const head = [entry.title, entry.subtitle, entry.dateText].filter(Boolean).join(' · ');
  return (
    <span>
      <span className="font-medium">{head || '(untitled)'}</span>
      {entry.bullets.length > 0 && (
        <span className="mt-1 block space-y-0.5 text-xs text-subtle">
          {entry.bullets.slice(0, 6).map((b) => (
            <span key={b.id} className="block">
              • {b.text}
            </span>
          ))}
          {entry.bullets.length > 6 && <span className="block">+ {entry.bullets.length - 6} more</span>}
        </span>
      )}
      {entry.links.length > 0 && (
        <span className="mt-1 block text-xs break-all text-subtle">
          Links: {entry.links.map((l) => (l.url ? `${l.label || 'link'} (${shortUrl(l.url)})` : l.label)).join(', ')}
        </span>
      )}
    </span>
  );
}

/** Enough of an address to tell two apart: host and path, without the scheme or query. */
function shortUrl(url: string): string {
  const s = url.replace(/^[a-z]+:\/\//i, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

function Tick({ checked, onChange, children }: { checked: boolean | undefined; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <li>
      <label className="flex cursor-pointer gap-3 px-3 py-2 hover:bg-foreground/3">
        <input type="checkbox" className="mt-1" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">{children}</span>
      </label>
    </li>
  );
}

function Choice({
  title,
  note,
  options,
  value,
  onPick,
}: {
  title: string;
  note?: string;
  options: { value: string; label: string; body: React.ReactNode }[];
  value: string | undefined;
  onPick: (v: string) => void;
}) {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="font-medium">{title}</p>
      {note && <p className="mt-0.5 text-xs text-subtle">{note}</p>}
      <div className={cx('mt-2 grid gap-2', options.length >= 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onPick(o.value)}
            className={cx(
              'rounded-md border px-3 py-2 text-left transition-colors',
              value === o.value ? 'border-foreground bg-foreground/5' : 'border-line hover:border-foreground/40',
            )}
          >
            <span className="flex items-center gap-2 text-xs font-medium">
              <span className={cx('inline-block size-3 rounded-full border', value === o.value ? 'border-foreground bg-foreground' : 'border-subtle')} />
              {o.label}
            </span>
            <span className="mt-1 block text-xs break-words">{o.body}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
