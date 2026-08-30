import Nav from "@/components/Nav";
import PlayersBoard from "@/components/PlayersBoard";

export const metadata = { title: "Free agents · Gridiron Legacy" };

export default function PlayersPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/players" />
      <PlayersBoard />
    </div>
  );
}
