import Link from "next/link";

/**
 * The way in to everything about your own franchise.
 *
 * Sits directly under the score on the home page and is deliberately the
 * widest, plainest thing there: the score raises a question, and this is where
 * every answer to it lives — the roster that produced it, the players you are
 * watching, the trade that might fix it.

 */
export default function MyTeamButton() {
  return (
    <Link
      href="/my-team"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgb(var(--accent-bright-rgb) / .5)",
        borderRadius: "var(--radius-md)",
        background: "rgb(var(--accent-rgb) / .16)",
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
            color: "var(--text)",
          }}
        >
          My Team
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 4 }}>
          Your roster, matchups, player news, watchlist and trades.
        </div>
      </div>
      <span aria-hidden style={{ color: "var(--accent-link)", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
