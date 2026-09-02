import Link from "next/link";

/**
 * The other door, beside the one to your own franchise.
 *
 * Deliberately quieter than My Team: the split is by ownership, and on a
 * Sunday what a manager wants is almost always theirs rather than everybody's.
 * Same shape so the pair reads as a pair, less contrast so the order of the
 * two is obvious without anybody having to think about it.
 */
export default function TheLeagueButton() {
  return (
    <Link
      href="/the-league"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgba(145,132,217,.3)",
        borderRadius: "var(--radius-md)",
        background: "rgba(26,28,43,.55)",
        padding: "16px 18px",
        margin: "10px 0 4px",
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
          The League
        </div>
        <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.5, marginTop: 4 }}>
          Standings, the overview, league news, rankings and free agents.
        </div>
      </div>
      <span aria-hidden style={{ color: "#b5abfc", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
