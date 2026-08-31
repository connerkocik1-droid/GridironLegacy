import Nav from "@/components/Nav";
import MockDraft from "@/components/MockDraft";

export const metadata = { title: "Mock draft · Gridiron Legacy" };

export default function MockDraftPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/draft/mock" />
      <MockDraft />
    </div>
  );
}
