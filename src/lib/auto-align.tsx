'use client';

import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import CvPreview from '@/components/cv/CvPreview';
import type { CvDocumentData, DesignSpec, SourceLayout } from '@/types/cv';
import { fitStep, type FitReport } from './align-fit';
import { measureRendered } from './align-measure';

const MAX_ROUNDS = 8;

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Renders the rebuild off-screen at true size, measures it against the
 * original, corrects the spacing and repeats until the error stops shrinking.
 * Returns the best design seen (a later round can overshoot on a CV whose
 * lines wrap differently).
 */
export async function autoAlign(
  start: DesignSpec,
  data: CvDocumentData,
  layout: SourceLayout,
  onProgress?: (round: number, report: FitReport) => void,
): Promise<{ design: DesignSpec; report: FitReport }> {
  const host = document.createElement('div');
  // Wide enough that CvPreview does not scale the page down.
  host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1400px;visibility:hidden;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);

  const render = async (design: DesignSpec) => {
    flushSync(() => root.render(<CvPreview design={design} data={data} />));
    await document.fonts.ready;
    // Pagination re-measures after fonts; give it a few frames to settle.
    for (let i = 0; i < 4; i++) await frame();
  };

  try {
    let design = start;
    let best: { design: DesignSpec; report: FitReport } | null = null;
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      await render(design);
      const { design: next, report } = fitStep(design, layout, measureRendered(host));
      onProgress?.(round, report);
      // The report scores the design that was just rendered, not `next`.
      // Later rounds also carry horizontal fixes the vertical score cannot
      // see, so they win ties.
      if (!best || report.verticalError <= best.report.verticalError + 0.05) best = { design, report };
      // Keep going while anything still changes: a low vertical error alone
      // says nothing about word spacing or margins.
      if (Object.keys(report.changes).length === 0) break;
      design = next;
    }
    return { design: { ...best!.design, aligned: true }, report: best!.report };
  } finally {
    root.unmount();
    host.remove();
  }
}
