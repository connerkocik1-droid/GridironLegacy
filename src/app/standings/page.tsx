import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import Standings from "@/components/Standings";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Standings · Pylon Fantasy" };

export default function StandingsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/standings" />
      <SubTabBar tab={APP_TABS[0]} />
      <Standings />
    </div>
  );
}
