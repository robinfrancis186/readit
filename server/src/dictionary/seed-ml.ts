/**
 * A small starter set of Malayalam headwords so word lookup works the moment
 * you install Readit. It is deliberately tiny — the real dictionary comes from
 * `npm run import:stv`, which imports ശബ്ദതാരാവലി from stv.sayahna.org.
 *
 * Loaded once on first boot; re-running the STV import does not disturb it,
 * and both sources are shown side by side in the lookup popup.
 */
import { countEntries, insertEntries, type UpsertEntry } from './index.js';

export const SEED_SOURCE = 'seed-ml';

const WORDS: Array<[headword: string, definition: string, pos?: string]> = [
  ['പുസ്തകം', 'book; a bound volume of printed or written pages', 'നാമം'],
  ['വായന', 'reading; the act of reading', 'നാമം'],
  ['എഴുത്ത്', 'writing; a letter; the act of composing text', 'നാമം'],
  ['ഭാഷ', 'language; speech; tongue', 'നാമം'],
  ['വാക്ക്', 'word; a spoken utterance; a promise', 'നാമം'],
  ['അർത്ഥം', 'meaning; sense; wealth or purpose', 'നാമം'],
  ['ശബ്ദം', 'sound; noise; a word', 'നാമം'],
  ['ഗ്രന്ഥശാല', 'library; a collection or repository of books', 'നാമം'],
  ['പത്രം', 'newspaper; a leaf; a sheet or document', 'നാമം'],
  ['മാസിക', 'magazine; a monthly periodical', 'നാമം'],
  ['ലേഖനം', 'article; essay; a written piece', 'നാമം'],
  ['കഥ', 'story; tale; narrative', 'നാമം'],
  ['കവിത', 'poem; poetry', 'നാമം'],
  ['നോവൽ', 'novel; a long work of prose fiction', 'നാമം'],
  ['എഴുത്തുകാരൻ', 'writer; author', 'നാമം'],
  ['പ്രസാധകൻ', 'publisher; one who issues books', 'നാമം'],
  ['പതിപ്പ്', 'edition; an impression or printing of a work', 'നാമം'],
  ['ജനാധിപത്യം', 'democracy; rule by the people', 'നാമം'],
  ['രാഷ്ട്രീയം', 'politics; political affairs', 'നാമം'],
  ['സർക്കാർ', 'government; the governing administration', 'നാമം'],
  ['അഴിമതി', 'corruption; malpractice; dishonesty in office', 'നാമം'],
  ['അധികാരം', 'power; authority; jurisdiction', 'നാമം'],
  ['സ്വാതന്ത്ര്യം', 'freedom; liberty; independence', 'നാമം'],
  ['നീതി', 'justice; equity; righteousness', 'നാമം'],
  ['സത്യം', 'truth; reality; that which is true', 'നാമം'],
  ['രാജ്യം', 'country; kingdom; nation', 'നാമം'],
  ['ജനം', 'people; the public; a crowd', 'നാമം'],
  ['പണം', 'money; cash; wealth', 'നാമം'],
  ['വ്യാപാരം', 'trade; business; commerce', 'നാമം'],
  ['കമ്പനി', 'company; a business firm', 'നാമം'],
  ['നഗരം', 'city; town', 'നാമം'],
  ['ഗ്രാമം', 'village; hamlet', 'നാമം'],
  ['വീട്', 'house; home; dwelling', 'നാമം'],
  ['ചരിത്രം', 'history; a chronicle of past events', 'നാമം'],
  ['ശാസ്ത്രം', 'science; a systematic body of knowledge', 'നാമം'],
  ['വിദ്യാഭ്യാസം', 'education; instruction; schooling', 'നാമം'],
  ['പഠനം', 'study; learning; the act of studying', 'നാമം'],
  ['അറിവ്', 'knowledge; awareness; information', 'നാമം'],
  ['ചോദ്യം', 'question; a query', 'നാമം'],
  ['ഉത്തരം', 'answer; reply; the north', 'നാമം'],
  ['മനുഷ്യൻ', 'human being; man; person', 'നാമം'],
  ['ജീവിതം', 'life; the course of living', 'നാമം'],
  ['മനസ്സ്', 'mind; heart; inclination', 'നാമം'],
  ['സ്നേഹം', 'love; affection; fondness', 'നാമം'],
  ['സന്തോഷം', 'happiness; joy; delight', 'നാമം'],
  ['ദുഃഖം', 'sorrow; grief; distress', 'നാമം'],
  ['ലോകം', 'world; universe; the people at large', 'നാമം'],
  ['ഭൂമി', 'earth; land; ground', 'നാമം'],
  ['ആകാശം', 'sky; the heavens; space', 'നാമം'],
  ['വെള്ളം', 'water', 'നാമം'],
  ['ഭക്ഷണം', 'food; a meal', 'നാമം'],
  ['സമയം', 'time; occasion; a period', 'നാമം'],
  ['വർഷം', 'year; rain; a season of rain', 'നാമം'],
  ['ദിവസം', 'day', 'നാമം'],
  ['കണ്ണ്', 'eye; a bud or joint in a plant', 'നാമം'],
  ['കൈ', 'hand; arm', 'നാമം'],
  ['അമ്മ', 'mother', 'നാമം'],
  ['അച്ഛൻ', 'father', 'നാമം'],
  ['കുട്ടി', 'child; young one', 'നാമം'],
  ['താരാവലി', 'a string or cluster of stars; a series', 'നാമം'],
  ['വായിക്കുക', 'to read', 'ക്രിയ'],
  ['എഴുതുക', 'to write', 'ക്രിയ'],
  ['പറയുക', 'to say; to tell', 'ക്രിയ'],
  ['അറിയുക', 'to know; to come to know', 'ക്രിയ'],
  ['കാണുക', 'to see; to meet', 'ക്രിയ'],
  ['നല്ല', 'good; fine', 'വിശേഷണം'],
  ['വലിയ', 'big; large; great', 'വിശേഷണം'],
  ['ചെറിയ', 'small; little', 'വിശേഷണം'],
];

/** Idempotent: only seeds when there is no Malayalam data at all. */
export function seedMalayalamIfEmpty(): number {
  if (countEntries('ml') > 0) return 0;
  const entries: UpsertEntry[] = WORDS.map(([headword, definition, pos]) => ({
    lang: 'ml',
    source: SEED_SOURCE,
    headword,
    definition,
    pos,
  }));
  insertEntries(entries);
  return entries.length;
}
