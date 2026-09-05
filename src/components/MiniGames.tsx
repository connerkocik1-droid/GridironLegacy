"use client";

import { useRouter, useSearchParams } from "next/navigation";
import MiniGamesStrip from "./MiniGamesStrip";
import MockDraft from "./MockDraft";
import PickemBoard from "./PickemBoard";
import TwentyZero from "./TwentyZero";

/**
 * The three games.
 *
 * Arriving with no game named lands on the three of them, the way My Team and
 * The League land on what is behind them. Naming one opens it, and which one
 * lives in the URL rather than in state — a link to a game is a link to that
 * game, and the pick-'em deadline is the sort of thing people paste into a
 * group chat.
 */

const GAMES = [
  { id: "pickem", label: "Pick-'Em" },
  { id: "20-0", label: "20-0 Mode" },
  { id: "mock", label: "Mock Draft" },
] as const;

type GameId = (typeof GAMES)[number]["id"];

const tab = (active: boolean): React.CSSProperties => ({
  flex: "0 0 auto",
  whiteSpace: "nowrap",
  border: `1px solid ${active ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
  background: active ? "rgb(var(--accent-rgb) / .22)" : "transparent",
  color: active ? "var(--text)" : "var(--text-quiet)",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 11,
  letterSpacing: ".14em",
  textTransform: "uppercase",
  padding: "9px 16px",
  cursor: "pointer",
});

export default function MiniGames() {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("game");
  const game: GameId | null = GAMES.some((g) => g.id === asked) ? (asked as GameId) : null;

  return (
    <div>
      <div style={{ padding: "24px 26px 0" }}>
        <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>ON THE SIDE</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 16px",
            fontWeight: 500,
          }}
        >
          Mini-games
        </h1>

        {/* The tabs are for moving between games once you are in one. On the
            way in there is nothing to move between yet, and three cards say
            more about each game than three words do. */}
        {game ? (
          <div
            className="gl-scroll-x"
            style={{ display: "flex", gap: 8, flexWrap: "nowrap", paddingBottom: 2 }}
          >
            {GAMES.map((g) => (
              <button
                key={g.id}
                onClick={() => router.replace(`/minigames?game=${g.id}`, { scroll: false })}
                aria-current={g.id === game ? "page" : undefined}
                style={tab(g.id === game)}
              >
                {g.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ paddingBottom: 26 }}>
            <MiniGamesStrip />
          </div>
        )}
      </div>

      {/* One game mounted at a time. 20-0 and the mock draft both hold a lot of
          state, and keeping the loser of the tab switch alive would leave two
          half-played games running behind each other. */}
      {game === "pickem" ? <PickemBoard /> : null}
      {game === "20-0" ? <TwentyZero /> : null}
      {game === "mock" ? <MockDraft /> : null}
    </div>
  );
}
