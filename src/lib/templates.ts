import { norm } from '@/lib/profile';
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
 * Everything a CV in one design works with: the original's, or a template's.
 *
 * A template lends its design, not its content - an uploaded CV may not even
 * be the owner's. So a CV made in a template's design draws on the owner's own
 * material: the original CV's items under the template's sections of the same
 * kind (projects with projects), with My Info over them (withProfile). Only
 * the uploaded CV itself (`own`) also works with what that file said.
 */
export function designContext(store: Store, templateId?: string | null, own = false): DesignContext | null {
  const template = templateId ? (store.templates ?? []).find((t) => t.id === templateId) ?? null : null;
  if (!template) {
    if (!store.design || !store.library) return null;
    return { design: store.design, library: store.library, original: store.original ?? null, source: store.source, template: null };
  }
  // Borrowed, the design leaves out the header's fixed lines (that CV's motto or tagline).
  const literals = template.design.header.template?.literals;
  const design: DesignSpec =
    own || !literals?.length
      ? template.design
      : { ...template.design, header: { ...template.design.header, template: { ...template.design.header.template!, literals: [] } } };
  const main = store.library;
  const base = own ? template.library : { personal: main?.personal ?? template.library.personal, summaryVariants: [], entries: [], skillGroups: [] };
  if (!main || !store.design) return { design, library: base, original: template.original, source: template.source, template };

  const typeOf = new Map(store.design.sections.map((s) => [s.id, s.type]));
  const target = (sectionId: string) => {
    const type = typeOf.get(sectionId);
    return type ? design.sections.find((s) => s.type === type)?.id : undefined;
  };
  const entries = [...base.entries];
  for (const e of main.entries) {
    const sectionId = target(e.sectionId);
    if (!sectionId || entries.some((x) => x.sectionId === sectionId && norm(x.title) === norm(e.title))) continue;
    entries.push({ ...e, id: `o-${e.id}`, sectionId });
  }
  const skillGroups = [...base.skillGroups];
  for (const g of main.skillGroups) {
    const sectionId = target(g.sectionId);
    if (!sectionId || skillGroups.some((x) => norm(x.category) === norm(g.category))) continue;
    skillGroups.push({ ...g, id: `o-${g.id}`, sectionId });
  }
  const summaryVariants = [
    ...base.summaryVariants,
    ...main.summaryVariants.filter((v) => !base.summaryVariants.some((x) => norm(x.text) === norm(v.text))).map((v) => ({ ...v, id: `o-${v.id}` })),
  ];
  return {
    design,
    library: { ...base, entries, skillGroups, summaryVariants },
    original: template.original,
    source: template.source,
    template,
  };
}

export const contextOf = (store: Store, cv: SavedCv) =>
  designContext(store, cv.templateId, Boolean(cv.uploaded)) ?? designContext(store, null);
