import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import PlayersBoard from "@/components/PlayersBoard";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Free agents · Pylon Fantasy" };

export default function FreeAgentsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/free-agents" />
      <SubTabBar tab={APP_TABS[1]} />
      <PlayersBoard />
    </div>
  );
}
