import Nav from "@/components/Nav";
import WatchlistBoard from "@/components/WatchlistBoard";

export const metadata = { title: "Watchlist · Pylon Fantasy" };

export default function WatchlistPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/watchlist" />
      <WatchlistBoard />
    </div>
  );
}
