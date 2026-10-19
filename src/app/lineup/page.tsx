import Nav from "@/components/Nav";
import MatchupView from "@/components/MatchupView";
import WeekRecap from "@/components/WeekRecap";

export const metadata = { title: "Matchup · Pylon Fantasy" };

/** The League → Matchup, where the app opens. */
export default function LineupPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      {/* Over the whole page, on the first open after the NFL week ends. Here
          because this is where the app opens now, and the recap is the first
          thing a manager should see after a week. */}
      <WeekRecap />
      <Nav current="/lineup" />
      <MatchupView />
    </div>
  );
}
