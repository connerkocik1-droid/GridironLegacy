"use client";

import Link from "next/link";
import { ageOf } from "@/data/league-data";
import { HEALTH_COLOUR, HEALTH_LABEL, HEALTH_SHORT, type Health } from "@/lib/health";
import { healthOf, useHealthReport } from "@/lib/use-player-health";

/**
 * A player's name, wherever it appears: linked to him, and carrying his
 * fitness.
 *
 * One component rather than ten, because "always" is the requirement. A badge
 * that appears on the lineup and not on the matchup is worse than no badge —
 * a manager who has learned to look for it reads its absence as "fit".
 *
 * Active is deliberately silent. Everybody not on an injury report is fit, and
 * a tick beside all sixteen names on a lineup is noise that hides the one who
 * is doubtful.
 *
 * The age is here for the same "always" reason. In a dynasty league a name
 * without an age is half a fact: the difference between a 24-year-old and a
 * 31-year-old is the whole question on a trade, a waiver claim and a keeper
 * decision, and looking it up one player at a time is how a manager stops
 * looking it up. Worked out from the date of birth every time it is drawn, so
 * it is right in June as well as in September.
 */

export function playerHref(name: string): string {
  return `/player/${encodeURIComponent(name)}`;
}

/** The badge on its own, for a row that draws its own name. */
export function HealthBadge({ name, size = "small" }: { name: string; size?: "small" | "large" }) {
  const report = useHealthReport();
  const health = healthOf(report, name);
  if (!health) return null;

  const large = size === "large";

  return (
    <span
      title={health.note ? `${health.detail} — ${health.note}` : health.detail}
      aria-label={`Status: ${HEALTH_LABEL[health.status]}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        flex: "0 0 auto",
        fontSize: large ? 11 : 10,
        letterSpacing: ".1em",
        fontWeight: 600,
        padding: large ? "3px 8px" : "1px 4px",
        borderRadius: 2,
        border: `1px solid ${HEALTH_COLOUR[health.status]}55`,
        color: HEALTH_COLOUR[health.status],
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      {large ? HEALTH_LABEL[health.status] : HEALTH_SHORT[health.status as Health]}
    </span>
  );
}

/**
 * How old he is, in the smallest thing that can still be read.
 *
 * Dim and unlabelled, because a number beside a footballer's name is his age
 * and nothing else — "AGE 24" beside sixteen names is three hundred pixels
 * spent saying a word nobody needed. Silent for a defense, and for the
 * handful of players nobody has a birthday for: a blank is honest, and a
 * guess in a column managers trade on is not.
 */
export function PlayerAge({ name }: { name: string }) {
  const age = ageOf({ n: name });
  if (age == null) return null;

  return (
    <span
      aria-label={`Age ${age}`}
      style={{
        fontSize: ".84em",
        color: "var(--text-dim)",
        fontVariantNumeric: "tabular-nums",
        flex: "0 0 auto",
      }}
    >
      {age}
    </span>
  );
}

/**
 * The name itself, as a link, with the badge after it.
 *
 * `plain` renders the name without a link, for the few places already inside
 * one — a whole row that is itself a link cannot contain another.
 */
export default function PlayerName({
  name,
  plain = false,
  style,
  badge = true,
  age = true,
}: {
  name: string;
  plain?: boolean;
  style?: React.CSSProperties;
  badge?: boolean;
  /** Off only where the row already draws the age in a column of its own. */
  age?: boolean;
}) {
  const label = (
    <span style={{ minWidth: 0, overflowWrap: "anywhere", ...style }}>{name}</span>
  );

  return (
    // Wraps, so a narrow column drops the badge below the name rather than
    // squeezing the name. The badge is flex: 0 0 auto and the name is the only
    // thing that can give, so without this a suspended player on a 320px
    // screen reads one letter per line — which measures as fitting.
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 6,
        rowGap: 2,
        minWidth: 0,
      }}
    >
      {plain ? (
        label
      ) : (
        <Link
          href={playerHref(name)}
          style={{
            color: "inherit",
            textDecoration: "none",
            minWidth: 0,
            // The visual box is the text; the tap target is a thumb. The
            // negative margin gives back exactly what the padding took, so a
            // name that is now pressable does not push its row taller.
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 0",
            margin: "-6px 0",
          }}
        >
          {label}
        </Link>
      )}
      {age ? <PlayerAge name={name} /> : null}
      {badge ? <HealthBadge name={name} /> : null}
    </span>
  );
}
