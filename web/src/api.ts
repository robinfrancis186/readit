import type {
  DocPage,
  DocumentPayload,
  Entry,
  Facets,
  Item,
  ItemDetail,
  LookupResponse,
  SearchHit,
} from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers:
        init?.body instanceof FormData
          ? init?.headers
          : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch only rejects on a network-level failure. Installed as an app, this
    // is the common case, and "Failed to fetch" tells the reader nothing.
    throw new ApiError(
      navigator.onLine
        ? 'Cannot reach Readit. Is the server running?'
        : 'You are offline. Your library needs a connection.',
      0,
    );
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body; keep the status line
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LibraryQuery {
  q?: string;
  kind?: string;
  language?: string;
  author?: string;
  genre?: string;
  publisher?: string;
  series?: string;
  yearFrom?: number;
  yearTo?: number;
  dateFrom?: string;
  dateTo?: string;
  sort?: string;
  limit?: number;
  offset?: number;
}

function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const api = {
  listItems: (query: LibraryQuery = {}) =>
    request<{ items: Item[]; total: number; limit: number; offset: number }>(
      `/api/library${qs(query as Record<string, unknown>)}`,
    ),

  facets: () => request<Facets>('/api/library/facets'),

  item: (id: number) => request<ItemDetail>(`/api/library/${id}`),

  updateItem: (id: number, patch: Record<string, unknown>) =>
    request<{ item: Item }>(`/api/library/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteItem: (id: number) => request<{ ok: true }>(`/api/library/${id}`, { method: 'DELETE' }),

  upload: (form: FormData) =>
    request<{ results: Array<{ itemId?: number; title?: string; duplicate?: boolean; error?: string; filename?: string }> }>(
      '/api/library/upload',
      { method: 'POST', body: form },
    ),

  searchInside: (id: number, q: string) =>
    request<{ hits: SearchHit[] }>(`/api/library/${id}/search${qs({ q })}`),

  section: (id: number, index: number) =>
    request<{ id: number; section_index: number; section_title: string | null; text: string }>(
      `/api/library/${id}/section/${index}`,
    ),

  document: (id: number, query: { q?: string; from?: string; to?: string; pageId?: number } = {}) =>
    request<DocumentPayload>(`/api/documents/${id}${qs(query)}`),

  addEntry: (documentId: number, body: Record<string, unknown>) =>
    request<{ entry: Entry }>(`/api/documents/${documentId}/entries`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateEntry: (id: number, body: Record<string, unknown>) =>
    request<{ entry: Entry }>(`/api/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteEntry: (id: number) => request<{ ok: true }>(`/api/entries/${id}`, { method: 'DELETE' }),

  addPage: (documentId: number, body: { title?: string; issueDate?: string } = {}) =>
    request<{ page: DocPage }>(`/api/documents/${documentId}/pages`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePage: (id: number, body: { title?: string; issueDate?: string | null }) =>
    request<{ page: DocPage }>(`/api/pages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  lookup: (q: string, lang?: string) =>
    request<LookupResponse>(`/api/dictionary/lookup${qs({ q, lang })}`),

  searchDictionary: (q: string, lang?: string) =>
    request<{ results: LookupResponse['results'] }>(`/api/dictionary/search${qs({ q, lang })}`),

  dictionaryStats: () =>
    request<{ sources: Array<{ source: string; lang: string; entries: number }>; providers: { oxford: boolean } }>(
      '/api/dictionary/stats',
    ),
};

export const fileUrl = (id: number) => `/api/library/${id}/file`;
export const coverUrl = (id: number) => `/api/library/${id}/cover`;
export const exportUrl = (documentId: number) => `/api/documents/${documentId}/export`;
