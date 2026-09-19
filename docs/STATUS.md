# Readit: application and deployment status

Readit is a single-user reading library. Import EPUBs or text PDFs, correct their
metadata, filter/search the collection, read a book, and save selected passages
or dictionary words to its notebooks. Each item has reading notes and a vocabulary
notebook. The English WordNet and Malayalam Datuk dictionaries are bundled.

## Architecture

- React/Vite frontend, EPUB.js reader, PDF.js reader and selectable text layer.
- Fastify API for the library, notebooks, authentication and dictionary queries.
- Local mode: SQLite and files in `data/`; no cloud account required.
- Cloud mode: Turso stores the library, extracted text, notebooks and login rate
  limits. Private Vercel Blob stores the original books and covers. Dictionaries
  are built into a read-only SQLite artifact inside the Vercel function.
- Cloud uploads go directly from the browser to private Blob, then the authenticated
  API parses and indexes them. They do not pass through Vercel's request-body limit.

## Repairs and improvements

- Added complete Vercel deployment, durable storage and shared session signing.
- Cloud access fails closed if credentials/password are missing; private API data
  is not publicly cached. Login throttling persists across function instances.
- HTML from imported text/notes cannot execute in search results or notebook views.
- Dictionary punctuation no longer causes SQL FTS syntax errors.
- Notebook moves validate page ownership; insert/dedup/page choice is transactional.
- Vocabulary date filters use the reading date, even for old newspaper issues.
- Author and genre filters match full array values; library has pagination.
- EPUB/PDF search links and notebook source links use the correct location format.
- Reading progress saves periodically, when hidden and when leaving the reader.
  EPUB initialization cannot replace saved progress with a temporary zero.
- Explicitly bundle the PDF.js server worker for Vercel PDF imports.
- Missing records show recoverable errors instead of loading forever.
- Updated vulnerable dependencies. EPUB.js is declared at the workspace root so
  npm applies the patched XML parser override (workspace-only declaration did not).
- Added a self-contained original EPUB fixture and repeatable browser smoke checks.

## Remaining product limits

This remains a single-user app: the shared password gives full access, including
removal of books. No separate user accounts, OCR, or fully offline books. Scanned
PDFs can display but cannot provide selectable text without OCR. The cloud upload
limit is 128 MiB; very long PDFs still render every page, so browser memory and
server import time limit practical document sizes. Failed staged imports can leave
private Blob objects requiring cleanup. Provider usage limits and charges apply.

## Verification

The typecheck, production build, 76 automated tests and local browser suites
passed. Real Turso/Blob checks verified EPUB import, persisted progress and notes,
a second browser session, a 6 MiB direct upload, exact-byte download, blocked
anonymous file access and deletion. Live browser checks on
https://readit-opal.vercel.app also passed PDF import, English/Malayalam selection
lookups, issue-dated excerpts, vocabulary saves, and the offline app shell.
The public deployment is password protected; credentials are excluded from Git.
Checks cover these workflows, not a guarantee that every possible bug is absent.

## Optional reading analytics

Open **Analytics** in the main navigation and enable tracking. The dashboard
shows active time, estimated words read, books with activity, daily activity,
current streak, saved vocabulary/excerpts, and time per book, with 7-day,
30-day and all-time filters. Tracking defaults off and can be paused.

Only a loaded reader in a visible, focused tab accrues time; two minutes without
interaction pauses it. EPUB iframe interactions resume activity. Cumulative
session snapshots sync to the same private database, with retry deduplication
and server elapsed-time bounds. Words read are explicitly estimated at 200 words
per minute, not measured text coverage. No historical time is invented. Days use
the reading device's local calendar; streaks require one minute per day. Deleting
a book removes its analytics. Concurrent use on separate devices may overlap.
