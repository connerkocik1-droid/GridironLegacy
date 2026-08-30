import Nav from "@/components/Nav";
import NewsWire from "@/components/NewsWire";
import { fetchNews } from "@/lib/news";

export const metadata = { title: "News · Gridiron Legacy" };
// The wire is the same for everyone, so it is fetched once and shared rather
// than re-fetched per visitor.
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
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>
          THE WIRE
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 18px",
            fontWeight: 500,
          }}
        >
          NFL news
        </h1>

        <div
          style={{
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
          <NewsWire stories={stories} />
        </div>
      </div>
    </div>
  );
}
