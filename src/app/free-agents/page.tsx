import Nav from "@/components/Nav";
import PlayersBoard from "@/components/PlayersBoard";

export const metadata = { title: "Free agents · Pylon Fantasy" };

export default function FreeAgentsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/free-agents" />
      <PlayersBoard />
    </div>
  );
}
