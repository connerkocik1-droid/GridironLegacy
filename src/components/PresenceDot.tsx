/**
 * Whether a manager is in the app right now.
 *
 * Always drawn, both ways round. A dot that appears only for the people who
 * are here makes the eleven who are not look like a different kind of row —
 * and leaves a reader unable to tell "nobody is about" from "this app does not
 * show that". Grey and flat is a real answer.
 *
 * The animation lives in globals.css because it has to be switchable by
 * prefers-reduced-motion, and an inline style would outrank the media query.
 */
import { lastActive } from "@/lib/presence";

export default function PresenceDot({
  online,
  who,
  lastSeenAt,
  size = 7,
}: {
  online: boolean;
  /** Whose presence, for a screen reader. Omitted where the row says it. */
  who?: string;
  /** When they were last in the app, which makes "not here" mean something. */
  lastSeenAt?: string | null;
  size?: number;
}) {
  // "Alpha is not here" is true of a manager who left five minutes ago and of
  // one who has not opened the app since August, and those are not the same
  // fact. When there is a stamp, the label says which.
  const last = online ? null : lastActive(lastSeenAt);
  const label = online
    ? who
      ? `${who} is here now`
      : "Here now"
    : last
      ? who
        ? `${who} was last here ${last.long.replace("Last active ", "")}`
        : last.long
      : who
        ? `${who} is not here`
        : "Not here";

  return (
    <span
      className={`gl-presence${online ? " is-on" : ""}`}
      role="img"
      aria-label={label}
      title={label}
      style={size === 7 ? undefined : { width: size, height: size }}
    />
  );
}

/**
 * The two or three characters beside the dot: 3h, 2d, Sep 4.
 *
 * Short because both places it goes are dense tables where the franchise name
 * is already fighting for the line. The dot's own tooltip carries the sentence
 * for anybody who wants it, so this can afford to be terse.
 *
 * Nothing at all for somebody who is here — the dot is lit, which is the whole
 * answer — and nothing for a manager with no stamp, because a duration we do
 * not have is not one to invent.
 */
export function LastActive({
  online,
  lastSeenAt,
}: {
  online: boolean;
  lastSeenAt?: string | null;
}) {
  const last = online ? null : lastActive(lastSeenAt);
  if (!last) return null;

  return (
    <span
      // aria-hidden because the dot beside it already says this in a sentence,
      // and a screen reader should not read the same fact twice per row.
      aria-hidden
      // Ten, which is this app's floor for text somebody is meant to read —
      // the layout audit refuses anything under it, and was right to: nine and
      // a half is a size you notice rather than one you read.
      style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: ".02em" }}
    >
      {" "}
      {last.short}
    </span>
  );
}
