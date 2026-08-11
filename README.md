# Readit

A personal library for books, magazines, newspapers and PDFs — with a reader
that turns any selection into a dictionary lookup or a note, and a separate
editable notebook for every item you read.

Readit runs as a small web app you host yourself. Open it in a browser on a
desktop, tablet or phone; the library, the notebooks and the dictionaries all
live in a single SQLite file you own.

---

## What it does

**Collect and classify.** Import EPUB and PDF files. Readit reads the metadata
already inside them — title, subtitle, authors, language, publisher,
publication date, ISBN, series, cover — and indexes the full text. Anything it
gets wrong (or a file never carried) you can edit: type, edition, genres,
issue date, issue number, volume.

**Find things.** Filter the library by type, language, author, genre,
publisher, series, year range and issue-date range, in any combination, with
live counts on every facet. Search titles and authors, or search *inside* a
book and jump straight to the passage.

**Read.** EPUBs render paginated with a table of contents; PDFs render with a
real text layer, so text is genuinely selectable rather than a picture of
words. Font size and reading position are remembered.

**Look words up while reading.** Select a word or phrase and a popup appears
with its meanings — Malayalam from ശബ്ദതാരാവലി (Sabdatharavali), English from
WordNet or the Oxford API. Malayalam is agglutinative, so lookup strips case
and postpositional suffixes to reach the headword: select `ജനാധിപത്യത്തിന്റെ`
and you get `ജനാധിപത്യം`.

**Keep two notebooks per item.** Every item automatically gets:

- **Reading notes** — excerpts you select while reading, each recording the
  chapter or page it came from, with a link back to it.
- **Word list** — words you looked up, saved together with the meanings shown
  at the time.

Both are named with the particulars of their source, so a notebook is
identifiable on its own:

> Reading notes — A Feast of Vultures: The Hidden Business of Democracy in
> India — Josy Joseph — HarperCollins India — 2016

Both are laid out as books with numbered pages, and both are editable — click
into an excerpt and type. Both can be searched by keyword and by date range,
and exported to Markdown.

**Periodicals are handled as periodicals.** For a magazine or newspaper, the
reading notes get a separate page per issue date, so a title you follow over
months reads chronologically. Word lists page by the date you read them.

---

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run import:wordnet     # offline English dictionary (~207k senses)
npm run build
npm start                  # http://localhost:4000
```

For development, with the API and the web app on separate ports and hot reload:

```bash
npm run dev                # web on :5173, API on :4000
```

Everything you add lives in `data/` — `data/readit.db` plus the original files
under `data/library/`. Back up that one directory and you have backed up
everything. Point it elsewhere with `READIT_DATA_DIR`.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `READIT_DATA_DIR` | `./data` | Database, imported files, covers |
| `READIT_MAX_UPLOAD` | `536870912` | Upload size limit in bytes |
| `OXFORD_APP_ID` / `OXFORD_APP_KEY` | – | Enables the Oxford provider |

---

## Dictionaries

English works offline out of the box after `npm run import:wordnet`. Malayalam
ships with a small starter word list so lookup works immediately; import the
full ശബ്ദതാരാവലി with `npm run import:stv`.

See [docs/DICTIONARIES.md](docs/DICTIONARIES.md) for the importers, the Oxford
setup, and how to add a dictionary of your own.

---

## Tests

```bash
npm test                                    # unit tests
READIT_SAMPLE_EPUB=/path/to/book.epub npm test   # also exercises real EPUB ingestion

npm start                                   # in another terminal
READIT_SAMPLE_EPUB=/path/to/book.epub npm run test:e2e
```

The end-to-end suites drive a real browser through both workflows — importing
a book, reading it, selecting text, looking words up, saving and editing notes
— and fail on any console error. The periodical suite uses a generated sample
newspaper (`node e2e/fixtures/make-newspaper.mjs`).

---

## How it is put together

```
server/   Fastify + SQLite (better-sqlite3). REST API, EPUB/PDF ingestion,
          dictionary engine and importers.
web/      React + Vite + Tailwind. Library, reader, notebooks, dictionary.
e2e/      Browser tests for the two end-to-end workflows.
```

Search everywhere — the library, inside a book, inside a notebook, and across
dictionary definitions — is SQLite FTS5 with Unicode tokenisation, so Malayalam
and English index and match on the same footing.

The API is deliberately separate from the UI. Everything the web app does goes
through `/api/*`, which is what a native desktop or mobile client would talk to
later; the browser app is simply the first client.

### Notes on the data model

- `items` — one row per physical thing: a book, a magazine issue, a newspaper
  issue, a loose PDF. Periodical fields stay null for books.
- `item_text` — extracted text, one row per EPUB spine entry or PDF page. This
  is what in-book search matches, and what lets an excerpt say where it came
  from.
- `documents` / `doc_pages` / `entries` — the notebooks, their pages, and the
  excerpts and words on them.
- `dict_entries` — the local dictionary store the importers fill.

---

## Status and limits

Readit is single-user and unauthenticated by design: it is meant to be run on
your own machine or a private host. There are no accounts, so do not expose it
directly to the internet without putting authentication in front of it.

Not yet built: native desktop and mobile applications (the API is ready for
them), OCR for scanned PDFs without a text layer, and sync between devices.
