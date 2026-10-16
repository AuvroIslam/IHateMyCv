'use client';

import { useState } from 'react';
import { Button, Panel, Textarea, cx } from '@/components/ui/kit';
import { bulletPrintOf } from '@/lib/assemble';
import type {
  CareerLibrary,
  CvDocumentData,
  DesignSpec,
  RenderedEntry,
  RenderedSection,
} from '@/types/cv';

/**
 * Manual control over a generated CV.
 *
 * Deliberately limited to the same moves the AI has: pick, drop, reorder, and
 * correct wording. There is no styling control here because styling is not a
 * per-CV decision - it belongs to the captured design.
 */
export default function CvEditor({
  design,
  library,
  data,
  onChange,
}: {
  design: DesignSpec;
  library: CareerLibrary | null;
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
                    rows={4}
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
                        rows={2}
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

                {def.type !== 'summary' && def.type !== 'skills' && library && (
                  <AddFromLibrary
                    library={library}
                    sectionId={def.id}
                    used={section.entries.map((e) => e.entryId).filter(Boolean) as string[]}
                    onAdd={(entry) =>
                      patchSection(def.id, (s) => ({ ...s, entries: [...s.entries, entry] }))
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
        <span className="shrink-0 text-xs text-subtle tabular-nums">{entry.bullets.length}</span>
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
        <div className="space-y-2 border-t border-line p-2">
          {entry.bullets.map((text, bi) => (
            <div key={bi} className="flex gap-1">
              <Textarea
                rows={2}
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
                  onClick={() =>
                    onChange({ ...entry, bullets: entry.bullets.filter((_, i) => i !== bi) })
                  }
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
          <Button
            size="sm"
            onClick={() => onChange({ ...entry, bullets: [...entry.bullets, ''] })}
          >
            Add bullet
          </Button>
        </div>
      )}
    </div>
  );
}

function AddFromLibrary({
  library,
  sectionId,
  used,
  onAdd,
}: {
  library: CareerLibrary;
  sectionId: string;
  used: string[];
  onAdd: (entry: RenderedEntry) => void;
}) {
  const available = library.entries.filter(
    (e) => e.sectionId === sectionId && !e.archived && !used.includes(e.id),
  );
  if (available.length === 0) return null;

  return (
    <select
      value=""
      className="w-full rounded-md border border-line bg-background px-2 py-1.5 text-sm"
      onChange={(e) => {
        const entry = available.find((x) => x.id === e.target.value);
        if (!entry) return;
        onAdd({
          entryId: entry.id,
          title: entry.title,
          subtitle: entry.subtitle,
          location: entry.location,
          dateText: entry.dateText,
          link: entry.link,
          links: entry.links.map((l) => ({ ...l })),
          group: entry.group,
          bullets: entry.bullets.map((b) => b.text),
          bulletPrint: bulletPrintOf(entry),
        });
      }}
    >
      <option value="">+ Add from library ({available.length} available)</option>
      {available.map((entry) => (
        <option key={entry.id} value={entry.id}>
          {entry.title}
          {entry.subtitle ? ` — ${entry.subtitle}` : ''}
        </option>
      ))}
    </select>
  );
}
