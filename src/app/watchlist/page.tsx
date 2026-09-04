import Nav from "@/components/Nav";
import WatchlistBoard from "@/components/WatchlistBoard";

export const metadata = { title: "Watchlist · Pylon Fantasy" };

export default function WatchlistPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/my-team" />
      <WatchlistBoard />
    </div>
  );
}
