import type { CareerLibrary, DesignSpec, Store } from '@/types/cv';

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Stored values win; anything missing comes from the defaults. Arrays are values. */
function deepMerge(defaults: Plain, stored: Plain): Plain {
  const out: Plain = { ...defaults };
  for (const [k, v] of Object.entries(stored)) {
    out[k] = isPlain(v) && isPlain(defaults[k]) ? deepMerge(defaults[k] as Plain, v) : v;
  }
  return out;
}

/**
 * Fills fields added after a store was written. Each default reproduces how
 * the renderer behaved before that field existed, so an old CV looks exactly
 * as it did until the user re-uploads and gets properly measured values.
 */
export function upgradeDesign(stored: unknown): DesignSpec {
  const s = stored as { color: { text: string }; entry: { bulletIndentPt: number; bulletSpacingPt: number }; font: { baseSizePt: number } };
  const legacy = {
    page: { continuationTopPt: 0 },
    font: { textAlign: 'left', embedded: [], useEmbedded: false },
    color: { link: s.color.text },
    header: {
      contactTopPt: 3,
      contactGapPt: null,
      contactOrder: ['email', 'phone', 'location', 'links'],
      contactLabels: { phone: '', email: '', location: '' },
      contactLabelWeight: 700,
    },
    entry: {
      // The old renderer put text at indent + max(8, indent).
      bulletTextIndentPt: s.entry.bulletIndentPt + Math.max(8, s.entry.bulletIndentPt),
      linksPlacement: 'bullet',
      linkSeparator: ' • ',
      linkGapPt: null,
      titleJoiner: ' – ',
      subtitleGapPt: 0,
      bulletsTopPt: 2,
      groupLabel: { weight: 700, underline: true, sizePt: s.font.baseSizePt, spaceBeforePt: 6, spaceAfterPt: 4 },
    },
    skills: { lineGapPt: s.entry.bulletSpacingPt, columns: 2, columnGapPt: 12 },
    aligned: false,
  };
  return deepMerge(legacy, stored as Plain) as unknown as DesignSpec;
}

export function upgradeLibrary(library: CareerLibrary): CareerLibrary {
  return {
    ...library,
    entries: library.entries.map((e) => ({ ...e, links: e.links ?? [] })),
  };
}

export function upgradeStore(store: Store): Store {
  return {
    ...store,
    design: store.design && upgradeDesign(store.design),
    library: store.library && upgradeLibrary(store.library),
  };
}
