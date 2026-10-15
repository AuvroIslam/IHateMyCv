import type { DesignSpec, EmbeddedFace, FontRole, UploadedFont } from '@/types/cv';

/**
 * Decides which embedded font plays which part. A PDF says which font drew
 * each run but not why, so roles come from size: the measured design says the
 * body is 10pt, headings 12pt and the name 25pt, and the font doing most of
 * the drawing at each size gets the role.
 *
 * Sizes matter because LaTeX's Computer Modern ships optical sizes (CMR10 for
 * 10pt, CMR12, CMR17 for large display) whose shapes genuinely differ.
 */
export function assignFaces(fonts: UploadedFont[], design: DesignSpec): EmbeddedFace[] {
  const roles: { role: FontRole; size: number }[] = [
    { role: 'body', size: design.font.baseSizePt },
    { role: 'heading', size: design.sectionHeading.sizePt },
    { role: 'name', size: design.header.nameSizePt },
  ];

  const faces: EmbeddedFace[] = [];
  for (const { role, size } of roles) {
    for (const weight of ['regular', 'bold'] as const) {
      for (const style of ['normal', 'italic'] as const) {
        const best = fonts
          .filter((f) => f.bold === (weight === 'bold') && f.italic === (style === 'italic'))
          .map((f) => ({ f, chars: charsNear(f, size) }))
          .filter((x) => x.chars > 0)
          .sort((a, b) => b.chars - a.chars)[0];
        if (best) faces.push({ id: best.f.id, role, weight, style, source: best.f.name });
      }
    }
  }
  return faces;
}

/** Characters set within half a point of the target size. */
function charsNear(font: UploadedFont, size: number): number {
  return font.usage.filter((u) => Math.abs(u.size - size) <= 0.6).reduce((n, u) => n + u.chars, 0);
}

export const EMBEDDED_FAMILY: Record<FontRole, string> = {
  body: 'cv-embedded-body',
  heading: 'cv-embedded-heading',
  name: 'cv-embedded-name',
};

/** @font-face rules for the faces a design uses. */
export function embeddedFontCss(design: DesignSpec): string {
  if (!design.font.useEmbedded) return '';
  return design.font.embedded
    .map(
      (f) =>
        `@font-face { font-family: "${EMBEDDED_FAMILY[f.role]}"; ` +
        `font-weight: ${f.weight === 'bold' ? '600 900' : '100 599'}; font-style: ${f.style}; ` +
        `font-display: block; src: url("/api/source/fonts/${f.id}"); }`,
    )
    .join('\n');
}

/**
 * Embedded families to put in front of a catalogue stack. A role with no
 * faces of its own borrows from the nearest one (a name set in the heading
 * font, say) before falling back to the catalogue.
 */
export function embeddedPrefix(design: DesignSpec, role: FontRole): string {
  if (!design.font.useEmbedded || design.font.embedded.length === 0) return '';
  const order: Record<FontRole, FontRole[]> = {
    body: ['body'],
    heading: ['heading', 'body'],
    name: ['name', 'heading', 'body'],
  };
  const present = new Set(design.font.embedded.map((f) => f.role));
  const families = order[role].filter((r) => present.has(r)).map((r) => `"${EMBEDDED_FAMILY[r]}"`);
  return families.length ? `${families.join(', ')}, ` : '';
}
