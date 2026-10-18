'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EntryCard, PersonalEditor } from '@/components/library/Editors';
import { Button, ErrorNote, Panel, Spinner, Textarea, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import { newId } from '@/lib/id';
import { PROFILE_KINDS, emptyProfile, profileFromLibrary } from '@/lib/profile';
import type { LibraryEntry, Profile, ProfileKind } from '@/types/cv';

type Tab = 'personal' | ProfileKind;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * General information about the owner, apart from any CV: details, and every
 * project, job and achievement, with as many links as they like. Tailoring
 * and the chat pick from it; nothing here is printed as it is.
 */
export default function ProfilePage() {
  const { profile, library, design, refresh } = useApp();
  const [draft, setDraft] = useState<Profile | null>(null);
  const [tab, setTab] = useState<Tab>('personal');
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded during render, once per profile from the server (as the library page does).
  const [seededFrom, setSeededFrom] = useState<Profile | null | undefined>(undefined);
  if (profile !== seededFrom) {
    setSeededFrom(profile);
    if (!draft) setDraft(profile ? structuredClone(profile) : emptyProfile());
  }

  const saved = useMemo(() => JSON.stringify(profile ?? emptyProfile()), [profile]);
  const dirty = Boolean(draft && JSON.stringify(draft) !== saved);
  if (!draft) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile(draft);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  /** Copies in the CV's details (where still blank) and whatever projects, jobs and achievements are not here yet. */
  const fillFromCv = () => {
    if (!library || !design) return;
    const fromCv = profileFromLibrary(library, design);
    const have = new Set(draft.entries.map((e) => `${e.sectionId}:${norm(e.title)}`));
    const added = fromCv.entries.filter((e) => !have.has(`${e.sectionId}:${norm(e.title)}`));
    const p = draft.personal;
    const blank = !p.fullName && !p.email && !p.phone && p.links.length === 0;
    setDraft({ ...draft, personal: blank ? fromCv.personal : p, entries: [...draft.entries, ...added] });
    setFresh(new Set());
  };

  const entriesOf = (kind: ProfileKind) => draft.entries.filter((e) => e.sectionId === kind);
  const setEntries = (fn: (entries: LibraryEntry[]) => LibraryEntry[]) => setDraft({ ...draft, entries: fn(draft.entries) });
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

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
          <p className="mt-1 max-w-2xl text-sm text-subtle">
            Everything about you, apart from any one CV: your details, and every project, job and achievement,
            each with as many links as you like. When you tailor a CV or chat with it, the AI can pick from here.
            Nothing is printed until it is chosen for a CV.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {library && design && <Button onClick={fillFromCv}>Fill from my CV</Button>}
          <Button variant="primary" onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {dirty ? 'Save profile' : 'Saved'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {empty && library && (
        <Panel className="mt-6 p-4 text-sm">
          Start with what your uploaded CV already says: <strong>Fill from my CV</strong> copies your details,
          projects, experience and achievements here. Then add everything that never fit on the page.
        </Panel>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto md:sticky md:top-20 md:flex-col md:self-start md:overflow-visible">
          {([{ key: 'personal' as Tab, label: 'Personal info' }, ...PROFILE_KINDS.map((k) => ({ key: k.kind as Tab, label: k.label }))]).map(
            (t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cx(
                  'flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  tab === t.key ? 'bg-foreground/8 font-medium' : 'text-subtle hover:text-foreground',
                )}
              >
                <span>{t.label}</span>
                {t.key !== 'personal' && (
                  <span className="text-xs tabular-nums opacity-60">{entriesOf(t.key as ProfileKind).length}</span>
                )}
              </button>
            ),
          )}
        </nav>

        <div className="min-w-0">
          {tab === 'personal' && (
            <div className="space-y-8">
              <section>
                <h2 className="mb-3 text-sm font-semibold">Details and links</h2>
                <PersonalEditor personal={draft.personal} onChange={(personal) => setDraft({ ...draft, personal })} />
              </section>
              <section>
                <h2 className="text-sm font-semibold">Everything else about you</h2>
                <p className="mt-1 mb-3 max-w-2xl text-xs text-subtle">
                  Languages, certifications, interests, availability, visa status, goals: anything true a CV might
                  use. The AI uses it for your headline when tailoring, and in the chat (&ldquo;add my languages&rdquo;).
                </p>
                <Textarea
                  rows={9}
                  value={draft.about}
                  onChange={(e) => setDraft({ ...draft, about: e.target.value })}
                  placeholder={'e.g.\nLanguages: Bangla (native), English (fluent)\nCertifications: AWS Cloud Practitioner (2025)\nInterests: open source, competitive programming\nAvailable from January 2027; open to remote work\nLooking for: mobile or AI engineering roles'}
                  className="text-sm"
                />
              </section>
            </div>
          )}

          {kind && (
            <div className="space-y-3">
              {entriesOf(kind.kind).length === 0 && (
                <p className="text-sm text-subtle">No {kind.label.toLowerCase()} yet.</p>
              )}
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
        </div>
      </div>

      {dirty && (
        <div className="no-print sticky bottom-4 mt-8 flex justify-center">
          <Panel className="flex items-center gap-3 px-4 py-2 shadow-lg">
            <span className="text-sm text-subtle">You have unsaved changes</span>
            <Button size="sm" variant="primary" onClick={save} disabled={saving}>
              {saving && <Spinner />} Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(profile ? structuredClone(profile) : emptyProfile())}>
              Discard
            </Button>
          </Panel>
        </div>
      )}
    </div>
  );
}
