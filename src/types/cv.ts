// Core domain model for I Hate My CV.
//
// The central idea: a CV is (DesignSpec x CvDocumentData). The DesignSpec is
// captured once from the user's original CV and never changes. Tailoring only
// ever produces new CvDocumentData, so the look of every generated CV is
// byte-for-byte the same as the original.

export type SectionType =
  | 'summary'
  | 'education'
  | 'experience'
  | 'projects'
  | 'skills'
  | 'achievements'
  | 'extra';

/** A section as it appeared in the original CV, in its original order. */
export interface SectionDef {
  id: string;
  /** Heading text copied verbatim from the original ("WORK EXPERIENCE", "Employment"). */
  title: string;
  type: SectionType;
  column: 'main' | 'side';
  /**
   * How much the original CV put in this section. The library grows over time
   * but the page does not, so tailoring is held to these numbers rather than
   * to whatever the library currently holds. Absent on older stores.
   */
  baseline?: SectionBaseline;
  /**
   * This section's entry layout when it differs from design.entry.layout:
   * a CV may print "Company – Role" in Experience but title-then-detail in
   * Awards.
   */
  entryLayout?: DesignSpec['entry']['layout'];
  /** This section's joiner for one-line headings, when it differs (" - " vs " – "). */
  titleJoiner?: string;
  /**
   * Gaps fitted for this section alone. LaTeX's spacing depends on context
   * (after a links row vs after a bullet list), so one design-wide value
   * cannot match every section. Unset values fall back to design.entry.
   */
  spacing?: SectionSpacing;
  /** How this section's entry headings are arranged, read from the PDF. */
  heading?: HeadingTemplate;
  /**
   * Consecutive roles at one organisation print the organisation once: an
   * entry whose first heading row repeats the previous entry's leaves it out.
   */
  mergeRepeats?: boolean;
  /** Items numbered rather than bulleted: 1, 2, 3 or counting down to 1. */
  numbered?: 'asc' | 'desc';
  /** Entry links print on their own line after the bullets (a DOI under the authors). */
  linksAfter?: boolean;
  /** This section's text alignment when it differs from the design's (a justified summary over ragged bullets). */
  textAlign?: 'left' | 'justify';
}

export type HeadingField = 'title' | 'subtitle' | 'location' | 'date' | 'note';
export type PartStyle = 'normal' | 'bold' | 'italic' | 'bold-italic';

export interface HeadingPart<F extends string = HeadingField> {
  field: F;
  /** Printed between the previous part and this one (", ", " – "). Dropped when either is missing. */
  joiner: string;
  /** A wide blank gap before this part, in pt - where an icon stood, or a tab. */
  gapPt?: number;
  /** The size the original printed this part at. */
  sizePt?: number;
  style: PartStyle;
}

/**
 * An entry heading as rows of fields, each row split into a left run and a
 * right-aligned run. "**Nexus AI**, Co-Founder & CTO ... San Francisco" over
 * "... June 2023 – present" is one template; "Ostad – Teaching Assistant ...
 * Aug 2025" over "Remote" is another. Read per section from the original.
 */
/** How links are printed, read from the PDF: bold, underlined, and in what colour. */
export interface LinkLook {
  bold?: boolean;
  underline?: boolean;
  color?: string;
}

export interface HeadingTemplate {
  rows: { left: HeadingPart[]; right: HeadingPart[] }[];
  /** Fields printed in the layout's left gutter beside the first row (a date). */
  gutter?: HeadingPart[];
}

export type HeaderField =
  | 'name'
  | 'headline'
  | 'email'
  | 'phone'
  | 'location'
  | `link:${number}`
  | `text:${number}`;

/** The header the same way: rows of personal fields, placed left, centre or right. */
export interface HeaderTemplate {
  rows: {
    left: HeadingPart<HeaderField>[];
    center: HeadingPart<HeaderField>[];
    right: HeadingPart<HeaderField>[];
    /** Extra space above this row, fitted to the original (a motto set apart). */
    topPt?: number;
  }[];
  /**
   * Header lines that are no personal field - a motto, a tagline - printed
   * verbatim. Referenced by `text:<index>`.
   */
  literals?: string[];
}

