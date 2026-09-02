/**
 * Matching ESPN's names to the league's names.
 *
 * The two lists are written by different people. Our pool says
 * "Marvin Harrison Jr."; ESPN's box score has said "Marvin Harrison Jr",
 * "Marvin Harrison Jr." and, on a bad afternoon, "M. Harrison Jr.". Seventy of
 * the five hundred and eighty-five players in the pool carry a suffix, an
 * apostrophe, a hyphen or an initial with a full stop — twelve per cent of it,
 * which is far too much to leave to string equality.
 *
 * A miss here is silent and expensive: the player simply scores nothing, and
 * the manager who started him sees a zero he has no way to argue with. So the
 * comparison happens on a normalised key rather than on the names themselves.
 */

/** Suffixes that are part of a legal name but never part of an identity. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * The key two spellings of the same player share.
 *
 * Accents are folded, punctuation is dropped rather than turned into a space —
 * "Ja'Marr" and "JaMarr" have to land together, and so do "A.J." and "AJ" —
 * and trailing generational suffixes come off, because ESPN drops them about
 * as often as it keeps them.
 *
 * Hyphens are the exception: they separate two names rather than joining a
 * contraction, so "Smith-Njigba" becomes "smith njigba" and still matches a
 * spelling with a space.
 */
export function normalizeName(name: string): string {
  const folded = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // combining accents
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'") // curly apostrophes ESPN sometimes emits
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = folded.split(" ");

  // Trailing suffixes come off, but never the whole name: "Vonn Bell" must not
  // be eaten down to "vonn" — "bell" is not a suffix — and a player somehow
  // listed as just "III" keeps what he has.
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();

  return parts.join(" ");
}

/** "Baltimore Ravens D/ST" — the unit, not a person. */
export function isDefense(name: string): boolean {
  return /\bD\/ST\b/i.test(name);
}

/** "Baltimore Ravens D/ST" -> "Baltimore Ravens". */
export function defenseTeamName(name: string): string {
  return name.replace(/\s*D\/ST\s*$/i, "").trim();
}

export interface NameMatch {
  /** The league's own spelling, which is what every table is keyed by. */
  poolName: string;
}

/**
 * A lookup from any spelling of a name to the league's spelling of it.
 *
 * Built from the roster rather than the static pool: a waiver pickup who was
 * never in the draftable five hundred still has to score.
 */
export class NameIndex {
  private byKey = new Map<string, string>();

  /** Names that normalise onto a key another name already holds. */
  readonly collisions: string[] = [];

  constructor(names: Iterable<string>) {
    for (const name of names) {
      if (isDefense(name)) continue; // units are matched by team, not by name
      const key = normalizeName(name);
      if (!key) continue;

      const held = this.byKey.get(key);
      if (held && held !== name) {
        // Two rostered players sharing a normalised key is rare and would make
        // one of them score the other's points. The first spelling keeps the
        // key and the second is reported, because a wrong score is worse than
        // a missing one and somebody has to be told.
        this.collisions.push(name);
        continue;
      }
      this.byKey.set(key, name);
    }
  }

  /** The league's spelling of whatever ESPN called him, or null. */
  lookup(espnName: string): string | null {
    return this.byKey.get(normalizeName(espnName)) ?? null;
  }

  has(espnName: string): boolean {
    return this.byKey.has(normalizeName(espnName));
  }

  get size(): number {
    return this.byKey.size;
  }
}
