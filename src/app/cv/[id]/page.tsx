'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvChat from '@/components/cv/CvChat';
import CvEditor from '@/components/cv/CvEditor';
import CvPreview from '@/components/cv/CvPreview';
import { useReplicaSource } from '@/components/cv/Replica';
import { Badge, Button, ErrorNote, Input, Panel, Spinner, cx } from '@/components/ui/kit';
import ImportFlow from '@/components/profile/ImportFlow';
import { autoAlign } from '@/lib/auto-align';
import { normalizeProfile, profileFromDocument } from '@/lib/profile';
import { api } from '@/lib/client-api';
import type { ChatTurn, CvDocumentData, DesignSpec, SavedCv, SourceMeta } from '@/types/cv';

export default function CvPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh, source, originalDocument, profile, saveLibrary } = useApp();
  // The design's own upload: the original, or the template this CV follows.
  const [template, setTemplate] = useState<{ id: string; source: SourceMeta; original: CvDocumentData } | null>(null);
  const replica = useReplicaSource(template);
  const original = template ? template.original : originalDocument;
  const pageSource = template ? template.source : source;
  const [fitting, setFitting] = useState(false);
  const [importing, setImporting] = useState(false);

  const [cv, setCv] = useState<SavedCv | null>(null);
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [data, setData] = useState<CvDocumentData | null>(null);
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'chat' | 'content' | 'report'>('chat');
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [pageCount, setPageCount] = useState<number | undefined>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.getCv(id);
        if (cancelled) return;
        setCv(res.cv);
        setDesign(res.design);
        setTemplate(res.template);
        setData(res.cv.data);
        setName(res.cv.name);
        setChat(res.cv.chat ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this CV.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // A design is fitted to its uploaded CV's measured spacing once, the first
  // time a CV in it is opened.
  const fitTried = useRef(false);
  useEffect(() => {
    const fitTo = template ? template.original : originalDocument;
    if (!design || design.aligned || !fitTo || fitTried.current) return;
    fitTried.current = true;
    setFitting(true);
    (async () => {
      try {
        const { layout } = await api.getSourceLayout(template?.id);
        const { design: fitted } = await autoAlign(design, fitTo, layout);
        if (template) await api.saveTemplateDesign(template.id, fitted);
        else await saveLibrary({ design: fitted });
        setDesign(template ? { ...fitted, template: template.id } : fitted);
      } catch {
        // Unfitted, it still works; the exact copy does not depend on it.
      } finally {
        setFitting(false);
      }
    })();
  }, [template, design, originalDocument, saveLibrary]);

  // Asked once per uploaded CV, whatever the answer.
  const markAsked = useCallback(async () => {
    setCv((c) => (c ? { ...c, askedImport: true } : c));
    try {
      await api.saveCv(id, { askedImport: true });
    } catch {
      // Asked again next time, which is harmless.
    }
  }, [id]);

  const dirty = useMemo(
    () => Boolean(cv && data && (JSON.stringify(cv.data) !== JSON.stringify(data) || cv.name !== name)),
    [cv, data, name],
  );

  const save = useCallback(async () => {
    if (!data) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.saveCv(id, { data, name });
      setCv(res.cv);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  }, [data, id, name, refresh]);

  // Chat turns save themselves: the CV as the turn left it, and the conversation.
  const saveTurn = useCallback(
    async (next: CvDocumentData, turns: ChatTurn[]) => {
      setData(next);
      setChat(turns);
      try {
        const res = await api.saveCv(id, { data: next, chat: turns, name });
        setCv(res.cv);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save.');
      }
    },
    [id, name],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-subtle">
        <Spinner className="mr-2" /> Loading CV…
      </div>
    );
  }

  if (error && !cv) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16">
        <ErrorNote>{error}</ErrorNote>
        <Link href="/cvs" className="mt-4 inline-block text-sm underline">
          Back to your CVs
        </Link>
      </div>
    );
  }

  if (!cv || !design || !data) return null;

  const report = cv.report;

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-8">
      <div className="no-print flex flex-wrap items-center gap-3">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-xs font-medium"
        />
        {report && (
          <Badge tone={report.matchScore >= 70 ? 'good' : report.matchScore >= 45 ? 'warn' : 'bad'}>
            {report.matchScore}% match
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button onClick={save} disabled={!dirty || saving}>
            {saving && <Spinner />}
            {dirty ? 'Save' : 'Saved'}
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (dirty) await save();
              window.open(`/cv/${id}/print`, '_blank');
            }}
          >
            Export PDF
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm('Delete this CV? This cannot be undone.')) return;
              await api.deleteCv(id);
              await refresh();
              router.push('/cvs');
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      {error && (
        <div className="no-print mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      )}

      {cv.uploaded && !cv.askedImport && design && (
        <Panel className="no-print mt-4 flex flex-wrap items-center gap-3 border-emerald-500/30 p-4 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Add the information from this CV to My Info?</p>
            <p className="mt-0.5 text-subtle">
              Its jobs, projects and other details become available for tailoring and for adding to other CVs. You
              see every change before anything is saved.
            </p>
          </div>
          <Button variant="primary" onClick={() => setImporting(true)}>
            Yes, review it
          </Button>
          <Button variant="ghost" onClick={() => void markAsked()}>
            No thanks
          </Button>
        </Panel>
      )}
      {importing && design && (
        <ImportFlow
          current={normalizeProfile(profile)}
          start={[{ profile: profileFromDocument(template?.original ?? cv.data, design), from: cv.name }]}
          onApply={async (next) => {
            await api.saveProfile(next);
            await refresh();
          }}
          onDone={() => {
            setImporting(false);
            void markAsked();
          }}
        />
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 rounded-lg bg-foreground/5 p-5">
          {fitting && (
            <p className="no-print mb-3 flex items-center gap-2 text-xs text-subtle">
              <Spinner /> Fitting the design to this CV&apos;s spacing (first time only)…
            </p>
          )}
          <CvPreview
            design={design}
            data={data}
            targetPages={pageSource?.pageCount}
            onPaginated={setPageCount}
            replica={{ source: replica, original }}
          />
        </div>

        {/* Stays in view while the preview scrolls, so chat edits are seen as they land;
            taller than the screen (a long Edit list), it scrolls on its own. */}
        <div className="no-print min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pr-1">
          <div className="flex gap-1 border-b border-line lg:sticky lg:top-0 lg:z-10 lg:bg-background">
            {(['chat', 'content', 'report'] as const).map((key) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cx(
                  '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
                  tab === key
                    ? 'border-foreground font-medium'
                    : 'border-transparent text-subtle hover:text-foreground',
                )}
              >
                {key === 'chat' ? 'Chat' : key === 'content' ? 'Edit' : 'Job match'}
              </button>
            ))}
          </div>

          {/* Capped to the viewport so a long Edit/Job match tab scrolls inside the sticky panel
              instead of running off the bottom of the screen. */}
          <div className="mt-4 lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto lg:pr-1">
            {tab === 'chat' ? (
              <CvChat
                cvId={id}
                data={data}
                history={chat}
                pages={{ now: pageCount, original: pageSource?.pageCount }}
                hasJob={Boolean(cv.jobDescription?.trim())}
                onLiveData={setData}
                onTurnComplete={saveTurn}
              />
            ) : tab === 'content' ? (
              <>
                <p className="mb-3 text-xs text-subtle">
                  Change any text, link or order here. For colours and fonts, ask in Chat.
                </p>
                <CvEditor design={design} myInfo={profile} data={data} onChange={setData} />
              </>
            ) : report ? (
              <MatchReportView report={report} />
            ) : (
              <p className="text-sm text-subtle">
                This CV was not generated from a job description, so there is no match report.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchReportView({ report }: { report: NonNullable<SavedCv['report']> }) {
  const covered = report.keywords.filter((k) => k.covered);
  const missing = report.keywords.filter((k) => !k.covered);

  return (
    <div className="space-y-5 text-sm">
      <Panel className="p-4">
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">Why these picks</p>
        <p className="mt-2 text-subtle">{report.rationale}</p>
      </Panel>

      {report.reworded && report.reworded.length > 0 && (
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Reworded for this job</p>
          <ul className="mt-2 space-y-1">
            {report.reworded.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="text-emerald-600">✓</span>
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-subtle">Facts are unchanged: the words now match the posting. Undo any of it in Edit.</p>
        </div>
      )}

      <div>
        <p className="text-xs font-medium tracking-wide text-subtle uppercase">
          Requirements covered ({covered.length}/{report.keywords.length})
        </p>
        <ul className="mt-2 space-y-1.5">
          {covered.map((k) => (
            <li key={k.keyword} className="flex gap-2">
              <span className="text-emerald-600">✓</span>
              <span>
                {k.keyword}
                {k.evidence && <span className="block text-xs text-subtle">{k.evidence}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {missing.length > 0 && (
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Not evidenced</p>
          <ul className="mt-2 space-y-1">
            {missing.map((k) => (
              <li key={k.keyword} className="flex gap-2 text-subtle">
                <span className="text-amber-600">○</span>
                {k.keyword}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.gaps.length > 0 && (
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">Gaps to address</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-subtle">
            {report.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      )}

      {report.excluded.length > 0 && (
        <div>
          <p className="text-xs font-medium tracking-wide text-subtle uppercase">
            Left out of this CV
          </p>
          <ul className="mt-2 space-y-1 text-subtle">
            {report.excluded.map((item) => (
              <li key={item} className="truncate">
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-subtle">
            Still in My Info — add any of these back from the Edit tab or by asking in Chat.
          </p>
        </div>
      )}
    </div>
  );
}
