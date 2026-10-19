import Nav from "@/components/Nav";
import GameCastView from "@/components/GameCastView";

export const metadata = { title: "GameCast · Pylon Fantasy" };

export default function GamesPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/games" />
      <GameCastView />
    </div>
  );
}
