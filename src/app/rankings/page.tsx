import Nav from "@/components/Nav";
import PlayerRankings from "@/components/PlayerRankings";

export const metadata = { title: "Player rankings · Pylon Fantasy" };

export default function RankingsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/rankings" />
      <PlayerRankings />
    </div>
  );
}
