export interface ExtractedMetadata {
  title: string;
  subtitle?: string;
  authors: string[];
  language?: string;
  publisher?: string;
  publishedDate?: string;
  year?: number;
  edition?: string;
  genres: string[];
  description?: string;
  isbn?: string;
  series?: string;
  pageCount?: number;
}

export interface ExtractedSection {
  index: number;
  href?: string;
  title?: string;
  text: string;
}
