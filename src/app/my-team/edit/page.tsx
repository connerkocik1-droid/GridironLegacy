import Nav from "@/components/Nav";
import EditTeam from "@/components/EditTeam";

export const metadata = { title: "Edit team · Pylon Fantasy" };

export default function EditTeamPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/my-team" />
      <EditTeam />
    </div>
  );
}
