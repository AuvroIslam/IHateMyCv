import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { applyTailorPlan } from '@/lib/assemble';
import { newId } from '@/lib/id';
import { TAILOR_SYSTEM, tailorUserPrompt } from '@/lib/prompts';
import { tailorSchema } from '@/lib/schemas';
import { mutateStore, readStore } from '@/lib/store';
import type { SavedCv } from '@/types/cv';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobDescription } = (await request.json()) as { jobDescription?: string };
    const jd = jobDescription?.trim();
    if (!jd) return jsonError('Paste a job description first.');
    if (jd.length < 80) {
      return jsonError('That job description is too short to tailor against. Paste the full posting.');
    }

    const store = await readStore();
    if (!store.library || !store.design) {
      return jsonError('Upload a CV first so there is a Career Library to draw from.', 409);
    }

    const plan = await generateStructured({
      system: TAILOR_SYSTEM,
      user: tailorUserPrompt(store.library, store.design, jd),
      schema: tailorSchema,
      name: 'tailoring_plan',
      // Ranking every component against the posting is the core judgement.
      effort: 'high',
    });

    const { data, report } = applyTailorPlan(store.library, store.design, plan);
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
