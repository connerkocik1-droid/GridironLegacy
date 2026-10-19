import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import MyTeamBoard from "@/components/MyTeamBoard";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "My Team · Pylon Fantasy" };

export default function MyTeamPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/my-team" />
      <SubTabBar tab={APP_TABS[0]} />
      <MyTeamBoard />
    </div>
  );
}
