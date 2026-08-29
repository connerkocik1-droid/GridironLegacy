import Nav from "@/components/Nav";
import MyTeamBoard from "@/components/MyTeamBoard";

export const metadata = { title: "My Team · Gridiron Legacy" };

export default function MyTeamPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/my-team" />
      <MyTeamBoard />
    </div>
  );
}
