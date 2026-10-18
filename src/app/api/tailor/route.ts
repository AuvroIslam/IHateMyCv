import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { applyTailorPlan } from '@/lib/assemble';
import { newId } from '@/lib/id';
import { TAILOR_SYSTEM, tailorUserPrompt } from '@/lib/prompts';
import { tailorSchema } from '@/lib/schemas';
import { withProfile } from '@/lib/profile';
import { mutateStore, readStore } from '@/lib/store';
import type { SavedCv } from '@/types/cv';
import { consume } from '@/lib/limits';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobDescription } = (await request.json()) as { jobDescription?: string };
    const jd = jobDescription?.trim();
    if (!jd) return jsonError('Paste a job description first.');
    if (jd.length < 80) {
      return jsonError('That job description is too short to tailor against. Paste the full posting.');
    }
    if (jd.length > 20_000) return jsonError('That job description is too long. Paste just the posting itself.');

    const store = await readStore();
    if (!store.library || !store.design) {
      return jsonError('Upload a CV first so there is a Career Library to draw from.', 409);
    }
    await consume('tailor');

    // The Profile's projects, jobs and achievements are candidates too.
    const { library, facts } = withProfile(store.library, store.design, store.profile);
    const plan = await generateStructured({
      system: TAILOR_SYSTEM,
      user: tailorUserPrompt(library, store.design, jd, facts),
      schema: tailorSchema,
      name: 'tailoring_plan',
      // Medium: on Claude Sonnet it ranks as well as Opus did (6 jobs across
      // 4 CVs) in the same ~12s as low effort, for about $0.04 a CV.
      effort: 'medium',
    });

    const { data, report } = applyTailorPlan(library, store.design, plan);
    const now = new Date().toISOString();

    const cv: SavedCv = {
      id: newId(),
      name: [report.roleTitle, report.company].filter(Boolean).join(' at ') || 'Tailored CV',
      jobTitle: report.roleTitle,
      company: report.company,
      jobDescription: jd,
      createdAt: now,
      updatedAt: now,
      data,
      report,
    };

    await mutateStore((s) => {
      s.cvs.unshift(cv);
    });

    return Response.json({ cv });
  } catch (err) {
    return handleRouteError(err);
  }
}
