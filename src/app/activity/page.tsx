import Nav from "@/components/Nav";
import TransactionsView from "@/components/TransactionsView";

export const metadata = { title: "Transactions · Pylon Fantasy" };

export default function ActivityPage() {
  return (
    <div style={{ minHeight: "var(--screen)" }}>
      <Nav current="/activity" />
      <TransactionsView />
    </div>
  );
}
