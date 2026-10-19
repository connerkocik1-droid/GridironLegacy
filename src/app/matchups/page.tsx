import Nav from "@/components/Nav";
import Matchups from "@/components/Matchups";

export const metadata = { title: "Matchups · Pylon Fantasy" };

export default function MatchupsPage() {
  return (
    <div
      style={{ minHeight: "var(--screen)" }}
    >
      <Nav current="/matchups" />
      {/* Directly under the header and above everything else, because a
          reminder about money placed below the scores is a reminder nobody
          reads. This is now the app's landing page, so it is also where the
          notice that used to open Home still greets everyone first. */}
      <Matchups />
    </div>
  );
}
