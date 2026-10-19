import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import DuesNotice from "@/components/DuesNotice";
import Matchups from "@/components/Matchups";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Matchups · Pylon Fantasy" };

export default function MatchupsPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/matchups" />
      <SubTabBar tab={APP_TABS[0]} />
      {/* Directly under the header and above everything else, because a
          reminder about money placed below the scores is a reminder nobody
          reads. This is now the app's landing page, so it is also where the
          notice that used to open Home still greets everyone first. */}
      <DuesNotice />
      <Matchups />
    </div>
  );
}
