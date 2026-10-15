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
  };
  font: {
    bodyFamily: string;
    headingFamily: string;
    baseSizePt: number;
    lineHeight: number;
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
    style: 'plain' | 'underline' | 'rule-after' | 'filled-bar';
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
     * with the date right, and the location on the line below.
     */
    layout: 'title-left-date-right' | 'title-then-subtitle' | 'compact' | 'org-title';
    /** Joins subtitle and title in the `org-title` layout, e.g. " – ". */
    titleJoiner: string;
    /** Gap between the title row and the row below it. */
    subtitleGapPt: number;
    /** Gap between an entry's heading rows and its first bullet. */
    bulletsTopPt: number;
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
    /** `columns`: a grid of category blocks, heading line then items. */
    layout: 'inline-categories' | 'bullets' | 'comma-list' | 'pills' | 'columns';
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
}

export interface SourceLine {
  x: number;
  xEnd: number;
  y: number;
  size: number;
  text: string;
  runs: SourceRun[];
}

export interface SourceLayout {
  pages: { width: number; height: number; lines: SourceLine[] }[];
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

export interface LibraryBullet {
  id: string;
  text: string;
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
  archived: boolean;
}

export interface SummaryVariant {
  id: string;
  label: string;
  text: string;
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
  link?: string;
  /** Optional on CVs saved before entry links existed. */
  links?: EntryLink[];
  group?: string;
  bullets: string[];
}

export interface RenderedSkillGroup {
  groupId?: string;
  category: string;
  skills: string[];
  list?: boolean;
}

export interface RenderedSection {
  sectionId: string;
  /** Overrides the design-spec title only if the user renames it manually. */
  title?: string;
  entries: RenderedEntry[];
  skillGroups: RenderedSkillGroup[];
  summary?: string;
  hidden?: boolean;
}

export interface CvDocumentData {
  personal: PersonalInfo;
  sections: RenderedSection[];
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
}

export interface SourceMeta {
  fileName: string;
  uploadedAt: string;
  pageCount: number;
  textPreview: string;
  /** Number of original page renders kept on disk for design comparison. */
  pageImages?: number;
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
  baseDocument: CvDocumentData | null;
  /** The original CV's content, falling back to baseDocument on older stores. */
  originalDocument: CvDocumentData | null;
  cvs: CvSummary[];
}
