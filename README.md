# Readit

A personal library for books, magazines, newspapers and PDFs — with a reader
that turns any selection into a dictionary lookup or a note, and a separate
editable notebook for every item you read.

Readit runs as a small web app you host yourself. Open it in a browser on a
desktop, tablet or phone — or install it as an app on Windows, macOS, Android
and iOS straight from the browser. The library, the notebooks and the
dictionaries all live in a single SQLite file you own.

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
with its meanings, offline, in both languages — no API key and no connection.
Malayalam is agglutinative, so lookup strips case and postpositional suffixes
to reach the headword: select `ജനാധിപത്യത്തിന്റെ` and you get `ജനാധിപത്യം`. It
also folds the two ways Malayalam writes its chillu letters, so a word from a
modern EPUB matches a dictionary digitised the older way.

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

Looking the same word up twice in one sitting will not leave two identical
entries — Readit says it is already on today's page. Meeting it again on a
later day *does* record a second entry, because that is a genuine second
sighting in a new context. Excerpts are never de-duplicated: the same passage
may legitimately be quoted twice.

**Install it as an app.** Readit is a progressive web app, so it installs
without an app store and runs in its own window with its own icon:

| Platform | How |
| --- | --- |
| Windows / macOS / Linux | Chrome or Edge → the install icon in the address bar |
| Android | Chrome → menu → *Install app* |
| iOS / iPadOS | Safari → Share → *Add to Home Screen* |

Installed, it opens instantly and its shell still loads without a connection,
so you get a real explanation rather than a browser error page. Your library
itself is served by the API and needs the server reachable — Readit never
caches book files or notes, which would go stale and would not fit in a
browser's storage quota anyway.

---

## Quick start

Requires Node 20 or newer.

```bash
npm install
npm run build
npm start                  # http://localhost:4000
```

Both dictionaries ship with Readit and load themselves the first time it
starts, so word lookup works offline immediately — there is no import step to
remember.

For development, with the API and the web app on separate ports and hot reload:

```bash
npm run dev                # web on :5173, API on :4000
```

Everything you add lives in `data/` — `data/readit.db` plus the original files
under `data/library/`. Back up that one directory and you have backed up
everything. Point it elsewhere with `READIT_DATA_DIR`.

### Putting it online

There is a project page on GitHub Pages describing Readit, deployed from
`site/`. Readit itself needs a server and a disk, so it cannot run on Pages —
it runs on your machine, or on a host you control. There is a `Dockerfile`, and
configs for Fly.io and Render:

```bash
docker build -t readit .
docker run -p 4000:4000 -v readit-data:/data \
  -e READIT_PASSWORD='a long passphrase' readit
```

**Set a password before exposing it to anything.** Readit has no accounts, so
without `READIT_PASSWORD` anyone who reaches the URL can read and delete your
library. With it set, every API route needs a signed session and the app shows a
sign-in screen.

See [docs/DEPLOY.md](docs/DEPLOY.md) for Fly.io, Render, backups and the
trade-offs.

### Reaching it from your phone

Readit binds to loopback by default, so out of the box it is reachable only
from the machine running it. To open it on a phone or tablet on the same
network:

```bash
HOST=0.0.0.0 npm start     # then browse to http://<that-machine-ip>:4000
```

Do this only on a network you trust. Readit has no accounts and no
authentication, so anyone who can reach the port can read *and delete* your
library. On anything less than a trusted network, put it behind a reverse
proxy that authenticates, or a VPN/tunnel.

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes it to your network |
| `READIT_DATA_DIR` | `./data` | Database, imported files, covers |
| `READIT_MAX_UPLOAD` | `536870912` | Upload size limit in bytes |
| `READIT_PASSWORD` | – | Require a password. Essential on any public host |
| `READIT_SESSION_DAYS` | `30` | How long a sign-in lasts |
| `OXFORD_APP_ID` / `OXFORD_APP_KEY` | – | Enables the Oxford provider |

---

## Dictionaries

Two dictionaries are bundled and load on first start. Nothing is downloaded and
nothing needs configuring:

| Language | Dictionary | Size |
| --- | --- | --- |
| Malayalam | **Datuk** — Malayalam–Malayalam, 148,331 definitions for 83,610 words | 2.6 MB |
| English | **WordNet 3.1** — 207,272 senses with examples | 4.2 MB |

A few dozen Malayalam → English glosses are included too, since Datuk explains a
Malayalam word *in Malayalam* and a reader often wants the English meaning.
Every source is labelled in the popup, and results from all of them appear
together.

Optional extras: ശബ്ദതാരാവലി with `npm run import:stv`, and Oxford as a live
provider with an API key. See [docs/DICTIONARIES.md](docs/DICTIONARIES.md) for
those, the licences, and how to add a dictionary of your own.

---

## Tests

```bash
npm test                                    # unit tests
READIT_SAMPLE_EPUB=/path/to/book.epub npm test   # also exercises real EPUB ingestion

npm run build && npm start                  # in another terminal
READIT_SAMPLE_EPUB=/path/to/book.epub npm run test:e2e
```

Three end-to-end suites drive a real browser and fail on any console error:

- **Book** — import an EPUB, read it, select text, look a word up, save and
  edit notes, search and export them.
- **Periodical** — import a PDF newspaper with an issue date, read it through
  pdf.js's text layer, look up English and Malayalam words, and confirm
  excerpts are filed on a page of their own for that issue. Uses a generated
  fixture (`node e2e/fixtures/make-newspaper.mjs`).
- **PWA** — the manifest, icons and iOS tags needed to install, and that the
  app boots offline rather than showing a blank page.

The e2e suites need the built app being served (`npm run build && npm start`),
not the dev server. Set `CHROMIUM_PATH` if you want to use a Chromium you
already have rather than Playwright's.

---

## How it is put together

```
server/   Fastify + SQLite (better-sqlite3). REST API, EPUB/PDF ingestion,
          dictionary engine and importers.
web/      React + Vite + Tailwind. Library, reader, notebooks, dictionary,
          plus the manifest and service worker that make it installable.
e2e/      Browser tests for the three end-to-end workflows.
site/     The static project page published to GitHub Pages.
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

Readit is single-user by design: one library, one optional password, no
accounts. It binds to loopback unless you set `HOST`, and a public deployment
should always set `READIT_PASSWORD`. Sharing the password shares everything,
including deletion.

Installing it as an app covers Windows, Android and iOS from one codebase.
Fully native applications are not built; the API is separate from the UI so
they can be added without reworking the server.

Also not yet built: OCR for scanned PDFs that carry no text layer (they will
import and display, but not be searchable), reading book files offline, and
sync between devices.

One caution for iOS: Safari evicts service worker caches for sites that have
not been opened in a while, so an installed copy may need a connection on its
first launch after a long gap.
