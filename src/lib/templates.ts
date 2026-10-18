import type { CareerLibrary, CvDocumentData, DesignSpec, SavedCv, SourceMeta, Store, Template } from '@/types/cv';

/**
 * Templates: other uploaded CVs whose designs CVs can follow instead of the
 * original's. Each keeps its own design, content and files (see Template).
 */

/** Each template's design, content and copy add to the user's stored document; this keeps it well inside its limit. */
export const MAX_TEMPLATES = 8;

export interface DesignContext {
  design: DesignSpec;
  /** What a CV in this design can draw on, before My Info goes over it (withProfile). */
  library: CareerLibrary;
  original: CvDocumentData | null;
  source: SourceMeta | null;
  template: Template | null;
}

/**
 * Everything a CV in one design works with. Every uploaded CV is the owner's
 * and stands on its own: working on one (or tailoring from it) uses its design
 * and its own content (`own`), with My Info over them (withProfile). A CV made
 * in its design that is not that CV itself draws on My Info alone. The first
 * upload is stored apart from the rest (store.design / store.library), but is
 * treated the same.
 */
export function designContext(store: Store, templateId?: string | null, own = true): DesignContext | null {
  const template = templateId ? (store.templates ?? []).find((t) => t.id === templateId) ?? null : null;
  if (!template) {
    if (!store.design || !store.library) return null;
    const library = own ? store.library : { ...store.library, summaryVariants: [], entries: [], skillGroups: [] };
    return { design: store.design, library, original: store.original ?? null, source: store.source, template: null };
  }
  // Borrowed, the design leaves out the header's fixed lines (that CV's motto or tagline).
  const literals = template.design.header.template?.literals;
  const design: DesignSpec =
    own || !literals?.length
      ? template.design
      : { ...template.design, header: { ...template.design.header, template: { ...template.design.header.template!, literals: [] } } };
  const library = own ? template.library : { ...template.library, summaryVariants: [], entries: [], skillGroups: [] };
  return { design, library, original: template.original, source: template.source, template };
}

/**
 * A CV's context. Tailored CVs keep working from the content they were made
 * from (tailoring started from that CV) - so the same as the CV itself.
 */
export const contextOf = (store: Store, cv: SavedCv) => designContext(store, cv.templateId, true) ?? designContext(store, null);
