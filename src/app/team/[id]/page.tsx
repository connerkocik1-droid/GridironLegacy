import Nav from "@/components/Nav";
import RosterBoard from "@/components/RosterBoard";

export const metadata = { title: "Team · Pylon Fantasy" };

/**
 * Somebody else's team, in full.
 *
 * The rosters were never private — RLS has let any manager read every roster
 * in their league since the first migration, and the trade desk has been
 * doing it all along. There was simply no page that asked, so the only way to
 * see what another franchise held was to open a trade with them.
 *
 * That is the wrong shape. Wanting to know what a rival has is the ordinary
 * state of being in a league: it is how you judge a waiver claim, work out
 * who is deep at running back before you offer anything, and understand why
 * you lost on Sunday. None of that should require pretending to make a trade.
 *
 * Read-only, and the board says so by having nothing to press.
 */
export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/the-league" />
      <RosterBoard manager={id} />
    </div>
  );
}
