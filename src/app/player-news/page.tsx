import Nav from "@/components/Nav";
import NewsWire from "@/components/NewsWire";
import PlayerNewsFilter from "@/components/PlayerNewsFilter";
import { fetchNews } from "@/lib/news";

export const metadata = { title: "Player News · Gridiron Legacy" };
export const revalidate = 900;

/**
 * The same wire as /news, but the roster it is matched against is per-manager,
 * so the filtering happens in the client against a roster it fetches. The
 * stories themselves are still fetched once on the server and shared.
 */
export default async function PlayerNewsPage() {
  const stories = await fetchNews();

  return (
    <div
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgba(66,58,106,.4),transparent 60%),#161826",
      }}
    >
      <Nav current="/player-news" />

      <div style={{ padding: "24px 26px 40px" }}>
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>YOUR PLAYERS</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 18px",
            fontWeight: 500,
          }}
        >
          Player news
        </h1>

        <PlayerNewsFilter stories={stories}>
          <NewsWire stories={stories} />
        </PlayerNewsFilter>
      </div>
    </div>
  );
}
