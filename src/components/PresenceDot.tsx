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
export default function PresenceDot({
  online,
  who,
  size = 7,
}: {
  online: boolean;
  /** Whose presence, for a screen reader. Omitted where the row says it. */
  who?: string;
  size?: number;
}) {
  const label = online
    ? who
      ? `${who} is here now`
      : "Here now"
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
