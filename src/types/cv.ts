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
  };
  color: {
    text: string;
    heading: string;
    accent: string;
    muted: string;
    rule: string;
  };
  header: {
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
    layout: 'title-left-date-right' | 'title-then-subtitle' | 'compact';
    bulletChar: string;
    bulletIndentPt: number;
    bulletSizePt: number;
    bulletSpacingPt: number;
    spacingPt: number;
  };
  skills: {
    layout: 'inline-categories' | 'bullets' | 'comma-list' | 'pills';
    categoryWeight: number;
    separator: string;
  };
  layout: {
    type: 'single' | 'two-column';
    sideColumn: 'left' | 'right';
    sideWidthPct: number;
  };
  sections: SectionDef[];
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
  link?: string;
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
  bullets: string[];
}

export interface RenderedSkillGroup {
  groupId?: string;
  category: string;
  skills: string[];
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
