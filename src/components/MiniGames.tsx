"use client";

import { useRouter, useSearchParams } from "next/navigation";
import MockDraft from "./MockDraft";
import PickemBoard from "./PickemBoard";
import TwentyZero from "./TwentyZero";

/**
 * The three games, behind one tab.
 *
 * Which game is showing lives in the URL rather than in state, so a link to a
 * game is a link to that game — the pick-'em deadline is the sort of thing
 * people paste into a group chat.
 */

const GAMES = [
  { id: "pickem", label: "Pick-'Em" },
  { id: "20-0", label: "20-0 Mode" },
  { id: "mock", label: "Mock Draft" },
] as const;

type GameId = (typeof GAMES)[number]["id"];

const tab = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: active ? "rgba(145,132,217,.22)" : "transparent",
  color: active ? "#e9e9ed" : "#8f94a8",
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
  const game: GameId = GAMES.some((g) => g.id === asked) ? (asked as GameId) : "pickem";

  return (
    <div>
      <div style={{ padding: "24px 26px 0" }}>
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>ON THE SIDE</div>
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

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
