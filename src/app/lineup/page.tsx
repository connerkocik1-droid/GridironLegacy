import MatchupBoard from "@/components/MatchupBoard";
import RosterBoard from "@/components/RosterBoard";
import Nav from "@/components/Nav";

export const metadata = { title: "My team · Pylon Fantasy" };

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
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/lineup" />
      <RosterBoard />

      {/* The heading lives inside the board, which is the only place that
          knows whose game is being shown. Printed here it said "Your matchup"
          over a fixture between two other franchises. */}
      <MatchupBoard />
    </div>
  );
}
