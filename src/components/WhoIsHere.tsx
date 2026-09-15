import PresenceDot from "./PresenceDot";
import { firstNames } from "@/lib/first-names";
import type { PowerRow } from "@/lib/home-types";

/**
 * Who else is in the app right now, across the top of Home.
 *
 * The dot beside a franchise name in the power rank answers "is this manager
 * about" once you have already gone looking for that manager. This answers the
 * question nobody had to ask for: the league is twelve people and knowing that
 * three of them are on their phones right now is what makes a trade worth
 * sending this minute rather than tomorrow.
 *
 * First names, not franchises. A franchise is who you play; a first name is
 * who is there.
 */

export default function WhoIsHere({ power }: { power: PowerRow[] }) {
  const here = power.filter((p) => p.online);
  // Nobody is here, not even the reader: presence is not being recorded, and a
  // strip that says "here now" with nothing after it reads as a broken feature
  // rather than as an empty league. Say nothing instead.
  if (!here.length) return null;

  // Yourself first, so the row starts from somewhere known and a reader can
  // see the thing is live before reading anybody else's name.
  const ordered = [...here].sort((a, b) => Number(b.mine) - Number(a.mine));
  const labels = firstNames(ordered.map((p) => p.name));
  const others = ordered.filter((p) => !p.mine).length;

  return (
    <div
      aria-label={
        others === 0
          ? "Nobody else is in the app right now"
          : `${others} other ${others === 1 ? "manager is" : "managers are"} in the app right now`
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        // The row scrolls rather than wraps: twelve names must not push the
        // matchup off the first screen on a phone.
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none",
        padding: "9px 18px",
        borderBottom: "1px solid rgb(var(--accent-rgb) / .14)",
        background: "rgb(var(--surface-rgb) / .45)",
      }}
    >
      <span
        style={{
          // Ten, not nine: the audit's floor for readable text on a phone, and
          // this label is the only thing saying what the row of names is.
          fontSize: 10,
          letterSpacing: ".24em",
          color: "var(--text-dim)",
          flex: "0 0 auto",
        }}
      >
        HERE NOW
      </span>

      {ordered.map((p, i) => (
        <span
          key={p.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            flex: "0 0 auto",
            fontSize: 12.5,
            color: p.mine ? "var(--text-dim)" : "var(--text)",
          }}
        >
          <PresenceDot online who={p.name} />
          {labels[i]}
          {p.mine ? <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>you</span> : null}
        </span>
      ))}

      {others === 0 ? (
        <span style={{ fontSize: 11.5, color: "var(--text-faint)", flex: "0 0 auto" }}>
          — nobody else is about
        </span>
      ) : null}
    </div>
  );
}
