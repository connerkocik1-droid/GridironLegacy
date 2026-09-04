import Nav from "@/components/Nav";
import MyTeamHub from "@/components/MyTeamHub";

export const metadata = { title: "My Team · Pylon Fantasy" };

export default function MyTeamPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/my-team" />
      <MyTeamHub />
    </div>
  );
}