export interface SectionSpacing {
  /** Space above this section's heading. */
  headingTopPt?: number;
  /** With a rule above the heading: its distance above the heading's baseline. */
  ruleGapPt?: number;
  /** How far this section's entries sit right of its heading. */
  entryIndentPt?: number;
  entryGapPt?: number;
  bulletsTopPt?: number;
  subtitleGapPt?: number;
  bulletGapPt?: number;
}

export interface SectionBaseline {
  entries: number;
  /** The most bullets any single entry had. */
  maxBullets: number;
  /** Total skills across all groups, for skills sections. */
  skills: number;
}

// ---------------------------------------------------------------------------
// Design
// ---------------------------------------------------------------------------

export type ContactKind = 'phone' | 'email' | 'location' | 'links';

/** Where on the CV an embedded font is used, found from the sizes it was set at. */
export type FontRole = 'body' | 'heading' | 'name';

export interface EmbeddedFace {
  /** File id under /api/source/fonts. */
  id: string;
  role: FontRole;
  weight: 'regular' | 'bold';
  style: 'normal' | 'italic';
  /** The font's name inside the PDF, e.g. "CMBX10". Shown, never rendered. */
  source: string;
}

/** An embedded font as sent from the browser at upload. */
export interface UploadedFont {
  id: string;
  name: string;
  bold: boolean;
  italic: boolean;
  /** 'otf' for CFF outlines, 'ttf' for TrueType. */
  format: 'otf' | 'ttf';
  /** Base64 of the Unicode-remapped font file. */
  data: string;
  /** Characters drawn in this font, by point size (rounded to 0.1). */
  usage: { size: number; chars: number }[];
}

