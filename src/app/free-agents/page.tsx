import Nav from "@/components/Nav";
import FreeAgencyView from "@/components/FreeAgencyView";

export const metadata = { title: "Free Agency · Pylon Fantasy" };

export default function FreeAgentsPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/free-agents" />
      <FreeAgencyView />
    </div>
  );
}
