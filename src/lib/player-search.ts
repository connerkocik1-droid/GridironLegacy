/**
 * Which footballers a story is actually about.
 *
 * The wire used to answer this with ESPN's own tagging — `categories[]` with
 * `type: "athlete"` — and the answer was usually nobody. ESPN tags a minority
 * of its articles, and it tags them for ESPN's purposes rather than for a
 * fantasy league's, so a page built on those tags shows a manager a great deal
 * of league-wide NFL news and almost nothing about the fifteen men he owns.
 *
 * So the story is searched instead, against every name in the pool. The text
 * is short — a headline and a one-line description, which is all the wire
 * carries — so this is a scan over a few hundred characters per story, and the
 * index is built once.
 *
 * Precision matters more than recall here. The complaint that started this was
 * "random NFL news", and a wrong player attached to a story is a worse version
 * of that same complaint: it is random news wearing your running back's name.
 * So the rules below are deliberately narrow, and each one is tested.
 */
import { normalizeName } from "./player-names";

/** How far back a story may be and still be worth showing. */
export const FRESH_DAYS = 14;

/** A surname on its own has to be at least this long to count. */
const MIN_SURNAME = 4;

export interface PoolPlayer {
  /** His name as the pool spells it. */
  n: string;
}

export interface NameIndex {
  /** Normalised full name -> the pool's spelling. */
  full: Map<string, string>;
  /** Normalised surname -> the pool's spelling, only where it is unique. */
  surname: Map<string, string>;
}

/**
 * Fold a sentence the way normalizeName folds a name, so the two can be
 * compared token for token.
 *
 * The order of these is load-bearing:
 *
 *   - the possessive goes before the apostrophe does, or "Chase's" folds to
 *     "chases" and stops matching "chase";
 *   - the apostrophe goes before general punctuation, or "Ja'Marr" folds to
 *     "ja marr" and stops matching "jamarr";
 *   - a full stop after a single letter is an initial and is removed rather
 *     than spaced, so "A.J. Brown" folds to "aj brown" — but a full stop after
 *     a word is the end of a sentence and becomes a space, so "Brown. He" does
 *     not fold to "brownhe".
 */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/\b([a-z])\./g, "$1")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The pool, indexed for searching.
 *
 * A surname earns an entry only when exactly one man in the pool answers to
 * it. Two Browns and neither gets one: a headline that says "Brown" has not
 * told us which, and picking either is how a manager is shown an injury to
 * somebody else's receiver.
 */
export function buildIndex(pool: PoolPlayer[]): NameIndex {
  const full = new Map<string, string>();
  const surnames = new Map<string, string[]>();

  for (const p of pool) {
    const key = normalizeName(p.n);
    if (!key) continue;
    full.set(key, p.n);

    const parts = key.split(" ");
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1];
    if (last.length < MIN_SURNAME) continue;

    const held = surnames.get(last);
    if (held) held.push(p.n);
    else surnames.set(last, [p.n]);
  }

  const surname = new Map<string, string>();
  for (const [key, names] of surnames) {
    // Two men, no answer. Also catches the pool listing the same man twice,
    // which is harmless: both spellings point at one person, but we cannot
    // tell that from here and a miss is the safe way to be wrong.
    if (names.length === 1) surname.set(key, names[0]);
  }

  return { full, surname };
}

/**
 * The words this text wrote with a capital letter, folded.
 *
 * Used only for surname matching, where it is the difference between a
 * footballer and an adverb. Twenty-nine surnames in the real pool are also
 * ordinary English words — Likely, Long, Strong, Swift, Hunt, Chase — and
 * without this, "Chiefs likely to rest starters" is a story about Isaiah
 * Likely and "a long touchdown run" is one about Hunter Long.
 */
function capitalisedIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const first = raw.match(/[a-zA-Z]/)?.[0];
    if (!first || first !== first.toUpperCase()) continue;
    for (const token of foldText(raw).split(" ")) if (token) out.add(token);
  }
  return out;
}

/**
 * Does capitalisation in this text mean anything?
 *
 * In a sentence-case headline — "Chase questionable for Sunday" — a capital
 * marks a name. In a title-case one — "Chiefs Likely To Rest Starters" — it
 * marks every word and says nothing, so a surname read out of it is a guess.
 *
 * One ordinary lowercase word is enough to tell them apart: sentence case has
 * several and title case has none. ALL CAPS has none either, and is treated
 * as title case for the same reason.
 */
function capitalsAreMeaningful(text: string): boolean {
  return /(^|\s)[a-z]{4,}(\s|$)/.test(text.replace(/[^a-zA-Z\s]/g, " "));
}

/**
 * Everyone in the pool this text names, in the order the pool lists them.
 *
 * A first name alone is never a match. Half the pool is on first-name terms
 * with a headline writer — "Josh", "Justin", "Brian" — and none of those
 * identify anybody.
 */
export function playersIn(text: string, index: NameIndex): string[] {
  const folded = ` ${foldText(text)} `;
  if (folded.trim() === "") return [];

  const found = new Map<string, string>();

  for (const [key, name] of index.full) {
    if (folded.includes(` ${key} `)) found.set(name, name);
  }

  // A surname on its own, for the headline that says "Chase questionable" and
  // means the only Chase there is. It has to be unique in the pool, it has to
  // be capitalised, and the text has to be the sort where a capital letter
  // means something. Skipped where the full name already matched, which is
  // the common case.
  if (capitalsAreMeaningful(text)) {
    const capitals = capitalisedIn(text);
    for (const [key, name] of index.surname) {
      if (found.has(name)) continue;
      if (!capitals.has(key)) continue;
      if (folded.includes(` ${key} `)) found.set(name, name);
    }
  }

  return [...found.values()];
}

/**
 * Is this story inside the window?
 *
 * Two weeks, because a fantasy league's memory is about that long: a
 * designation from three weeks ago has either become an absence everybody
 * knows about or stopped being true, and either way it is not news. A story
 * with no date at all is not shown — an undated item sorts to the top of a
 * feed ordered by date and sits there forever.
 */
export function isFresh(published: string, now: number = Date.now()): boolean {
  const at = Date.parse(published);
  if (!Number.isFinite(at)) return false;
  const age = now - at;
  // Ahead of the clock is allowed a little: feeds and servers disagree about
  // the minute, and a story stamped four minutes from now is today's story.
  if (age < -60 * 60 * 1000) return false;
  return age <= FRESH_DAYS * 24 * 60 * 60 * 1000;
}
