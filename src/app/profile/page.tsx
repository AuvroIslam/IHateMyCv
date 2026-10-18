'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EntryCard, PersonalEditor } from '@/components/library/Editors';
import ImportFlow from '@/components/profile/ImportFlow';
import { Button, ErrorNote, Input, Panel, Spinner, Textarea, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import { newId } from '@/lib/id';
import { PROFILE_KINDS, normalizeProfile } from '@/lib/profile';
import type { LibraryEntry, Profile, ProfileKind, ProfileSkills } from '@/types/cv';

type Tab = 'about' | ProfileKind | 'skills';

/**
 * My Info: everything about the owner, apart from any one CV. Tailoring and
 * the chat pick from it; nothing here is printed until it is chosen for a CV.
 */
export default function MyInfoPage() {
  const { profile, library, refresh, cvs } = useApp();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>('about');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded during render, once per profile from the server (as the library page does).
  const [seededFrom, setSeededFrom] = useState<Profile | null | undefined>(undefined);
  if (profile !== seededFrom) {
    setSeededFrom(profile);
    if (!draft) setDraft(normalizeProfile(profile));
  }

  const saved = useMemo(() => JSON.stringify(normalizeProfile(profile)), [profile]);
  if (!draft) return null;
  const dirty = JSON.stringify(draft) !== saved;

  const save = async (next: Profile = draft) => {
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(next);
      setDraft(next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const entriesOf = (kind: ProfileKind) => draft.entries.filter((e) => e.sectionId === kind);
  const setEntries = (fn: (entries: LibraryEntry[]) => LibraryEntry[]) => setDraft({ ...draft, entries: fn(draft.entries) });
  const setSkills = (fn: (groups: ProfileSkills[]) => ProfileSkills[]) => setDraft({ ...draft, skills: fn(draft.skills ?? []) });
  const move = (id: string, delta: number) =>
    setEntries((all) => {
      const kind = all.find((e) => e.id === id)?.sectionId;
      const same = all.filter((e) => e.sectionId === kind);
      const i = same.findIndex((e) => e.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= same.length) return all;
      [same[i], same[j]] = [same[j], same[i]];
      const queue = [...same];
      return all.map((e) => (e.sectionId === kind ? queue.shift()! : e));
    });
  const add = (kind: ProfileKind) => {
    const id = newId();
    setFresh(new Set([id]));
    setEntries((all) => [
      ...all,
      { id, sectionId: kind, title: '', links: [], bullets: [{ id: newId(), text: '', tags: [] }], tags: [], archived: false },
    ]);
  };

  const kind = PROFILE_KINDS.find((k) => k.kind === tab);
  const empty = !draft.personal.fullName && draft.entries.length === 0 && !draft.about.trim();
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'about', label: 'About you' },
    ...PROFILE_KINDS.map((k) => ({ key: k.kind as Tab, label: k.label, count: entriesOf(k.kind).length })),
    { key: 'skills', label: 'Skills', count: (draft.skills ?? []).reduce((n, g) => n + g.skills.length, 0) },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Info</h1>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Everything about you, in one place: every job, project and achievement, with as many links as you like.
            When you tailor a CV, the best fit for the job is picked from here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ImportFlow current={draft} uploaded={cvs.filter((c) => c.uploaded).map((c) => ({ id: c.id, name: c.name }))} onApply={save} />
          <Button variant="primary" onClick={() => void save().catch(() => undefined)} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {dirty ? 'Save' : 'Saved'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {empty && (
        <Panel className="mt-6 p-4 text-sm">
          {library ? (
            <>
              Start from what your CVs already say: <strong>Import from CVs</strong> brings in your uploaded CV, and
              any older ones, and asks before changing anything. Then add what never fit on the page.
            </>
          ) : (
            <>
              Add your details by hand, or <strong>Import from CVs</strong>. To make CVs in your own design,{' '}
              <Link href="/upload" className="underline">
                upload the CV whose look you want to keep
              </Link>
              .
            </>
          )}
        </Panel>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col md:self-start md:overflow-visible">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                tab === t.key ? 'bg-foreground/8 font-medium' : 'text-subtle hover:text-foreground',
              )}
            >
              <span>{t.label}</span>
              {t.count !== undefined && <span className="text-xs tabular-nums opacity-60">{t.count}</span>}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {tab === 'about' && (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-sm font-semibold">Details and links</h2>
                <PersonalEditor personal={draft.personal} onChange={(personal) => setDraft({ ...draft, personal })} />
              </section>
              <section>
                <h2 className="text-sm font-semibold">Summary</h2>
                <p className="mt-1 mb-3 text-xs text-subtle">A few sentences about you. Offered first when a CV has a summary.</p>
                <Textarea autoGrow
                  rows={4}
                  value={draft.summary ?? ''}
                  onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
                  className="text-sm"
                />
              </section>
              <section>
                <h2 className="text-sm font-semibold">Anything else</h2>
                <p className="mt-1 mb-3 max-w-2xl text-xs text-subtle">
                  Languages, certifications, interests, availability, goals: anything true a CV might use. It is not
                  printed as it is; the AI uses it when tailoring and in chat (&ldquo;add my languages&rdquo;).
                </p>
                <Textarea autoGrow
                  rows={7}
                  value={draft.about}
                  onChange={(e) => setDraft({ ...draft, about: e.target.value })}
                  placeholder={'e.g.\nLanguages: Bangla (native), English (fluent)\nCertifications: AWS Cloud Practitioner (2025)\nInterests: open source, competitive programming\nAvailable from January 2027; open to remote work'}
                  className="text-sm"
                />
              </section>
            </div>
          )}

          {kind && (
            <div className="space-y-3">
              {entriesOf(kind.kind).length === 0 && <p className="text-sm text-subtle">No {kind.label.toLowerCase()} yet.</p>}
              {entriesOf(kind.kind).map((entry, i, list) => (
                <EntryCard
                  key={entry.id}
                  entry={entry}
                  index={i}
                  total={list.length}
                  defaultOpen={fresh.has(entry.id)}
                  onChange={(next) => setEntries((all) => all.map((e) => (e.id === next.id ? next : e)))}
                  onMove={(delta) => move(entry.id, delta)}
                  onDelete={() => setEntries((all) => all.filter((e) => e.id !== entry.id))}
                />
              ))}
              <Button onClick={() => add(kind.kind)}>Add a {kind.one}</Button>
            </div>
          )}

          {tab === 'skills' && (
            <div className="space-y-3">
              {(draft.skills ?? []).length === 0 && <p className="text-sm text-subtle">No skills yet.</p>}
              {(draft.skills ?? []).map((g) => (
                <Panel key={g.id} className="space-y-2 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      value={g.category}
                      placeholder="Group, e.g. Languages"
                      onChange={(e) => setSkills((all) => all.map((x) => (x.id === g.id ? { ...x, category: e.target.value } : x)))}
                      className="max-w-xs text-sm font-medium"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setSkills((all) => all.filter((x) => x.id !== g.id))}>
                      Remove
                    </Button>
                  </div>
                  <Textarea autoGrow
                    rows={2}
                    value={g.skills.join(', ')}
                    placeholder="Comma-separated, e.g. Python, TypeScript, Kotlin"
                    onChange={(e) =>
                      setSkills((all) =>
                        all.map((x) => (x.id === g.id ? { ...x, skills: e.target.value.split(',').map((s) => s.trimStart()) } : x)),
                      )
                    }
                    onBlur={() =>
                      setSkills((all) => all.map((x) => (x.id === g.id ? { ...x, skills: x.skills.map((s) => s.trim()).filter(Boolean) } : x)))
                    }
                    className="text-sm"
                  />
                </Panel>
              ))}
              <Button onClick={() => setSkills((all) => [...all, { id: newId(), category: '', skills: [] }])}>Add a skill group</Button>
            </div>
          )}
        </div>
      </div>

      {dirty && (
        <div className="no-print sticky bottom-4 mt-8 flex justify-center">
          <Panel className="flex items-center gap-3 px-4 py-2 shadow-lg">
            <span className="text-sm text-subtle">You have unsaved changes</span>
            <Button size="sm" variant="primary" onClick={() => void save().catch(() => undefined)} disabled={saving}>
              {saving && <Spinner />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(normalizeProfile(profile))}>
              Discard
            </Button>
          </Panel>
        </div>
      )}
    </div>
  );
}
