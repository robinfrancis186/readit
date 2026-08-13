# Bundled dictionaries

Readit ships these two dictionaries so that word lookup works offline, in both
languages, with no setup and no network access. Each is redistributed under its
own licence, unchanged in substance — the files here are only a reformatting of
the upstream data into a compact tab-separated form.

Regenerate them with `npm run build:dictionaries` (see
`server/src/scripts/build-dictionaries.ts`).

## `datuk-ml.tsv.gz` — Malayalam → Malayalam

The **Datuk** corpus: 148,331 definitions for 83,610 Malayalam words, most of
them grammar-tagged. It is a Malayalam–Malayalam dictionary, so it explains a
Malayalam word in Malayalam, the same role ശബ്ദതാരാവലി plays.

- Upstream: <https://github.com/knadh/datuk> · <https://olam.in/open/datuk/>
- Licence: **ODC Open Database License (ODbL) v1.0** — see `LICENSE-datuk.txt`
- ODbL is share-alike: if you publish this database or a derivative of it, it
  must stay under ODbL with attribution. That covers the data only, not
  Readit's own source code.

## `wordnet-en.tsv.gz` — English

**Princeton WordNet 3.1**: 207,272 senses across nouns, verbs, adjectives and
adverbs, with example sentences.

- Upstream: <https://wordnet.princeton.edu/>
- Licence: WordNet 3.0 licence — see `LICENSE-wordnet.txt`. Permits use,
  copying, modification and distribution provided the notice is retained.

## Format

Each file is gzipped UTF-8 TSV, one definition per line, four columns:

```
headword <TAB> part of speech <TAB> definition <TAB> examples
```

Tabs and newlines are stripped from field values, so no quoting or escaping is
needed. Examples are separated by ` | ` and the column may be empty.

## Not bundled

**ശബ്ദതാരാവലി (Sabdatharavali)** from <https://stv.sayahna.org> is imported
separately with `npm run import:stv`, because it is scraped from a website
rather than distributed as a dataset. It adds to the bundled dictionaries
rather than replacing them; results from every source are shown side by side
and labelled.
