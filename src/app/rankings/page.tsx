import Nav from "@/components/Nav";
import PlayerRankings from "@/components/PlayerRankings";

export const metadata = { title: "Player rankings · Pylon Fantasy" };

export default function RankingsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/rankings" />
      <PlayerRankings />
    </div>
  );
}
