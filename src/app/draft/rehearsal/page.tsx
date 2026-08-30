import Nav from "@/components/Nav";
import CommissionerOnly from "@/components/CommissionerOnly";
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
      {/* The room drives the real reveal and countdown, so it belongs to
          whoever is running draft night rather than to everyone. */}
      <CommissionerOnly
        fallback={
          <div style={{ padding: "24px 26px", color: "#9397ab" }}>
            The rehearsal room is the commissioner&apos;s.
          </div>
        }
      >
        <DraftRehearsal />
      </CommissionerOnly>
    </div>
  );
}
