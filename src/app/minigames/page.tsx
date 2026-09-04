import { Suspense } from "react";
import Nav from "@/components/Nav";
import MiniGames from "@/components/MiniGames";

export const metadata = { title: "Mini-games · Pylon Fantasy" };

export default function MiniGamesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/minigames" />
      {/* useSearchParams needs a boundary to fall back to while the URL is
          being read on the client. */}
      <Suspense fallback={<div style={{ padding: "24px 26px", color: "var(--text-dim)" }}>Loading…</div>}>
        <MiniGames />
      </Suspense>
    </div>
  );
}
