import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import TradeDesk from "@/components/TradeDesk";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Trade builder · Pylon Fantasy" };

export default function TradeBuilderPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/trade-builder" />
      <SubTabBar tab={APP_TABS[1]} />
      <TradeDesk />
    </div>
  );
}
