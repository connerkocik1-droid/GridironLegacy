import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import WatchlistBoard from "@/components/WatchlistBoard";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Watchlist · Pylon Fantasy" };

export default function WatchlistPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/watchlist" />
      <SubTabBar tab={APP_TABS[1]} />
      <WatchlistBoard />
    </div>
  );
}
