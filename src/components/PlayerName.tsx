"use client";

import Link from "next/link";
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
}: {
  name: string;
  plain?: boolean;
  style?: React.CSSProperties;
  badge?: boolean;
}) {
  const label = (
    <span style={{ minWidth: 0, overflowWrap: "anywhere", ...style }}>{name}</span>
  );

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
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
      {badge ? <HealthBadge name={name} /> : null}
    </span>
  );
}
