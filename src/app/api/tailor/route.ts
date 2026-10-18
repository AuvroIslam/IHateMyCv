import { generateStructured } from '@/lib/ai';
import { handleRouteError, jsonError } from '@/lib/api';
import { applyTailorPlan } from '@/lib/assemble';
import { newId } from '@/lib/id';
import { TAILOR_SYSTEM, tailorUserPrompt } from '@/lib/prompts';
import { tailorSchema } from '@/lib/schemas';
import { withProfile } from '@/lib/profile';
import { REWRITE_SYSTEM, applyRewrite, rewriteSchema, rewriteUserPrompt, rewriteView } from '@/lib/tailor-rewrite';
import { designContext } from '@/lib/templates';
import { mutateStore, readStore } from '@/lib/store';
import type { SavedCv } from '@/types/cv';
import { consume } from '@/lib/limits';

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const { jobDescription, templateId, reword = true } = (await request.json()) as {
      jobDescription?: string;
      templateId?: string | null;
      /** Step two: fit the chosen material's wording to the job. On unless turned off. */
      reword?: boolean;
    };
    const jd = jobDescription?.trim();
    if (!jd) return jsonError('Paste a job description first.');
    if (jd.length < 80) {
      return jsonError('That job description is too short to tailor against. Paste the full posting.');
    }
    if (jd.length > 20_000) return jsonError('That job description is too long. Paste just the posting itself.');

    const store = await readStore();
    // The design to follow: the original's, or a template's (another uploaded CV).
    const ctx = designContext(store, templateId);
    if (!ctx) return jsonError(templateId ? 'That CV design no longer exists.' : 'Upload a CV first.', templateId ? 404 : 409);
    await consume('tailor');

    // My Info's projects, jobs and achievements are candidates too.
    const { library, facts } = withProfile(ctx.library, ctx.design, store.profile);
    const plan = await generateStructured({
      system: TAILOR_SYSTEM,
      user: tailorUserPrompt(library, ctx.design, jd, facts),
      schema: tailorSchema,
      name: 'tailoring_plan',
      // Medium: on Claude Sonnet it ranks as well as Opus did (6 jobs across
      // 4 CVs) in the same ~12s as low effort, for about $0.04 a CV.
      effort: 'medium',
    });

    const { data, report } = applyTailorPlan(library, ctx.design, plan);

    if (reword) {
      // Rewording is a refinement: if it fails, the chosen material stands as written.
      try {
        const view = rewriteView(data, ctx.design);
        const result = await generateStructured({
          system: REWRITE_SYSTEM,
          user: rewriteUserPrompt(view.text, jd, facts),
          schema: rewriteSchema,
          name: 'tailor_rewrite',
          effort: 'medium',
        });
        report.reworded = applyRewrite(data, ctx.design, view.refs, result);
      } catch (err) {
        console.error('Rewording for the job failed; keeping the original wording:', err);
      }
    }
    const now = new Date().toISOString();

    const cv: SavedCv = {
      id: newId(),
      name: [report.roleTitle, report.company].filter(Boolean).join(' at ') || 'Tailored CV',
      jobTitle: report.roleTitle,
      company: report.company,
      jobDescription: jd,
      ...(ctx.template ? { templateId: ctx.template.id } : {}),
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
