/**
 * The part of a manager's name that belongs on a scoreboard.
 *
 * Managers sign up with a first name, but a name typed into a box is whatever
 * somebody typed — "Conner", "Conner K", or the whole thing. The first word of
 * it is the part that fits beside a franchise either way, and it is the part
 * eleven other people call them.
 *
 * Written once because it is a rule about this league's names rather than
 * about any one screen: the home page's scoreboard and the draft lottery both
 * ask the same question and must not answer it differently.
 */
export function firstName(name: string | null | undefined): string {
  const said = (name ?? "").trim();
  if (!said) return "";
  return said.split(/\s+/)[0] || said;
}
