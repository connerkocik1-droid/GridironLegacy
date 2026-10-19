import { Suspense } from "react";
import Nav from "@/components/Nav";
import SubTabBar from "@/components/SubTabBar";
import MiniGames from "@/components/MiniGames";
import { APP_TABS } from "@/lib/app-tabs";

export const metadata = { title: "Mini-games · Pylon Fantasy" };

export default function MiniGamesPage() {
  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/minigames" />
      <SubTabBar tab={APP_TABS[1]} />
      {/* useSearchParams needs a boundary to fall back to while the URL is
          being read on the client. */}
      <Suspense fallback={<div style={{ padding: "24px 26px", color: "var(--text-dim)" }}>Loading…</div>}>
        <MiniGames />
      </Suspense>
    </div>
  );
}
