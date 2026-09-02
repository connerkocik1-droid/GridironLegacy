import Link from "next/link";

/**
 * The way in to everything about your own franchise.
 *
 * Sits directly under the score on the home page and is deliberately the
 * widest, plainest thing there: the score raises a question, and this is where
 * every answer to it lives — the lineup that produced it, the players you are
 * watching, the trade that might fix it.
 *
 * Carries the lineup warning because that is the one thing behind it that is
 * urgent rather than merely available. Counted, not named: the number is
 * enough to make somebody press it, and the lineup page is where the problems
 * are actually said.
 */
export default function MyTeamButton({ lineupProblems = 0 }: { lineupProblems?: number }) {
  return (
    <Link
      href="/my-team"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgba(181,171,252,.5)",
        borderRadius: "var(--radius-md)",
        background: "rgba(145,132,217,.16)",
        padding: "16px 18px",
        margin: "14px 0 4px",
        textDecoration: "none",
        color: "inherit",
        minHeight: 34,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            letterSpacing: "-.02em",
            color: "#e9e9ed",
          }}
        >
          My Team
        </div>
        <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.5, marginTop: 4 }}>
          Lineup, matchups, your player news, watchlist and trades.
        </div>
        {lineupProblems > 0 ? (
          <div style={{ fontSize: 11.5, color: "#e0b573", marginTop: 7 }}>
            {lineupProblems === 1
              ? "1 problem with this week's lineup."
              : `${lineupProblems} problems with this week's lineup.`}
          </div>
        ) : null}
      </div>
      <span aria-hidden style={{ color: "#b5abfc", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
