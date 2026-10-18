'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import CvChat from '@/components/cv/CvChat';
import CvEditor from '@/components/cv/CvEditor';
import CvPreview from '@/components/cv/CvPreview';
import { useReplicaSource } from '@/components/cv/Replica';
import { Badge, Button, ErrorNote, Input, Panel, Spinner, cx } from '@/components/ui/kit';
import { api } from '@/lib/client-api';
import type { CareerLibrary, ChatTurn, CvDocumentData, DesignSpec, SavedCv } from '@/types/cv';

export default function CvPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { refresh, source, originalDocument } = useApp();
  const replica = useReplicaSource();

  const [cv, setCv] = useState<SavedCv | null>(null);
  const [design, setDesign] = useState<DesignSpec | null>(null);
  const [library, setLibrary] = useState<CareerLibrary | null>(null);
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
        setLibrary(res.library);
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

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 rounded-lg bg-foreground/5 p-5">
          <CvPreview
            design={design}
            data={data}
            targetPages={source?.pageCount}
            onPaginated={setPageCount}
            replica={{ source: replica, original: originalDocument }}
          />
        </div>

        {/* Stays in view while the preview scrolls, so chat edits are seen as they land. */}
        <div className="no-print min-w-0 lg:sticky lg:top-20 lg:self-start">
          <div className="flex gap-1 border-b border-line">
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
                {key === 'chat' ? 'Chat' : key === 'content' ? 'Content' : 'Match report'}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {tab === 'chat' ? (
              <CvChat
                cvId={id}
                data={data}
                history={chat}
                pages={{ now: pageCount, original: source?.pageCount }}
                hasJob={Boolean(cv.jobDescription?.trim())}
                onLiveData={setData}
                onTurnComplete={saveTurn}
              />
            ) : tab === 'content' ? (
              <>
                <p className="mb-3 text-xs text-subtle">
                  Pick, drop, reorder and correct. Styling is fixed by your captured design.
                </p>
                <CvEditor design={design} library={library} data={data} onChange={setData} />
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
            Still in your Career Library — add any of these back from the Content tab.
          </p>
        </div>
      )}
    </div>
  );
}
