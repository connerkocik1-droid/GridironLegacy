import Link from "next/link";

/**
 * The games, on the way past. Three cards rather than a tab, because they are
 * something you notice and dip into rather than somewhere you navigate to.
 */
const GAMES = [
  {
    href: "/minigames?game=pickem",
    name: "Pick-'Em",
    line: "Call every game this week. The league keeps score.",
  },
  {
    href: "/minigames?game=20-0",
    name: "20-0 Mode",
    line: "Twelve rolls, two sides of the ball, one perfect season.",
  },
  {
    href: "/minigames?game=mock",
    name: "Mock Draft",
    line: "Draft night against the machine, as many times as you like.",
  },
];

export default function MiniGamesStrip() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))",
        gap: 10,
      }}
    >
      {GAMES.map((g) => (
        <Link
          key={g.href}
          href={g.href}
          style={{
            display: "block",
            border: "1px solid rgba(145,132,217,.28)",
            borderRadius: "var(--radius-md)",
            background: "rgba(35,37,50,.55)",
            padding: "13px 15px 14px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 15,
              color: "#d2cefd",
            }}
          >
            {g.name}
          </div>
          <div style={{ fontSize: 11.5, color: "#8f94a8", lineHeight: 1.55, marginTop: 4 }}>
            {g.line}
          </div>
        </Link>
      ))}
    </div>
  );
}