export interface DesignSpec {
  page: {
    size: 'a4' | 'letter';
    /** Margins in millimetres. */
    marginTop: number;
    marginRight: number;
    marginBottom: number;
    marginLeft: number;
    /**
     * Extra space above the first line of every page after the first. TeX
     * places a continuation page's first baseline by its own rule (topskip),
     * not by the line's ascent as CSS does. Fitted by auto-align.
     */
    continuationTopPt: number;
  };
  font: {
    bodyFamily: string;
    headingFamily: string;
    baseSizePt: number;
    lineHeight: number;
    /**
     * Added to every word space. TeX fonts carry no space glyph - TeX places
     * words itself - so the browser borrows a space from a fallback font;
     * auto-align corrects the difference. Optional on older designs.
     */
    wordSpacingPt?: number;
    /**
     * Added between letters of body text. Fonts extracted from a PDF lose
     * their kerning, so set text runs a touch wider than the original;
     * auto-align fits this to take that back out. Optional on older designs.
     */
    letterSpacingEm?: number;
    /** Summary and bullet paragraphs. `justify` also hyphenates, as LaTeX does. */
    textAlign: 'left' | 'justify';
    /**
     * The original PDF's own fonts, extracted at upload. When used they come
     * first in every font stack; the catalogue family above stays behind them
     * for characters the embedded subset does not contain.
     */
    embedded: EmbeddedFace[];
    useEmbedded: boolean;
  };
  color: {
    text: string;
    heading: string;
    accent: string;
    muted: string;
    rule: string;
    /** Clickable text: contact links, email, entry links. */
    link: string;
  };
  header: {
    /** Gap between the name and the contact line. */
    contactTopPt: number;
    /** Arrangement read from the original; when set it replaces align/contactLayout/contactOrder. */
    template?: HeaderTemplate;
    /**
     * Space on each side of the separator glyph. LaTeX sets these gaps as
     * measured space (\quad), which no run of space characters reproduces.
     * Null keeps contactSeparator's own spaces.
     */
    contactGapPt: number | null;
    /** Order the contact items are printed in. */
    contactOrder: ContactKind[];
    /** Printed before each value, e.g. "Phone:". Empty for none. */
    contactLabels: { phone: string; email: string; location: string };
    contactLabelWeight: number;
    /** How the header's links (LinkedIn, GitHub) are printed. */
    linkLook?: LinkLook;
    align: 'left' | 'center';
    nameSizePt: number;
    nameWeight: number;
    nameTransform: 'none' | 'uppercase';
    nameLetterSpacingEm: number;
    nameColor: string;
    headlineShown: boolean;
    headlineSizePt: number;
    headlineStyle: 'normal' | 'italic';
    contactSizePt: number;
    contactSeparator: string;
    contactLayout: 'inline' | 'stacked' | 'two-line';
    ruleBelow: boolean;
    spaceBelowPt: number;
  };
  sectionHeading: {
    sizePt: number;
    weight: number;
    transform: 'none' | 'uppercase' | 'capitalize';
    letterSpacingEm: number;
    align: 'left' | 'center';
    /** `rule-before`: a full-width rule above the heading, `ruleGapPt` above its baseline. */
    style: 'plain' | 'underline' | 'rule-after' | 'rule-before' | 'filled-bar';
    ruleGapPt?: number;
    color: string;
    spaceBeforePt: number;
    spaceAfterPt: number;
    rulePt: number;
  };
  entry: {
    titleSizePt: number;
    titleWeight: number;
    subtitleStyle: 'normal' | 'italic' | 'bold';
    subtitleSizePt: number;
    dateAlign: 'right' | 'inline';
    dateStyle: 'normal' | 'italic';
    dateSizePt: number;
    /**
     * `org-title` prints "Subtitle – Title" as one bold line (company first)
     * with the date right, and the location on the line below; `title-org`
     * is the same with the title first ("Hackathon - Organiser").
     */
    layout: 'title-left-date-right' | 'title-then-subtitle' | 'compact' | 'org-title' | 'title-org';
    /** Joins subtitle and title in the `org-title` layout, e.g. " – ". */
    titleJoiner: string;
    /** Gap between the title row and the row below it. */
    subtitleGapPt: number;
    /** Gap between an entry's heading rows and its first bullet. */
    bulletsTopPt: number;
    /** Entries indented under their section heading (some templates nest them in a list). */
    indentPt?: number;
    bulletChar: string;
    /** Left margin to the bullet glyph. */
    bulletIndentPt: number;
    /** Left margin to the start of the bullet's text (the hanging indent). */
    bulletTextIndentPt: number;
    bulletSizePt: number;
    bulletSpacingPt: number;
    spacingPt: number;
    /**
     * Where an entry's links go: as a final bullet row, on the title line, or
     * on their own unbulleted line under the heading.
     */
    linksPlacement: 'bullet' | 'title-line' | 'own-line';
    /** With `bullet` placement: one bullet per link ("• Github" / "• Live Link") rather than one row of all. */
    linkEach?: boolean;
    /** How entry links ("Github", "Live Link") are printed. */
    linkLook?: LinkLook;
    linkSeparator: string;
    /** Like contactGapPt, for the separator between an entry's links. */
    linkGapPt: number | null;
    /** Sub-headings inside a section, e.g. "National" / "International". */
    groupLabel: {
      weight: number;
      underline: boolean;
      sizePt: number;
      spaceBeforePt: number;
      spaceAfterPt: number;
    };
  };
  skills: {
    /**
     * `columns`: a grid of category blocks, heading line then items.
     * `table`: categories in a column of their own, items at a tab stop.
     */
    layout: 'inline-categories' | 'bullets' | 'comma-list' | 'pills' | 'columns' | 'table';
    /** `table`: where the items start, in pt from the section's left edge. */
    itemsAtPt?: number;
    /** `table`: categories set flush right against the items, or flush left. */
    categoryAlign?: 'left' | 'right';
    /** `table`: space between the widest category and the items. */
    categoryGapPt?: number;
    categoryWeight: number;
    separator: string;
    /** Gap between skill lines (or grid rows). */
    lineGapPt: number;
    columns: number;
    columnGapPt: number;
  };
  layout: {
    type: 'single' | 'two-column';
    sideColumn: 'left' | 'right';
    sideWidthPct: number;
    /**
     * A left gutter beside every section (moderncv): headings and entries
     * start this far right of the margin, and dates sit right-aligned in it.
     */
    gutterPt?: number;
    /** Space between the gutter's right-aligned text and the content. */
    gutterGapPt?: number;
  };
  sections: SectionDef[];
  /** Set once spacing has been fitted to the original's measured positions. */
  aligned: boolean;
}

// ---------------------------------------------------------------------------
// The original PDF's geometry, kept for auto-alignment

/** A run of text as the PDF placed it. Points, top-left origin, y = baseline. */
export interface SourceRun {
  x: number;
  xEnd: number;
  text: string;
  /** From the font name; absent on layouts captured before it was recorded. */
  bold?: boolean;
  italic?: boolean;
  /** Font size, when it differs from the line's (a smaller date beside a title). */
  size?: number;
  /** Baseline, when it differs from the line's (a raised superscript). */
  y?: number;
  /** The embedded font (UploadedFont id) that drew it. */
  face?: string;
  /** Fill colour, when not black. */
  color?: string;
  /** A bullet the PDF drew as a shape, stood in for by "•"; the page background has the dot. */
  drawn?: boolean;
}

