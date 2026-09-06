import GamecastBoard from "@/components/GamecastBoard";
import Nav from "@/components/Nav";

export const metadata = { title: "Gamecast · Pylon Fantasy" };

/**
 * One real football game, with this league laid over it.
 *
 * Reached from the score ticker on the home page. It is deliberately a page
 * rather than an expanding panel: on a Sunday a manager watches one game for
 * twenty minutes, and a screen you can leave and come back to — with an
 * address you can send to the group chat — is worth more than one that
 * collapses the moment you touch anything else.
 */
export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/" />
      <GamecastBoard id={id} />
    </div>
  );
}
