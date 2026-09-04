import MatchupBoard from "@/components/MatchupBoard";
import RosterBoard from "@/components/RosterBoard";
import Nav from "@/components/Nav";

export const metadata = { title: "My team · Gridiron Legacy" };

/**
 * Your roster and what it is playing into, on one page.
 *
 * These were two tabs once, and the second question a manager has after "who
 * is scoring for me" is always "against what". Nobody sets a lineup in this
 * league, so the first half is a roster rather than an editor — but the pair
 * of questions is the same pair.
 */
export default function LineupPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/lineup" />
      <RosterBoard />

      <div
        style={{
          margin: "8px 26px 0",
          paddingTop: 22,
          borderTop: "1px solid rgba(145,132,217,.18)",
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>THIS WEEK</div>
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            letterSpacing: "-.02em",
            fontWeight: 500,
            margin: "5px 0 0",
          }}
        >
          Your matchup
        </h2>
      </div>
      <MatchupBoard />
    </div>
  );
}
