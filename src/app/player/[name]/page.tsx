import Nav from "@/components/Nav";
import PlayerProfileBoard from "@/components/PlayerProfileBoard";
import { resolvePlayerName } from "@/lib/player-profile";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  return { title: `${resolvePlayerName(decodeURIComponent(name))} · Pylon Fantasy` };
}

export default async function PlayerPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="" />
      <PlayerProfileBoard name={decodeURIComponent(name)} />
    </div>
  );
}
