import Nav from "@/components/Nav";
import PlayersView from "@/components/PlayersView";

export const metadata = { title: "Players · Pylon Fantasy" };

export default function RankingsPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/rankings" />
      <PlayersView />
    </div>
  );
}
