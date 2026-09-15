/**
 * First names for a row of people, kept distinguishable.
 *
 * A presence strip says who is about, and who is about is a person rather than
 * a franchise — "Dana is here" is what a manager reads, not "Bay Area Brawlers
 * is here". But a league of twelve friends usually has two of some name, and
 * two identical chips side by side is worse than no chips: it says somebody is
 * about without saying who.
 *
 * So a name is shortened only as far as it can be while still telling the row
 * apart. A repeat picks up its last initial; a repeat with no surname to draw
 * one from stays as it is, because inventing a distinguisher would be worse
 * than admitting there is not one.
 */
export function firstNames(names: string[]): string[] {
  const parts = names.map((n) => n.trim().split(/\s+/).filter(Boolean));
  const first = parts.map((p, i) => p[0] ?? names[i].trim());

  const count = new Map<string, number>();
  for (const f of first) count.set(f, (count.get(f) ?? 0) + 1);

  return first.map((f, i) => {
    if ((count.get(f) ?? 0) < 2) return f;
    const surname = parts[i].slice(1).join(" ");
    return surname ? `${f} ${surname[0].toUpperCase()}.` : f;
  });
}
