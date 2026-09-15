export type CssRules = Record<string, string>;
export type SemanticRole = 'body' | 'h1' | 'h2' | 'h3' | 'p' | 'strong' | 'blockquote' | 'a' | 'ul' | 'ol' | 'li' | 'pre' | 'code' | 'hr' | 'img' | 'table' | 'th' | 'td';

export interface Theme {
  id: string;
  name: string;
  description: string;
  category: string;
  accent: string;
  soft: string;
  ink: string;
  muted: string;
  font: 'sans' | 'serif';
  headingFont: 'sans' | 'serif';
  headingStyle: 'bar' | 'underline' | 'centered' | 'minimal' | 'pill';
  quoteStyle: 'line' | 'card' | 'plain';
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  custom?: boolean;
  sourceUrl?: string;
  sourceTitle?: string;
  createdAt?: string;
  styles?: Partial<Record<SemanticRole, CssRules>>;
  extraction?: { sampledElements: number; detectedRoles: string[]; notes: string[] };
}

export interface ArticleSettings {
  themeId: string;
  fontSize: number;
  lineHeight: number;
  paragraphSpacing: number;
  accent: string;
  font: 'sans' | 'serif';
  justify: boolean;
  showTitle: boolean;
  showMeta: boolean;
  linkFootnotes: boolean;
}

export interface ArticleSummary {
  path: string;
  name: string;
  title: string;
  modifiedAt: string;
  size: number;
}

export interface Article extends ArticleSummary {
  content: string;
  revision: string;
  settings?: ArticleSettings;
}

export interface Workspace {
  directory: string;
  name: string;
  articles: ArticleSummary[];
  truncated: boolean;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  directories: { name: string; path: string }[];
  bookmarks: { name: string; path: string }[];
}
