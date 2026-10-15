'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvPreview from '@/components/cv/CvPreview';
import {
  EntryCard,
  ImportFromNotes,
  type ImportedMaterial,
  PersonalEditor,
  SkillGroupCard,
  SummaryEditor,
} from '@/components/library/Editors';
import { Button, EmptyState, ErrorNote, Panel, Spinner, cx } from '@/components/ui/kit';
import { buildBaseDocument } from '@/lib/assemble';
import { newId } from '@/lib/id';
import type { CareerLibrary, LibraryEntry, SkillGroup } from '@/types/cv';

type Tab = { key: string; label: string };

export default function LibraryPage() {
  const { library, design, loading, error, saveLibrary, hasApiKey } = useApp();
  const [draft, setDraft] = useState<CareerLibrary | null>(null);
  /** Entries just created, which open expanded so they get reviewed. */
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<string>('details');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  // Seed the draft during render rather than in an effect: the library arrives
  // from the server with the first paint, so an effect would only add a wasted
  // render pass. `seededFrom` makes this run once per distinct library.
  const [seededFrom, setSeededFrom] = useState<CareerLibrary | null>(null);
  if (library && library !== seededFrom) {
    setSeededFrom(library);
    if (!draft) setDraft(structuredClone(library));
  }

  const dirty = useMemo(
    () => Boolean(draft && library && JSON.stringify(draft) !== JSON.stringify(library)),
    [draft, library],
  );

  const tabs: Tab[] = useMemo(() => {
    if (!design) return [];
    return [
      { key: 'details', label: 'Personal details' },
      ...design.sections.map((s) => ({ key: s.id, label: s.title })),
    ];
  }, [design]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16">
        <ErrorNote>{error}</ErrorNote>
      </div>
    );
  }

  if (!library || !design || !draft) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20">
        <EmptyState
          title="No Career Library yet"
          body="Upload your CV and we will turn it into a set of reusable components you can edit and extend."
          action={
            <Link href="/upload">
              <Button variant="primary">Upload your CV</Button>
            </Link>
          }
        />
      </div>
    );
  }

  const section = design.sections.find((s) => s.id === active);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveLibrary({ library: draft });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const updateEntries = (fn: (entries: LibraryEntry[]) => LibraryEntry[]) =>
    setDraft({ ...draft, entries: fn(draft.entries) });

  const updateGroups = (fn: (groups: SkillGroup[]) => SkillGroup[]) =>
    setDraft({ ...draft, skillGroups: fn(draft.skillGroups) });

  /** Moves an item within its own section without disturbing the global list. */
  const moveWithinSection = <T extends { id: string; sectionId: string }>(
    all: T[],
    id: string,
    delta: number,
  ): T[] => {
    const siblings = all.filter((x) => x.sectionId === all.find((y) => y.id === id)?.sectionId);
    const i = siblings.findIndex((x) => x.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= siblings.length) return all;

    const reordered = [...siblings];
    [reordered[i], reordered[j]] = [reordered[j], reordered[i]];

    const queue = [...reordered];
    return all.map((x) => (x.sectionId === siblings[0].sectionId ? queue.shift()! : x));
  };

  const sectionEntries = section ? draft.entries.filter((e) => e.sectionId === section.id) : [];
  const sectionGroups = section ? draft.skillGroups.filter((g) => g.sectionId === section.id) : [];

  const applyImport = (sectionId: string, result: ImportedMaterial) => {
    setFreshIds(new Set(result.entries.map((e) => e.id)));
    // Skills merge into a same-named group where one exists, so importing
    // "python" does not start a second "Languages" line on the CV.
    const groups = draft.skillGroups.map((g) => ({ ...g, skills: [...g.skills] }));
    for (const incoming of result.skills) {
      const match = groups.find(
        (g) =>
          g.sectionId === sectionId &&
          g.category.trim().toLowerCase() === incoming.category.toLowerCase(),
      );
      if (match) {
        const have = new Set(match.skills.map((s) => s.toLowerCase()));
        match.skills.push(...incoming.skills.filter((s) => !have.has(s.toLowerCase())));
      } else {
        groups.push({
          id: newId(),
          sectionId,
          category: incoming.category,
          skills: incoming.skills,
          archived: false,
        });
      }
    }
    setDraft({ ...draft, entries: [...draft.entries, ...result.entries], skillGroups: groups });
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Career Library</h1>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Everything you could say about yourself. Tailored CVs are assembled from these parts —
            add the work that never fits on one page.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setPreview((v) => !v)}>
            {preview ? 'Hide preview' : 'Preview full CV'}
          </Button>
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {dirty ? 'Save changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {saveError && (
        <div className="mt-4">
          <ErrorNote>{saveError}</ErrorNote>
        </div>
      )}

      {preview && (
        <div className="mt-6 overflow-hidden rounded-lg bg-foreground/5 p-5">
          <p className="mb-4 text-xs text-subtle">
            Everything in the library, in your captured design. Archived items are excluded.
          </p>
          <CvPreview design={design} data={buildBaseDocument(draft, design)} />
        </div>
      )}

      <div className="mt-8 grid gap-6 md:grid-cols-[200px_1fr]">
        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {tabs.map((tab) => {
            const count =
              tab.key === 'details'
                ? null
                : draft.entries.filter((e) => e.sectionId === tab.key).length +
                  draft.skillGroups.filter((g) => g.sectionId === tab.key).length;
            return (
              <button
                key={tab.key}
                onClick={() => setActive(tab.key)}
                className={cx(
                  'flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  active === tab.key
                    ? 'bg-foreground/8 font-medium'
                    : 'text-subtle hover:text-foreground',
                )}
              >
                <span className="truncate">{tab.label}</span>
                {count !== null && <span className="text-xs tabular-nums opacity-60">{count}</span>}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          {active === 'details' && (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-sm font-semibold">Contact details</h2>
                <PersonalEditor
                  personal={draft.personal}
                  onChange={(personal) => setDraft({ ...draft, personal })}
                />
              </section>
              <section>
                <h2 className="mb-3 text-sm font-semibold">Summaries</h2>
                <SummaryEditor
                  variants={draft.summaryVariants}
                  onChange={(summaryVariants) => setDraft({ ...draft, summaryVariants })}
                />
              </section>
            </div>
          )}

          {section && section.type === 'summary' && (
            <SummaryEditor
              variants={draft.summaryVariants}
              onChange={(summaryVariants) => setDraft({ ...draft, summaryVariants })}
            />
          )}

          {section && section.type === 'skills' && (
            <div className="space-y-3">
              {sectionGroups.length === 0 && (
                <p className="text-sm text-subtle">No skill groups in this section yet.</p>
              )}
              {sectionGroups.map((group, i) => (
                <SkillGroupCard
                  key={group.id}
                  group={group}
                  index={i}
                  total={sectionGroups.length}
                  onChange={(next) =>
                    updateGroups((groups) => groups.map((g) => (g.id === next.id ? next : g)))
                  }
                  onMove={(delta) =>
                    updateGroups((groups) => moveWithinSection(groups, group.id, delta))
                  }
                  onDelete={() => updateGroups((groups) => groups.filter((g) => g.id !== group.id))}
                />
              ))}
              <div className="flex flex-wrap items-start gap-2">
                <Button
                  onClick={() =>
                    updateGroups((groups) => [
                      ...groups,
                      { id: newId(), sectionId: section.id, category: '', skills: [], archived: false },
                    ])
                  }
                >
                  Add skill group
                </Button>
                <ImportFromNotes
                  key={section.id}
                  sectionId={section.id}
                  sectionTitle={section.title}
                  isSkills
                  hasApiKey={hasApiKey}
                  onImported={(result) => applyImport(section.id, result)}
                />
              </div>
            </div>
          )}

          {section && section.type !== 'summary' && section.type !== 'skills' && (
            <div className="space-y-3">
              {sectionEntries.length === 0 && (
                <p className="text-sm text-subtle">Nothing in this section yet.</p>
              )}
              {sectionEntries.map((entry, i) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  index={i}
                  total={sectionEntries.length}
                  defaultOpen={freshIds.has(entry.id)}
                  onChange={(next) =>
                    updateEntries((entries) => entries.map((e) => (e.id === next.id ? next : e)))
                  }
                  onMove={(delta) =>
                    updateEntries((entries) => moveWithinSection(entries, entry.id, delta))
                  }
                  onDelete={() => updateEntries((entries) => entries.filter((e) => e.id !== entry.id))}
                />
              ))}
              <div className="flex flex-wrap items-start gap-2">
                <Button
                  onClick={() => {
                    const id = newId();
                    setFreshIds(new Set([id]));
                    updateEntries((entries) => [
                      ...entries,
                      {
                        id,
                        sectionId: section.id,
                        title: '',
                        links: [],
                        bullets: [{ id: newId(), text: '', tags: [] }],
                        tags: [],
                        archived: false,
                      },
                    ]);
                  }}
                >
                  Add to {section.title}
                </Button>
                <ImportFromNotes
                  key={section.id}
                  sectionId={section.id}
                  sectionTitle={section.title}
                  isSkills={false}
                  hasApiKey={hasApiKey}
                  onImported={(result) => applyImport(section.id, result)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {dirty && (
        <div className="no-print sticky bottom-4 mt-8 flex justify-center">
          <Panel className="flex items-center gap-3 px-4 py-2 shadow-lg">
            <span className="text-sm text-subtle">You have unsaved changes</span>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving && <Spinner />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(structuredClone(library))}>
              Discard
            </Button>
          </Panel>
        </div>
      )}
    </div>
  );
}
