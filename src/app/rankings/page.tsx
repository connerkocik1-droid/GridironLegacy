import Nav from "@/components/Nav";
import PlayerRankings from "@/components/PlayerRankings";

export const metadata = { title: "Player rankings · Pylon Fantasy" };

export default function RankingsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/rankings" />
      <PlayerRankings />
    </div>
  );
}
