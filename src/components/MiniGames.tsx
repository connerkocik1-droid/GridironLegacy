"use client";

import { useRouter, useSearchParams } from "next/navigation";
import MiniGamesStrip from "./MiniGamesStrip";
import MockDraft from "./MockDraft";
import PickemBoard from "./PickemBoard";
import TwentyZero from "./TwentyZero";
import { AppView, Chips } from "./RowList";

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


export default function MiniGames() {
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("game");
  const game: GameId | null = GAMES.some((g) => g.id === asked) ? (asked as GameId) : null;

  return (
    <div>
      <AppView>
        {/* Tiles on the way in; once in a game, chips to move between them. */}
        {game ? (
          <Chips
            label="Mini-game"
            value={game}
            onChange={(id) => router.replace(`/minigames?game=${id}`, { scroll: false })}
            options={GAMES.map((g) => ({ value: g.id, label: g.label }))}
          />
        ) : (
          <MiniGamesStrip />
        )}
      </AppView>

      {/* One game mounted at a time. 20-0 and the mock draft both hold a lot of
          state, and keeping the loser of the tab switch alive would leave two
          half-played games running behind each other. */}
      {game === "pickem" ? <PickemBoard /> : null}
      {game === "20-0" ? <TwentyZero /> : null}
      {game === "mock" ? <MockDraft /> : null}
    </div>
  );
}
