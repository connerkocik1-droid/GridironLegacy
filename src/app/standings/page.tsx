import Nav from "@/components/Nav";
import Standings from "@/components/Standings";

export const metadata = { title: "Standings · Gridiron Legacy" };

export default function StandingsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/standings" />
      <Standings />
    </div>
  );
}
