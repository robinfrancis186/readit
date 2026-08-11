export type ItemKind = 'book' | 'magazine' | 'newspaper' | 'document';
export type DocumentKind = 'excerpt' | 'vocab';
export type Lang = 'ml' | 'en';

export interface Item {
  id: number;
  kind: ItemKind;
  title: string;
  subtitle: string | null;
  authors: string[];
  language: string | null;
  publisher: string | null;
  published_date: string | null;
  year: number | null;
  edition: string | null;
  genres: string[];
  isbn: string | null;
  series: string | null;
  issue_date: string | null;
  issue_number: string | null;
  volume: string | null;
  description: string | null;
  page_count: number | null;
  file_format: 'epub' | 'pdf';
  file_size: number | null;
  cover_path: string | null;
  reading_progress: number;
  reading_locator: string | null;
  added_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

export interface DocumentMeta {
  id: number;
  item_id: number;
  kind: DocumentKind;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DocPage {
  id: number;
  document_id: number;
  page_number: number;
  title: string | null;
  issue_date: string | null;
  created_at: string;
}

export interface Entry {
  id: number;
  document_id: number;
  page_id: number;
  kind: 'excerpt' | 'word';
  content_html: string;
  content_text: string;
  note: string | null;
  word: string | null;
  lang: string | null;
  meanings: DictionaryResult[] | null;
  dict_source: string | null;
  source_label: string | null;
  source_locator: string | null;
  reading_date: string;
  issue_date: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface Sense {
  pos?: string;
  definition: string;
  examples?: string[];
}

export interface DictionaryResult {
  headword: string;
  lang: Lang;
  source: string;
  match: 'exact' | 'stem' | 'prefix';
  senses: Sense[];
}

export interface LookupResponse {
  query: string;
  lang: Lang;
  results: DictionaryResult[];
  notice?: string;
}

export interface Facets {
  kinds: FacetValue[];
  languages: FacetValue[];
  publishers: FacetValue[];
  series: FacetValue[];
  authors: FacetValue[];
  genres: FacetValue[];
  years: { min: number | null; max: number | null };
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface ItemSection {
  id: number;
  section_index: number;
  section_href: string | null;
  section_title: string | null;
  length: number;
}

export interface SearchHit {
  id: number;
  section_index: number;
  section_href: string | null;
  section_title: string | null;
  snippet: string;
}

export interface ItemDetail {
  item: Item;
  documents: DocumentMeta[];
  sections: ItemSection[];
  entryCounts: Record<string, number>;
}

export interface DocumentPayload {
  document: DocumentMeta;
  item: Item | null;
  pages: DocPage[];
  entries: Entry[];
  filtered: boolean;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  ml: 'Malayalam',
  hi: 'Hindi',
  ta: 'Tamil',
  kn: 'Kannada',
  te: 'Telugu',
  sa: 'Sanskrit',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  ar: 'Arabic',
};

export function languageName(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

export const KIND_LABELS: Record<ItemKind, string> = {
  book: 'Book',
  magazine: 'Magazine',
  newspaper: 'Newspaper',
  document: 'Document',
};
