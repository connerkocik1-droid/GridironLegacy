import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import LeaguePowerBoard from "@/components/LeaguePowerBoard";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "League Power · Pylon Fantasy" };

export default function LeaguePowerPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/league-power" />
      <SubTabBar tab={APP_TABS[2]} />
      <LeaguePowerBoard />
    </div>
  );
}
