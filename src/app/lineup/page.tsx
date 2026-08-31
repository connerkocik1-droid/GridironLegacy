import MatchupBoard from "@/components/MatchupBoard";
import MyTeamBoard from "@/components/MyTeamBoard";
import Nav from "@/components/Nav";

export const metadata = { title: "My lineup · Gridiron Legacy" };

/**
 * Setting the lineup and seeing what it is playing into, on one page.
 *
 * These were two tabs once, and the second question a manager has after
 * "who am I starting" is always "against what".
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
      <MyTeamBoard />

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
