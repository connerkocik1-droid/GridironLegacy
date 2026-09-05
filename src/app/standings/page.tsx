import Nav from "@/components/Nav";
import Standings from "@/components/Standings";

export const metadata = { title: "Standings · Pylon Fantasy" };

export default function StandingsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/standings" />
      <Standings />
    </div>
  );
}
