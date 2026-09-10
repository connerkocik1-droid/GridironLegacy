import Link from "next/link";

/**
 * The door to the real football.
 *
 * Same shape as the other three so they read as a set. It sits with them
 * rather than beside the ticker because it is a place to go, and the ticker is
 * a thing to glance at — pressing a sliding cell to reach a specific game is a
 * moving target, which is not how anybody wants to choose what to watch.
 */
export default function GamecastButton() {
  return (
    <Link
      href="/games"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        border: "1px solid rgb(var(--accent-rgb) / .22)",
        borderRadius: "var(--radius-md)",
        background: "rgb(var(--surface-rgb) / .4)",
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
            color: "var(--text)",
          }}
        >
          NFL Gamecast
        </div>
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 4 }}>
          Every game this week, and which of them your players are in.
        </div>
      </div>
      <span aria-hidden style={{ color: "var(--accent-link)", fontSize: 18, flex: "0 0 auto" }}>
        →
      </span>
    </Link>
  );
}
