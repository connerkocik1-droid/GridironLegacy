import Nav from "@/components/Nav";
import Matchups from "@/components/Matchups";

export const metadata = { title: "Matchups · Gridiron Legacy" };

export default function MatchupsPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/matchups" />
      <Matchups />
    </div>
  );
}
