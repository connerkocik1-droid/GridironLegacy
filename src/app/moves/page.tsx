import MovesTabs from "@/components/MovesTabs";
import Nav from "@/components/Nav";

export const metadata = { title: "Moves · Pylon Fantasy" };

/**
 * The three screens where a roster changes, behind one tab.
 *
 * Reachable whether or not the draft is done: the tab that leads here only
 * appears afterwards, but draft-pick trades happen before a draft and the
 * League hub points at this page throughout.
 */
export default function MovesPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/moves" />
      <MovesTabs />
    </div>
  );
}
