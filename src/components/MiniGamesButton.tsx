import Link from "next/link";

/**
 * The third door, and the quietest of the three.
 *
 * Same shape as the other two so they read as a set, least contrast because
 * that is the order somebody wants them in: their own team, then the league,
 * then the games — which are the thing you dip into rather than the thing you
 * came for.
 */
export default function MiniGamesButton() {
  return (
    <Link
      href="/minigames"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgba(145,132,217,.22)",
        borderRadius: "var(--radius-md)",
        background: "rgba(26,28,43,.4)",
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
          Mini-games
        </div>
        <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.5, marginTop: 4 }}>
          Pick-&rsquo;Em, 20-0 Mode and the mock draft.
        </div>
      </div>
      <span aria-hidden style={{ color: "#b5abfc", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
