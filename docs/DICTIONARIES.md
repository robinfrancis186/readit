# Dictionaries

Readit looks words up from a local SQLite table (`dict_entries`). Malayalam and
English both work offline out of the box — the dictionaries are bundled with
the application. Further sources can be imported on top, and Oxford can be
added as a live provider. Every source is tagged, so results from several
dictionaries appear side by side in the popup and you can always tell which is
which.

## What is bundled

Two dictionaries are committed to the repository under
`server/data/dictionaries/` and load themselves the first time Readit starts.
No download, no API key, no import step:

| File | Language | Contents | Licence |
| --- | --- | --- | --- |
| `datuk-ml.tsv.gz` | Malayalam | 148,331 definitions for 83,610 words | ODbL |
| `wordnet-en.tsv.gz` | English | 207,272 senses with examples | WordNet 3.0 |

Loading takes a few seconds once; afterwards startup is two `COUNT` queries.
Sources, licences and the file format are documented in
`server/data/dictionaries/ATTRIBUTION.md`.

To refresh them when the upstream data changes:

```bash
npm run build:dictionaries
```

That downloads Datuk and reads WordNet from the `wordnet-db` dev dependency,
then rewrites both `.tsv.gz` files. Point it at local copies with `DATUK_YAML`
and `WORDNET_DICT_DIR` if you would rather not download anything.

## English — Oxford (optional, live)

Oxford Dictionaries requires a licensed API key, so it is off unless you supply
credentials:

```bash
export OXFORD_APP_ID=your-app-id
export OXFORD_APP_KEY=your-app-key
npm start
```

Oxford is consulted only when the bundled dictionaries have nothing for a word,
so normal reading stays instant and offline. Get credentials at
<https://developer.oxforddictionaries.com/>. The endpoint is the v2 Entries
API; adjust `BASE` in `server/src/dictionary/oxford.ts` if your plan uses the
production host rather than the sandbox.

## Malayalam — ശബ്ദതാരാവലി (Sabdatharavali)

Malayalam already works offline through the bundled Datuk corpus. ശബ്ദതാരാവലി
is an *additional* source — importing it does not replace Datuk, and results
from both appear together, labelled. Import Sayahna's edition from
<https://stv.sayahna.org>:

```bash
npm run import:stv
```

The importer starts at `stv-a1.html`, follows links to the other per-letter
pages, and parses entries out of each. It waits 400 ms between requests; raise
it with `--delay` if you want to be gentler.

Useful flags:

```bash
npm run import:stv -- --limit 3        # first 3 pages only, as a smoke test
npm run import:stv -- --dump ./raw     # also save each page's HTML
npm run import:stv -- --from ./raw     # re-parse saved HTML, no network
npm run import:stv -- --keep           # add to existing entries instead of replacing
```

### If the import finds nothing

Printed-dictionary conversions vary in markup, so rather than committing to one
CSS selector the parser tries three entry layouts and keeps whichever yields
the most entries:

1. definition lists — `<dt>headword</dt><dd>meaning</dd>`
2. a paragraph per entry with the headword emphasised at the start —
   `<p><b>headword</b> meaning</p>`
3. flat paragraphs where a dash or colon separates headword from meaning

It reports which layout matched and how many entries it kept. If a site
redesign breaks all three, dump the HTML and adapt `extractStrategies` in
`server/src/scripts/import-stv.ts`:

```bash
npm run import:stv -- --limit 2 --dump ./raw
# inspect ./raw/stv-a1.html, add a strategy, then:
npm run import:stv -- --from ./raw
```

### Chillu letters

Malayalam writes six letters — ൺ ൻ ർ ൽ ൾ ൿ — in two ways. Modern text uses the
atomic characters; older digitisations, Datuk included, write consonant +
virama + ZWJ. They are the same letter and must fold to one lookup key, or a
word selected from a modern EPUB never matches. This is not a marginal case:
folding corrected 30,445 of the 79,590 Malayalam headwords, 38% of the corpus.

`normalise` folds legacy sequences to the atomic form *before* stripping
zero-width joiners, since stripping first would destroy the very sequence that
identifies a chillu.

If you change `normalise` in a way that alters existing keys, bump
`NORMALISATION_VERSION` in `server/src/dictionary/index.ts`. On the next start
Readit recomputes every stored key rather than silently failing to match.

### How Malayalam lookup works

Malayalam is agglutinative: a word in running text usually carries case, plural
or postpositional suffixes that no dictionary lists as a headword. Selecting
`ജനാധിപത്യത്തിന്റെ` in a book has to find `ജനാധിപത്യം`.

Lookup tries, in order:

1. the exact headword
2. for a multi-word selection, each word in turn
3. known suffixes stripped — and because a noun headword usually ends in
   anusvara (ം) or a virama (്) which is dropped before a suffix attaches
   (പുസ്തകം + ത്തിൽ → പുസ്തകത്തിൽ), those are added back
4. the longest headword that the selected word *begins with*, compared against
   the headword with its trailing ം/് removed — this catches compounds and
   inflections the suffix list does not enumerate
5. headwords beginning with what was selected, for a partial highlight
6. Oxford, if configured (English only)

Results are labelled `root form` or `closest match` when they came from
anything other than an exact hit, so you always know what you are looking at.

Two details matter for correctness and are covered by tests:

- Normalisation keeps Unicode combining marks (`\p{M}`). Indic vowel signs are
  marks, not letters, so trimming on letters and digits alone silently
  truncates words.
- Control characters are stripped, because PDF text layers emit NULs where the
  source font was missing a glyph.

## Adding another dictionary

Any importer that writes to `dict_entries` works. From a script:

```ts
import { insertEntries, clearSource } from '../dictionary/index.js';

clearSource('my-dictionary');
insertEntries([
  {
    lang: 'ml',                 // 'ml' | 'en'
    source: 'my-dictionary',    // shown as the provenance label
    headword: 'ഭാഷ',
    pos: 'നാമം',                // optional
    definition: 'language; speech; tongue',
    examples: ['…'],            // optional
  },
]);
```

`headword_norm` and the FTS index are maintained for you. A new `lang` value
also needs a branch in `detectLang` and a suffix list in
`server/src/dictionary/index.ts` if the language is inflected.

## Licensing

Readit bundles two dictionaries and can import more. Each carries its own
terms:

- **WordNet** — Princeton University's WordNet licence, redistributable with
  attribution. Bundled; see `server/data/dictionaries/LICENSE-wordnet.txt`.
- **Datuk** — ODC Open Database License (ODbL) v1.0. Bundled; see
  `server/data/dictionaries/LICENSE-datuk.txt`. ODbL is share-alike: publishing
  the database or a derivative keeps it under ODbL with attribution. That binds
  the data, not Readit's source code.
- **ശബ്ദതാരാവലി via Sayahna** — check the terms at <https://stv.sayahna.org>
  before redistributing anything you import.
- **Oxford** — commercial licence; results are fetched live and are not stored.
