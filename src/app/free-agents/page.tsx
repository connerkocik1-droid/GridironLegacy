import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import PlayersBoard from "@/components/PlayersBoard";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Free agents · Pylon Fantasy" };

export default function FreeAgentsPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/free-agents" />
      <SubTabBar tab={APP_TABS[1]} />
      <PlayersBoard />
    </div>
  );
}