export interface SourceLine {
  x: number;
  xEnd: number;
  y: number;
  size: number;
  text: string;
  runs: SourceRun[];
  /**
   * Two-column pages only: 0 for the header above the columns, 1 for the
   * left column, 2 for the right. Lines sort by it before their baseline.
   */
  col?: number;
}

export interface SourceLayout {
  pages: {
    width: number;
    height: number;
    lines: SourceLine[];
    /** Horizontal rules drawn on the page, in points from the top-left. */
    rules?: { x0: number; x1: number; y: number; thickness: number; color?: string }[];
  }[];
}

// ---------------------------------------------------------------------------
// Career Library
// ---------------------------------------------------------------------------

export interface ContactLink {
  id: string;
  label: string;
  value: string;
  href?: string;
}

export interface PersonalInfo {
  fullName: string;
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  links: ContactLink[];
}

/** A labelled link on an entry, e.g. "Github" -> the repo, "Live Link" -> the demo. */
export interface EntryLink {
  label: string;
  url: string;
}

/**
 * A paragraph's line breaks as the original printed them. Reused only while
 * the text is unchanged, so edited text simply reflows. See lib/line-lock.
 */
export interface LockedLines {
  lines: string[];
  /** Between each pair of lines: a space, nothing ("K-" + "dramas"), or a soft hyphen. */
  glue: (' ' | '' | 'soft')[];
}

/** Per-bullet print details carried from the original. */
export interface BulletPrint {
  lines?: LockedLines;
  /** Printed as a plain line, without a bullet glyph. */
  plain?: boolean;
  /** A bold lead-in the original printed ("TensorFlow:", "Current CGPA:"). */
  boldPrefix?: string;
  /** A table row ("2014 | top 52/2500 | KPCB Fellow"): the text split into cells... */
  cells?: string[];
  /** ...and where each cell starts, in pt from the row's start. */
  tabs?: number[];
}

export interface LibraryBullet {
  id: string;
  text: string;
  lines?: LockedLines;
  plain?: boolean;
  boldPrefix?: string;
  cells?: string[];
  tabs?: number[];
  /** Keywords used to match this bullet against a job description. */
  tags: string[];
}

/**
 * One reusable CV component: a job, a project, a degree, an award, or an entry
 * in a custom section. Everything shares this shape so the renderer and the
 * tailoring engine only need to understand one kind of thing.
 */
export interface LibraryEntry {
  id: string;
  /** The design-spec section this entry belongs under. */
  sectionId: string;
  title: string;
  subtitle?: string;
  location?: string;
  /** Verbatim date string from the original CV, e.g. "Jun 2023 - Aug 2023". */
  dateText?: string;
  /** A short extra printed on a heading row ("GPA: 3.5" beside the degree). */
  note?: string;
  /** ISO-ish YYYY-MM used only for chronological sorting. */
  sortDate?: string;
  /** Makes the title itself clickable. */
  link?: string;
  links: EntryLink[];
  /** Sub-heading this entry sits under within its section, e.g. "National". */
  group?: string;
  bullets: LibraryBullet[];
  tags: string[];
  /** Kept in the library but never auto-selected. */
  archived: boolean;
}

export interface SkillGroup {
  id: string;
  sectionId: string;
  category: string;
  skills: string[];
  /** Printed one item per bullet rather than as one comma-separated line. */
  list?: boolean;
  /** The category on a line of its own, then one line per item. */
  stacked?: boolean;
  archived: boolean;
}

export interface SummaryVariant {
  id: string;
  label: string;
  text: string;
  lines?: LockedLines;
  /** Each paragraph's original line breaks, for a summary of several paragraphs. */
  paragraphs?: (LockedLines | null)[];
}

export interface CareerLibrary {
  personal: PersonalInfo;
  summaryVariants: SummaryVariant[];
  entries: LibraryEntry[];
  skillGroups: SkillGroup[];
}

// ---------------------------------------------------------------------------
// A rendered CV (denormalised so manual edits survive library changes)
// ---------------------------------------------------------------------------

