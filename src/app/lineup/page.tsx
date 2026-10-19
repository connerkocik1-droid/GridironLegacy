import Nav from "@/components/Nav";
import MatchupView from "@/components/MatchupView";

export const metadata = { title: "Matchup · Pylon Fantasy" };

/** The League → Matchup, where the app opens. */
export default function LineupPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/lineup" />
      <MatchupView />
    </div>
  );
}
