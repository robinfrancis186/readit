# Dictionaries

Readit looks words up from a local SQLite table (`dict_entries`), filled by
importers, with an optional live provider for Oxford. Every source is tagged,
so results from several dictionaries appear side by side in the popup and you
can always tell which is which.

## English — WordNet (offline, default)

```bash
npm run import:wordnet
```

Imports WordNet 3.1 from the `wordnet-db` package: roughly 207,000 senses
across nouns, verbs, adjectives and adverbs, with example sentences. No network
access, no API key. This is the default English dictionary.

To use a WordNet installation of your own:

```bash
WORDNET_DICT_DIR=/usr/share/wordnet npm run import:wordnet
```

## English — Oxford (optional, live)

Oxford Dictionaries requires a licensed API key, so it is off unless you supply
credentials:

```bash
export OXFORD_APP_ID=your-app-id
export OXFORD_APP_KEY=your-app-key
npm start
```

Oxford is consulted only when the local dictionaries have nothing for a word,
so normal reading stays instant and offline. Get credentials at
<https://developer.oxforddictionaries.com/>. The endpoint is the v2 Entries
API; adjust `BASE` in `server/src/dictionary/oxford.ts` if your plan uses the
production host rather than the sandbox.

## Malayalam — ശബ്ദതാരാവലി (Sabdatharavali)

Readit ships a ~70-word starter list so Malayalam lookup works the moment you
install it. For the real dictionary, import Sayahna's edition of
ശബ്ദതാരാവലി from <https://stv.sayahna.org>:

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

Readit ships no dictionary content beyond the small Malayalam starter list. The
importers fetch or read data from sources with their own terms:

- **WordNet** — Princeton University's WordNet licence, redistributable with
  attribution.
- **ശബ്ദതാരാവലി via Sayahna** — check the terms at <https://stv.sayahna.org>
  before redistributing anything you import.
- **Oxford** — commercial licence; results are fetched live and are not stored.
