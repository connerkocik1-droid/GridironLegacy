import Link from "next/link";

/**
 * The four things a manager comes here to do.
 *
 * Big enough to be the first thing on the page and to be hit with a thumb.
 * Each one is a place, not a panel: the home page says where everything is,
 * and the pages themselves do the work.
 */
const PLACES = [
  {
    href: "/lineup",
    name: "Lineup",
    line: "Set your starters, and see what they are playing against this week.",
  },
  {
    href: "/matchups",
    name: "Matchups",
    line: "Your season, week by week, with the score of every one. Or the whole league's.",
  },
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

export default function HomeButtons({ lineupProblems = 0 }: { lineupProblems?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
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
          {/* Counted, not named. The number is enough to make somebody click,
              and the lineup page is where the problems are actually said. */}
          {p.href === "/lineup" && lineupProblems > 0 ? (
            <div style={{ fontSize: 11.5, color: "#e0b573", marginTop: 8 }}>
              {lineupProblems === 1
                ? "1 problem with this week's lineup."
                : `${lineupProblems} problems with this week's lineup.`}
            </div>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
