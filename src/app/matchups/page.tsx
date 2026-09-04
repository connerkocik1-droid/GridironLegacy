import Nav from "@/components/Nav";
import Matchups from "@/components/Matchups";

export const metadata = { title: "Matchups · Pylon Fantasy" };

export default function MatchupsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/matchups" />
      <Matchups />
    </div>
  );
}
