import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import PlayerRankings from "@/components/PlayerRankings";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Player rankings · Pylon Fantasy" };

export default function RankingsPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/rankings" />
      <SubTabBar tab={APP_TABS[2]} />
      <PlayerRankings />
    </div>
  );
}
