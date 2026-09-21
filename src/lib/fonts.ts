/**
 * A closed set of font choices the extractor may pick from.
 *
 * Letting the model emit arbitrary CSS font stacks produces stacks the browser
 * silently falls back on, which is exactly the kind of drift that breaks the
 * "design must not change" guarantee. Instead it picks a key, and we own the
 * stack plus the webfont that backs it.
 *
 * Several entries are metric-compatible clones (Tinos->Times New Roman,
 * Arimo->Arial, Carlito->Calibri), so line breaks land where they did in the
 * original even on machines without the licensed font installed.
 */
export interface FontChoice {
  key: string;
  label: string;
  /** What the original CV most likely used. Shown to the model for matching. */
  matches: string;
  stack: string;
  /** Google Fonts family spec, or null for system fonts. */
  google: string | null;
  serif: boolean;
}

export const FONT_CHOICES: FontChoice[] = [
  {
    key: 'times',
    label: 'Times / Latin Modern',
    matches: 'Times New Roman, Times, Liberation Serif, Nimbus Roman, LaTeX default (Computer/Latin Modern Roman)',
    stack: "'Tinos', 'Times New Roman', Times, serif",
    google: 'Tinos:ital,wght@0,400;0,700;1,400;1,700',
    serif: true,
  },
  {
    key: 'garamond',
    label: 'Garamond',
    matches: 'EB Garamond, Garamond, Adobe Garamond, Cormorant',
    stack: "'EB Garamond', Garamond, 'Times New Roman', serif",
    google: 'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400',
    serif: true,
  },
  {
    key: 'georgia',
    label: 'Georgia',
    matches: 'Georgia, Gelasio, Charter, Bitstream Charter',
    stack: "'Gelasio', Georgia, 'Times New Roman', serif",
    google: 'Gelasio:ital,wght@0,400;0,600;0,700;1,400',
    serif: true,
  },
  {
    key: 'source-serif',
    label: 'Source Serif',
    matches: 'Source Serif Pro, Noto Serif, PT Serif, modern transitional serifs',
    stack: "'Source Serif 4', 'Source Serif Pro', Georgia, serif",
    google: 'Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400',
    serif: true,
  },
  {
    key: 'merriweather',
    label: 'Merriweather',
    matches: 'Merriweather, heavy slab-ish book serif',
    stack: "'Merriweather', Georgia, serif",
    google: 'Merriweather:ital,wght@0,400;0,700;1,400',
    serif: true,
  },
  {
    key: 'libre-baskerville',
    label: 'Libre Baskerville',
    matches: 'Baskerville, Libre Baskerville, Playfair-adjacent high-contrast serif',
    stack: "'Libre Baskerville', Baskerville, Georgia, serif",
    google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400',
    serif: true,
  },
  {
    key: 'arial',
    label: 'Arial / Helvetica',
    matches: 'Arial, Helvetica, Helvetica Neue, Liberation Sans, Nimbus Sans',
    stack: "'Arimo', Arial, Helvetica, sans-serif",
    google: 'Arimo:ital,wght@0,400;0,600;0,700;1,400;1,700',
    serif: false,
  },
  {
    key: 'calibri',
    label: 'Calibri',
    matches: 'Calibri, Carlito, default Microsoft Word body font',
    stack: "'Carlito', Calibri, 'Segoe UI', sans-serif",
    google: 'Carlito:ital,wght@0,400;0,700;1,400;1,700',
    serif: false,
  },
  {
    key: 'lato',
    label: 'Lato',
    matches: 'Lato, Segoe UI, humanist sans',
    stack: "'Lato', 'Segoe UI', sans-serif",
    google: 'Lato:ital,wght@0,400;0,700;0,900;1,400',
    serif: false,
  },
  {
    key: 'open-sans',
    label: 'Open Sans',
    matches: 'Open Sans, Noto Sans, PT Sans',
    stack: "'Open Sans', 'Segoe UI', sans-serif",
    google: 'Open+Sans:ital,wght@0,400;0,600;0,700;1,400',
    serif: false,
  },
  {
    key: 'roboto',
    label: 'Roboto',
    matches: 'Roboto, Android/Material default sans',
    stack: "'Roboto', 'Helvetica Neue', sans-serif",
    google: 'Roboto:ital,wght@0,400;0,500;0,700;1,400',
    serif: false,
  },
  {
    key: 'source-sans',
    label: 'Source Sans',
    matches: 'Source Sans Pro, Source Sans 3',
    stack: "'Source Sans 3', 'Source Sans Pro', sans-serif",
    google: 'Source+Sans+3:ital,wght@0,400;0,600;0,700;1,400',
    serif: false,
  },
  {
    key: 'inter',
    label: 'Inter',
    matches: 'Inter, SF Pro, modern geometric-neutral UI sans',
    stack: "'Inter', -apple-system, 'Segoe UI', sans-serif",
    google: 'Inter:ital,wght@0,400;0,500;0,600;0,700;1,400',
    serif: false,
  },
  {
    key: 'montserrat',
    label: 'Montserrat',
    matches: 'Montserrat, Gotham, Proxima Nova, wide geometric sans',
    stack: "'Montserrat', 'Helvetica Neue', sans-serif",
    google: 'Montserrat:ital,wght@0,400;0,600;0,700;1,400',
    serif: false,
  },
  {
    key: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    matches: 'IBM Plex Sans, technical/engineering sans',
    stack: "'IBM Plex Sans', 'Segoe UI', sans-serif",
    google: 'IBM+Plex+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400',
    serif: false,
  },
  {
    key: 'nunito-sans',
    label: 'Nunito Sans',
    matches: 'Nunito Sans, rounded friendly sans',
    stack: "'Nunito Sans', 'Segoe UI', sans-serif",
    google: 'Nunito+Sans:ital,wght@0,400;0,600;0,700;1,400',
    serif: false,
  },
];

export const FONT_KEYS = FONT_CHOICES.map((f) => f.key) as [string, ...string[]];

const BY_KEY = new Map(FONT_CHOICES.map((f) => [f.key, f]));

export function fontStack(key: string | undefined): string {
  return BY_KEY.get(key ?? '')?.stack ?? FONT_CHOICES[0].stack;
}

export function fontChoice(key: string | undefined): FontChoice {
  return BY_KEY.get(key ?? '') ?? FONT_CHOICES[0];
}

/** Google Fonts stylesheet URL covering the families a design actually uses. */
export function googleFontsUrl(...keys: (string | undefined)[]): string | null {
  const specs = Array.from(
    new Set(
      keys
        .map((k) => BY_KEY.get(k ?? '')?.google)
        .filter((g): g is string => Boolean(g)),
    ),
  );
  if (specs.length === 0) return null;
  return `https://fonts.googleapis.com/css2?${specs.map((s) => `family=${s}`).join('&')}&display=swap`;
}

/** Compact catalogue injected into the extraction prompt. */
export function fontCatalogueForPrompt(): string {
  return FONT_CHOICES.map((f) => `- ${f.key} (${f.serif ? 'serif' : 'sans'}): matches ${f.matches}`).join('\n');
}
