'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Input,
  Panel,
  Spinner,
  Textarea,
  cx,
} from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import { newId } from '@/lib/id';
import type { LibraryEntry, PersonalInfo, SkillGroup, SummaryVariant } from '@/types/cv';

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Label + URL on one row. A grid rather than flex: both inputs are full-width
 * by default, so in a flex row the label swallowed the space and pushed the
 * URL field off the edge of the card.
 */
function LinkRow({
  label,
  url,
  labelPlaceholder = 'Label, e.g. Github',
  onChange,
  onRemove,
}: {
  label: string;
  url: string;
  labelPlaceholder?: string;
  onChange: (next: { label?: string; url?: string }) => void;
  onRemove: () => void;
}) {
  const href = /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : url.trim() ? `https://${url.trim()}` : '';
  return (
    <div className="grid grid-cols-[minmax(6rem,10rem)_minmax(0,1fr)_auto] items-center gap-2">
      <Input value={label} placeholder={labelPlaceholder} onChange={(e) => onChange({ label: e.target.value })} />
      <Input value={url} placeholder="https://…" onChange={(e) => onChange({ url: e.target.value })} />
      <div className="flex items-center">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            title="Open link"
            className="px-2 text-sm text-subtle hover:text-foreground"
          >
            ↗
          </a>
        ) : (
          <span className="px-2 text-sm text-subtle/40">↗</span>
        )}
        <Button size="sm" variant="ghost" onClick={onRemove} aria-label="Remove link">
          ✕
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function EntryCard({
  entry,
  index,
  total,
  defaultOpen = false,
  onChange,
  onMove,
  onDelete,
}: {
  entry: LibraryEntry;
  index: number;
  total: number;
  defaultOpen?: boolean;
  onChange: (next: LibraryEntry) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const patch = (fields: Partial<LibraryEntry>) => onChange({ ...entry, ...fields });

  const updateBullet = (id: string, text: string) =>
    patch({ bullets: entry.bullets.map((b) => (b.id === id ? { ...b, text } : b)) });

  const moveBullet = (id: string, delta: number) => {
    const i = entry.bullets.findIndex((b) => b.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= entry.bullets.length) return;
    const bullets = [...entry.bullets];
    [bullets[i], bullets[j]] = [bullets[j], bullets[i]];
    patch({ bullets });
  };

  return (
    <Panel className={cx('overflow-hidden', entry.archived && 'opacity-55')}>
      <div className="flex items-start gap-3 p-3">
        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 shrink-0 text-subtle hover:text-foreground"
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          {open ? '▾' : '▸'}
        </button>

        <div className="min-w-0 flex-1">
          <button onClick={() => setOpen((v) => !v)} className="block w-full text-left">
            <span className="block truncate text-sm font-medium">
              {entry.title || <span className="text-subtle">Untitled</span>}
            </span>
            <span className="mt-0.5 block truncate text-xs text-subtle">
              {[entry.subtitle, entry.dateText].filter(Boolean).join(' · ') || 'No details yet'}
            </span>
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge>{entry.bullets.length} bullets</Badge>
            {entry.archived && <Badge tone="warn">Archived</Badge>}
            {entry.tags.slice(0, 4).map((tag) => (
              <span key={tag} className="text-[11px] text-subtle">
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0}>
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
          >
            ↓
          </Button>
          <Button size="sm" variant="ghost" onClick={() => patch({ archived: !entry.archived })}>
            {entry.archived ? 'Restore' : 'Archive'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title">
              <Input value={entry.title} onChange={(e) => patch({ title: e.target.value })} />
            </Field>
            <Field label="Subtitle" hint="Company, institution, or tech stack">
              <Input
                value={entry.subtitle ?? ''}
                onChange={(e) => patch({ subtitle: e.target.value || undefined })}
              />
            </Field>
            <Field label="Dates" hint="Shown exactly as typed">
              <Input
                value={entry.dateText ?? ''}
                onChange={(e) => patch({ dateText: e.target.value || undefined })}
              />
            </Field>
            <Field label="Location">
              <Input
                value={entry.location ?? ''}
                onChange={(e) => patch({ location: e.target.value || undefined })}
              />
            </Field>
            <Field label="Title link" hint="Makes the title itself clickable">
              <Input
                value={entry.link ?? ''}
                placeholder="https://…"
                onChange={(e) => patch({ link: e.target.value || undefined })}
              />
            </Field>
            <Field label="Sort date" hint="YYYY-MM, used only for ordering">
              <Input
                value={entry.sortDate ?? ''}
                onChange={(e) => patch({ sortDate: e.target.value || undefined })}
              />
            </Field>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-subtle uppercase">Bullets</p>
            <div className="space-y-2">
              {entry.bullets.map((bullet, i) => (
                <div key={bullet.id} className="flex gap-2">
                  <Textarea autoGrow
                    rows={2}
                    value={bullet.text}
                    onChange={(e) => updateBullet(bullet.id, e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex shrink-0 flex-col gap-1">
                    <Button size="sm" variant="ghost" onClick={() => moveBullet(bullet.id, -1)} disabled={i === 0}>
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => moveBullet(bullet.id, 1)}
                      disabled={i === entry.bullets.length - 1}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => patch({ bullets: entry.bullets.filter((b) => b.id !== bullet.id) })}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => patch({ bullets: [...entry.bullets, { id: newId(), text: '', tags: [] }] })}
            >
              Add bullet
            </Button>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium tracking-wide text-subtle uppercase">Links</p>
            <p className="mb-2 text-xs text-subtle">
              Printed as labels (e.g. Github, Live Link) and clickable in the exported PDF.
            </p>
            <div className="space-y-2">
              {entry.links.map((link, i) => (
                <LinkRow
                  key={i}
                  label={link.label}
                  url={link.url}
                  onChange={(next) =>
                    patch({ links: entry.links.map((l, j) => (j === i ? { ...l, ...next } : l)) })
                  }
                  onRemove={() => patch({ links: entry.links.filter((_, j) => j !== i) })}
                />
              ))}
            </div>
            <Button
              size="sm"
              className="mt-2"
              onClick={() => patch({ links: [...entry.links, { label: '', url: '' }] })}
            >
              Add link
            </Button>
          </div>

          <Field label="Tags" hint="Comma separated. Never printed — used to match against job descriptions.">
            <Input
              value={entry.tags.join(', ')}
              onChange={(e) => patch({ tags: parseList(e.target.value) })}
            />
          </Field>

          <div className="flex justify-end">
            <Button variant="danger" size="sm" onClick={onDelete}>
              Delete permanently
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export type ImportedMaterial = Awaited<ReturnType<typeof api.importNotes>>;

/**
 * Rough notes in, structured library entries out. The result is handed back
 * to the caller's draft rather than saved, so it is reviewed like any edit.
 */
export function ImportFromNotes({
  sectionId,
  sectionTitle,
  isSkills,
  hasApiKey,
  onImported,
}: {
  sectionId: string;
  sectionTitle: string;
  isSkills: boolean;
  hasApiKey: boolean;
  onImported: (result: ImportedMaterial) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        {isSkills ? 'Add skills from notes' : 'Add from notes'}
      </Button>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      onImported(await api.importNotes({ notes, sectionId }));
      setNotes('');
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read those notes.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="space-y-3 p-4">
      <div>
        <p className="text-sm font-medium">Add to {sectionTitle} from notes</p>
        <p className="mt-0.5 text-xs text-subtle">
          {isSkills
            ? 'List tools and technologies however you like. They are sorted into your existing groups.'
            : 'Describe what you did, messily is fine. It becomes an entry with bullets written in the voice of your existing CV, using only facts you give. Nothing is saved until you review it.'}
        </p>
      </div>
      <Textarea
        rows={7}
        value={notes}
        disabled={busy}
        placeholder={
          isSkills
            ? 'e.g. terraform, some AWS (lambda, s3), grafana dashboards, pytest'
            : 'e.g. Summer 2024, built an internal tool at Acme for the support team. Python + FastAPI. Cut ticket triage time from ~2 days to same-day. Wrote the on-call runbook.'
        }
        onChange={(e) => setNotes(e.target.value)}
      />
      {error && <ErrorNote>{error}</ErrorNote>}
      {!hasApiKey && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Needs an Anthropic API key. Add ANTHROPIC_API_KEY to .env.local.
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={run} disabled={busy || !hasApiKey || !notes.trim()}>
          {busy && <Spinner />}
          {busy ? 'Structuring…' : 'Create entries'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function SkillGroupCard({
  group,
  index,
  total,
  onChange,
  onMove,
  onDelete,
}: {
  group: SkillGroup;
  index: number;
  total: number;
  onChange: (next: SkillGroup) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  return (
    <Panel className={cx('p-3', group.archived && 'opacity-55')}>
      <div className="flex items-center gap-2">
        <Input
          value={group.category}
          placeholder="Category (leave blank for an ungrouped list)"
          onChange={(e) => onChange({ ...group, category: e.target.value })}
          className="flex-1"
        />
        <Button size="sm" variant="ghost" onClick={() => onMove(-1)} disabled={index === 0}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onMove(1)} disabled={index === total - 1}>
          ↓
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange({ ...group, archived: !group.archived })}>
          {group.archived ? 'Restore' : 'Archive'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          ✕
        </Button>
      </div>
      <Textarea autoGrow
        rows={2}
        className="mt-2"
        value={group.skills.join(', ')}
        placeholder="Comma separated skills"
        onChange={(e) => onChange({ ...group, skills: parseList(e.target.value) })}
      />
      <p className="mt-1 text-xs text-subtle">{group.skills.length} skills</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

export function PersonalEditor({
  personal,
  onChange,
}: {
  personal: PersonalInfo;
  onChange: (next: PersonalInfo) => void;
}) {
  const patch = (fields: Partial<PersonalInfo>) => onChange({ ...personal, ...fields });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <Input value={personal.fullName} onChange={(e) => patch({ fullName: e.target.value })} />
        </Field>
        <Field label="Headline" hint="The role line under your name, if your CV has one">
          <Input
            value={personal.headline ?? ''}
            onChange={(e) => patch({ headline: e.target.value || undefined })}
          />
        </Field>
        <Field label="Email">
          <Input
            value={personal.email ?? ''}
            onChange={(e) => patch({ email: e.target.value || undefined })}
          />
        </Field>
        <Field label="Phone">
          <Input
            value={personal.phone ?? ''}
            onChange={(e) => patch({ phone: e.target.value || undefined })}
          />
        </Field>
        <Field label="Location">
          <Input
            value={personal.location ?? ''}
            onChange={(e) => patch({ location: e.target.value || undefined })}
          />
        </Field>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium tracking-wide text-subtle uppercase">Links</p>
        <div className="space-y-2">
          {personal.links.map((link, i) => (
            <LinkRow
              key={link.id}
              label={link.label}
              url={link.href ?? ''}
              labelPlaceholder="Displayed text"
              onChange={(next) =>
                patch({
                  links: personal.links.map((l) =>
                    l.id === link.id
                      ? {
                          ...l,
                          ...(next.label !== undefined ? { label: next.label } : {}),
                          ...(next.url !== undefined ? { href: next.url || undefined } : {}),
                        }
                      : l,
                  ),
                })
              }
              onRemove={() =>
                patch({ links: [...personal.links.slice(0, i), ...personal.links.slice(i + 1)] })
              }
            />
          ))}
        </div>
        <Button
          size="sm"
          className="mt-2"
          onClick={() =>
            patch({ links: [...personal.links, { id: newId(), label: '', value: '' }] })
          }
        >
          Add link
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SummaryEditor({
  variants,
  onChange,
}: {
  variants: SummaryVariant[];
  onChange: (next: SummaryVariant[]) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-subtle">
        Keep several summaries and the tailoring step will pick whichever fits the job best.
      </p>
      {variants.map((variant) => (
        <Panel key={variant.id} className="p-3">
          <div className="flex gap-2">
            <Input
              value={variant.label}
              placeholder="Label, e.g. Backend roles"
              onChange={(e) =>
                onChange(variants.map((v) => (v.id === variant.id ? { ...v, label: e.target.value } : v)))
              }
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange(variants.filter((v) => v.id !== variant.id))}
            >
              ✕
            </Button>
          </div>
          <Textarea autoGrow
            rows={3}
            className="mt-2"
            value={variant.text}
            onChange={(e) =>
              onChange(variants.map((v) => (v.id === variant.id ? { ...v, text: e.target.value } : v)))
            }
          />
        </Panel>
      ))}
      <Button
        size="sm"
        onClick={() => onChange([...variants, { id: newId(), label: 'New summary', text: '' }])}
      >
        Add summary
      </Button>
    </div>
  );
}
