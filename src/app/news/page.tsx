import { Suspense } from "react";
import Nav from "@/components/Nav";
import NewsWire from "@/components/NewsWire";
import PlayerNewsFilter from "@/components/PlayerNewsFilter";
import { fetchNews } from "@/lib/news";

export const metadata = { title: "News · Gridiron Legacy" };
// The wire is the same for everyone, so it is fetched once and shared rather
// than re-fetched per visitor. Only the roster it is matched against is
// per-manager, and that is fetched in the client.
export const revalidate = 900;

export default async function NewsPage() {
  const stories = await fetchNews();

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/news" />

      <div style={{ padding: "24px 26px 40px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>THE WIRE</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 18px",
            fontWeight: 500,
          }}
        >
          News
        </h1>

        {/* The filter reads the view from the URL, which needs a boundary
            while the page is served from the shared cache. */}
        <Suspense fallback={<div style={{ color: "#75798c", fontSize: 12 }}>Loading…</div>}>
          <PlayerNewsFilter stories={stories}>
            <NewsWire stories={stories} />
          </PlayerNewsFilter>
        </Suspense>
      </div>
    </div>
  );
}
