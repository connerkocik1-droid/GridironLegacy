import GamesBoard from "@/components/GamesBoard";
import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "NFL Gamecast · Pylon Fantasy" };

/**
 * The week's real football, before you pick a game out of it.
 *
 * /game/[id] is one game in full. This is the way in: every fixture in the
 * week, in kickoff order, with the ones your own players are in marked.
 */
export default function GamesPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/games" />
      <SubTabBar tab={APP_TABS[0]} />
      <GamesBoard />
    </div>
  );
}
