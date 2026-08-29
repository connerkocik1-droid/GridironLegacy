import Nav from "@/components/Nav";
import MatchupBoard from "@/components/MatchupBoard";

export const metadata = { title: "Matchup · Gridiron Legacy" };

export default function MatchupPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/matchup" />
      <MatchupBoard />
    </div>
  );
}
