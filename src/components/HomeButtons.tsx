import Link from "next/link";

/**
 * The league's own places.
 *
 * Lineup and Matchups used to be here and are now behind My Team, with the
 * rest of what belongs to one franchise. The split is by ownership: what is
 * yours is one button up the page, and what is everybody's is here.
 *
 * Each one is a place, not a panel: the home page says where things are, and
 * the pages themselves do the work.
 */
const PLACES = [
  {
    href: "/standings",
    name: "Standings",
    line: "The table, by division.",
  },
  {
    href: "/rankings",
    name: "Player rankings",
    line: "Every player in the pool, by position, with the numbers behind them.",
  },
];

export default function HomeButtons() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))",
        gap: 10,
      }}
    >
      {PLACES.map((p) => (
        <Link
          key={p.href}
          href={p.href}
          style={{
            display: "block",
            border: "1px solid rgba(181,171,252,.4)",
            borderRadius: "var(--radius-md)",
            background: "rgba(145,132,217,.12)",
            padding: "18px 18px 19px",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 21,
              letterSpacing: "-.02em",
              color: "#e9e9ed",
            }}
          >
            {p.name}
          </div>
          <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.55, marginTop: 6 }}>
            {p.line}
          </div>
        </Link>
      ))}
    </div>
  );
}