export interface RenderedEntry {
  /** Back-reference to the library entry, if it came from one. */
  entryId?: string;
  title: string;
  subtitle?: string;
  location?: string;
  dateText?: string;
  note?: string;
  link?: string;
  /** Optional on CVs saved before entry links existed. */
  links?: EntryLink[];
  group?: string;
  bullets: string[];
  /** Keyed by bullet text, so reordering or deleting bullets never misattributes it. */
  bulletPrint?: Record<string, BulletPrint>;
}

export interface RenderedSkillGroup {
  groupId?: string;
  category: string;
  skills: string[];
  list?: boolean;
  stacked?: boolean;
}

export interface RenderedSection {
  sectionId: string;
  /** Overrides the design-spec title only if the user renames it manually. */
  title?: string;
  entries: RenderedEntry[];
  skillGroups: RenderedSkillGroup[];
  summary?: string;
  summaryLines?: LockedLines;
  summaryParagraphs?: (LockedLines | null)[];
  hidden?: boolean;
}

export interface CvDocumentData {
  personal: PersonalInfo;
  sections: RenderedSection[];
  /** This CV's own colours, over the shared design. Set from the chat. */
  style?: CvStyle;
}

/** A CSS colour: #rgb / #rrggbb, or a plain colour name. */
export type CssColor = string;

/** The look one CV sets for itself; anything unset keeps the shared design's. */
export interface CvStyle {
  colors?: {
    name?: CssColor;
    headings?: CssColor;
    /** Entry titles ("Nongor", "Ostad – Teaching Assistant"). */
    titles?: CssColor;
    text?: CssColor;
    links?: CssColor;
    rules?: CssColor;
    accent?: CssColor;
  };
  /** Per section, by section id. */
  sections?: Record<string, { headings?: CssColor; titles?: CssColor; text?: CssColor }>;
  /** Design properties set for this CV, by path (see DESIGN_PROPS in cv-style.ts). */
  design?: Record<string, string | number>;
}

// ---------------------------------------------------------------------------
// Tailoring
// ---------------------------------------------------------------------------

export interface KeywordMatch {
  keyword: string;
  covered: boolean;
  evidence?: string;
}

export interface MatchReport {
  roleTitle?: string;
  company?: string;
  /** 0-100. */
  matchScore: number;
  keywords: KeywordMatch[];
  included: string[];
  excluded: string[];
  gaps: string[];
  rationale: string;
}

/** One message in a CV's editing chat. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  /** What the assistant changed, one line per edit. */
  changes?: string[];
  /**
   * On a user message: the CV just before it was sent, so the chat can rewind
   * to that point. Kept on the latest few messages only (see REWIND_POINTS).
   */
  before?: CvDocumentData;
}

export interface SavedCv {
  id: string;
  name: string;
  jobTitle?: string;
  company?: string;
  jobDescription: string;
  createdAt: string;
  updatedAt: string;
  data: CvDocumentData;
  report: MatchReport | null;
  /** The editing chat, kept with the CV. */
  chat?: ChatTurn[];
}

export interface SourceMeta {
  fileName: string;
  uploadedAt: string;
  pageCount: number;
  textPreview: string;
  /** Number of original page renders kept on disk for design comparison. */
  pageImages?: number;
  /** How many text-free page backgrounds were kept for the exact replica. */
  backgrounds?: number;
}

export interface Store {
  version: number;
  library: CareerLibrary | null;
  design: DesignSpec | null;
  source: SourceMeta | null;
  /** The original CV's content exactly as extracted, for side-by-side checks. */
  original?: CvDocumentData | null;
  cvs: SavedCv[];
}

// ---------------------------------------------------------------------------
// Shared server <-> client payloads
// ---------------------------------------------------------------------------

export interface CvSummary {
  id: string;
  name: string;
  jobTitle?: string;
  company?: string;
  createdAt: string;
  updatedAt: string;
  matchScore: number | null;
}

/** Everything the app shell needs to render. */
export interface AppStateResponse {
  library: CareerLibrary | null;
  design: DesignSpec | null;
  source: SourceMeta | null;
  hasApiKey: boolean;
  /** The signed-in account, when this install uses sign-in. */
  account?: { email?: string; name?: string } | null;
  /** True when this install requires sign-in (Firebase). */
  signIn?: boolean;
  baseDocument: CvDocumentData | null;
  /** The original CV's content, falling back to baseDocument on older stores. */
  originalDocument: CvDocumentData | null;
  cvs: CvSummary[];
}
