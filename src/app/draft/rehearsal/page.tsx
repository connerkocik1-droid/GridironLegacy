import Nav from "@/components/Nav";
import DraftRehearsal from "@/components/DraftRehearsal";

export const metadata = { title: "Draft rehearsal · Gridiron Legacy" };

export default function DraftRehearsalPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/draft/rehearsal" />
      <DraftRehearsal />
    </div>
  );
}
