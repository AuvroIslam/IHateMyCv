'use client';

import { useState } from 'react';
import { Button, Input, Panel, Textarea, cx } from '@/components/ui/kit';
import Link from 'next/link';
import { PROFILE_KINDS, norm } from '@/lib/profile';
import { shapeLike } from '@/lib/shape';
import type {
  CvDocumentData,
  Profile,
  DesignSpec,
  RenderedEntry,
  RenderedSection,
} from '@/types/cv';

/**
 * Manual control over a generated CV: pick, drop, reorder, and correct any
 * text or link. Colours and fonts are changed through the chat.
 */
export default function CvEditor({
  design,
  myInfo,
  data,
  onChange,
}: {
  design: DesignSpec;
  /** Where items are added from: My Info, and nothing else. */
  myInfo: Profile | null;
  data: CvDocumentData;
  onChange: (next: CvDocumentData) => void;
}) {
  const [open, setOpen] = useState<string | null>(design.sections[0]?.id ?? null);

  const patchSection = (sectionId: string, fn: (s: RenderedSection) => RenderedSection) =>
    onChange({
      ...data,
      sections: data.sections.map((s) => (s.sectionId === sectionId ? fn(s) : s)),
    });

  return (
    <div className="space-y-2">
      {design.sections.map((def) => {
        const section = data.sections.find((s) => s.sectionId === def.id);
        if (!section) return null;
        const expanded = open === def.id;

        const count =
          def.type === 'skills'
            ? section.skillGroups.reduce((n, g) => n + g.skills.length, 0)
            : def.type === 'summary'
              ? section.summary
                ? 1
                : 0
              : section.entries.length;

        return (
          <Panel key={def.id} className={cx('overflow-hidden', section.hidden && 'opacity-55')}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                onClick={() => setOpen(expanded ? null : def.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <span className="text-subtle">{expanded ? '▾' : '▸'}</span>
                <span className="truncate text-sm font-medium">{section.title ?? def.title}</span>
                <span className="text-xs text-subtle tabular-nums">{count}</span>
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => patchSection(def.id, (s) => ({ ...s, hidden: !s.hidden }))}
              >
                {section.hidden ? 'Show' : 'Hide'}
              </Button>
            </div>

            {expanded && (
              <div className="space-y-3 border-t border-line p-3">
                {def.type === 'summary' && (
                  <Textarea
                    autoGrow
                    rows={3}
                    value={section.summary ?? ''}
                    placeholder="No summary on this CV."
                    onChange={(e) =>
                      patchSection(def.id, (s) => ({ ...s, summary: e.target.value }))
                    }
                  />
                )}

                {def.type === 'skills' &&
                  section.skillGroups.map((group, gi) => (
                    <div key={group.groupId ?? gi}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-subtle">
                          {group.category || 'Ungrouped'}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={gi === 0}
                            onClick={() =>
                              patchSection(def.id, (s) => ({
                                ...s,
                                skillGroups: swap(s.skillGroups, gi, gi - 1),
                              }))
                            }
                          >
                            ↑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={gi === section.skillGroups.length - 1}
                            onClick={() =>
                              patchSection(def.id, (s) => ({
                                ...s,
                                skillGroups: swap(s.skillGroups, gi, gi + 1),
                              }))
                            }
                          >
                            ↓
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        autoGrow
                        rows={1}
                        value={group.skills.join(', ')}
                        onChange={(e) =>
                          patchSection(def.id, (s) => ({
                            ...s,
                            skillGroups: s.skillGroups.map((g, i) =>
                              i === gi
                                ? {
                                    ...g,
                                    skills: e.target.value
                                      .split(',')
                                      .map((v) => v.trim())
                                      .filter(Boolean),
                                  }
                                : g,
                            ),
                          }))
                        }
                      />
                    </div>
                  ))}

                {def.type !== 'summary' &&
                  def.type !== 'skills' &&
                  section.entries.map((entry, ei) => (
                    <EntryEditor
                      key={entry.entryId ?? ei}
                      entry={entry}
                      index={ei}
                      total={section.entries.length}
                      onChange={(next) =>
                        patchSection(def.id, (s) => ({
                          ...s,
                          entries: s.entries.map((e, i) => (i === ei ? next : e)),
                        }))
                      }
                      onMove={(delta) =>
                        patchSection(def.id, (s) => ({
                          ...s,
                          entries: swap(s.entries, ei, ei + delta),
                        }))
                      }
                      onRemove={() =>
                        patchSection(def.id, (s) => ({
                          ...s,
                          entries: s.entries.filter((_, i) => i !== ei),
                        }))
                      }
                    />
                  ))}

                {def.type !== 'summary' && def.type !== 'skills' && (
                  <AddFromMyInfo
                    myInfo={myInfo}
                    kind={def.type}
                    onCv={section.entries}
                    // Shaped like the section's other entries: their fields, their link slots.
                    onAdd={(entry) =>
                      patchSection(def.id, (s) => ({ ...s, entries: [...s.entries, shapeLike(entry, s.entries)] }))
                    }
                  />
                )}
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}

function swap<T>(list: T[], i: number, j: number): T[] {
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function EntryEditor({
  entry,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  entry: RenderedEntry;
  index: number;
  total: number;
  onChange: (next: RenderedEntry) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-line">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-sm">{entry.title || 'Untitled'}</span>
          <span className="block truncate text-xs text-subtle">
            {[entry.subtitle, entry.dateText].filter(Boolean).join(' · ')}
          </span>
        </button>
        <span className="shrink-0 text-xs text-subtle tabular-nums" title="Bullets">
          {entry.bullets.length}
        </span>
        <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => onMove(-1)}>
          ↑
        </Button>
        <Button size="sm" variant="ghost" disabled={index === total - 1} onClick={() => onMove(1)}>
          ↓
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          ✕
        </Button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-line p-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Title" value={entry.title} onChange={(title) => onChange({ ...entry, title })} />
            <Field label="Organisation" value={entry.subtitle} onChange={(subtitle) => onChange({ ...entry, subtitle })} />
            <Field label="Dates" value={entry.dateText} onChange={(dateText) => onChange({ ...entry, dateText })} />
            <Field label="Location" value={entry.location} onChange={(location) => onChange({ ...entry, location })} />
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-subtle">Bullets</p>
            <div className="space-y-2">
              {entry.bullets.map((text, bi) => (
                <div key={bi} className="flex gap-1">
                  <Textarea
                    autoGrow
                    rows={1}
                    value={text}
                    className="flex-1 text-[13px]"
                    onChange={(e) =>
                      onChange({
                        ...entry,
                        bullets: entry.bullets.map((b, i) => (i === bi ? e.target.value : b)),
                      })
                    }
                  />
                  <div className="flex flex-col gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bi === 0}
                      onClick={() => onChange({ ...entry, bullets: swap(entry.bullets, bi, bi - 1) })}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={bi === entry.bullets.length - 1}
                      onClick={() => onChange({ ...entry, bullets: swap(entry.bullets, bi, bi + 1) })}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onChange({ ...entry, bullets: entry.bullets.filter((_, i) => i !== bi) })}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <Button size="sm" className="mt-2" onClick={() => onChange({ ...entry, bullets: [...entry.bullets, ''] })}>
              Add bullet
            </Button>
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-subtle">Links</p>
            <div className="space-y-2">
              {(entry.links ?? []).map((link, li) => (
                <div key={li} className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-1">
                  <Input
                    value={link.label}
                    placeholder="Label, e.g. Github"
                    className="text-[13px]"
                    onChange={(e) => onChange({ ...entry, links: (entry.links ?? []).map((l, i) => (i === li ? { ...l, label: e.target.value } : l)) })}
                  />
                  <Input
                    value={link.url}
                    placeholder={link.blank ? 'Add the URL (not shown until filled)' : 'https://'}
                    className="text-[13px]"
                    onChange={(e) => onChange({ ...entry, links: (entry.links ?? []).map((l, i) => (i === li ? { ...l, url: e.target.value } : l)) })}
                  />
                  <div className="flex items-center">
                    {link.url && (
                      <a href={link.url} target="_blank" rel="noreferrer" className="px-1 text-xs text-subtle hover:text-foreground" title="Open">
                        ↗
                      </a>
                    )}
                    <Button
                    size="sm"
                    variant="ghost"
                      onClick={() => onChange({ ...entry, links: (entry.links ?? []).filter((_, i) => i !== li) })}
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
              onClick={() => onChange({ ...entry, links: [...(entry.links ?? []), { label: '', url: '' }] })}
            >
              Add link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-subtle">{label}</span>
      <Input value={value ?? ''} className="text-[13px]" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** Items of this section's kind from My Info that are not on the CV yet. */
function AddFromMyInfo({
  myInfo,
  kind,
  onCv,
  onAdd,
}: {
  myInfo: Profile | null;
  kind: string;
  onCv: RenderedEntry[];
  onAdd: (entry: RenderedEntry) => void;
}) {
  const label = PROFILE_KINDS.find((k) => k.kind === kind)?.label;
  if (!label) return null; // a section of no kind My Info keeps
  const available = (myInfo?.entries ?? []).filter(
    (e) => e.sectionId === kind && (e.title.trim() || e.bullets.length) && !onCv.some((x) => norm(x.title) === norm(e.title)),
  );
  if (available.length === 0) {
    return (
      <p className="text-xs text-subtle">
        Nothing more in My Info under {label}.{' '}
        <Link href="/profile" className="underline hover:text-foreground">
          Add it in My Info
        </Link>{' '}
        to bring it here.
      </p>
    );
  }

  return (
    <select
      value=""
      className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
      onChange={(e) => {
        const entry = available.find((x) => x.id === e.target.value);
        if (!entry) return;
        onAdd({
          entryId: `p-${entry.id}`,
          title: entry.title,
          subtitle: entry.subtitle,
          location: entry.location,
          dateText: entry.dateText,
          note: entry.note,
          link: entry.link,
          links: entry.links.map((l) => ({ ...l })),
          bullets: entry.bullets.map((b) => b.text).filter((t) => t.trim()),
        });
      }}
    >
      <option value="">+ Add from My Info ({available.length})</option>
      {available.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.title || '(untitled)'}
          {entry.subtitle ? ` — ${entry.subtitle}` : ''}
        </option>
      ))}
    </select>
  );
}
