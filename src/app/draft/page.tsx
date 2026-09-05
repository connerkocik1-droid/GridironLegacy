import Nav from "@/components/Nav";
import DraftRoom from "@/components/DraftRoom";

export const metadata = { title: "Draft · Pylon Fantasy" };

export default function DraftPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <Nav current="/draft" />
      <DraftRoom />
    </div>
  );
}
