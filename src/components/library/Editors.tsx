'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  Field,
  Input,
  Panel,
  Textarea,
  cx,
} from '@/components/ui/kit';
import { newId } from '@/lib/id';
import type { LibraryEntry, PersonalInfo } from '@/types/cv';

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
