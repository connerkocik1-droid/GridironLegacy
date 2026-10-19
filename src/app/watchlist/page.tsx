import Nav from "@/components/Nav";
import WatchlistView from "@/components/WatchlistView";

export const metadata = { title: "Watchlist · Pylon Fantasy" };

export default function WatchlistPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/watchlist" />
      <WatchlistView />
    </div>
  );
}
