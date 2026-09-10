"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MatchupBoard from "./MatchupBoard";
import RosterBoard from "./RosterBoard";
import Skeleton from "./Skeleton";

/**
 * Your roster and what it is playing into — or, when the address names
 * somebody else's fixture, only that fixture.
 *
 * Pressing a game between two other franchises used to land here with the
 * reader's own roster filling the screen and the game they had asked for
 * somewhere below it. That is the same page answering a question nobody put
 * to it: the tap said "show me Kim against Priya", and the answer opened with
 * eighteen of the reader's own players.
 *
 * `home` in the address is what distinguishes the two. It is set only by a
 * link to a fixture the reader is not in — choosing an opponent from the
 * board's own dropdown sets `opponent` alone, which is still your game and
 * still wants your roster above it.
 */
export default function LineupScreen() {
  // Reading the address needs a boundary while the page is served static.
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Screen />
    </Suspense>
  );
}

function Screen() {
  const params = useSearchParams();
  const elsewhere = Boolean(params.get("home"));

  return (
    <>
      {elsewhere ? null : <RosterBoard />}

      {/* The heading lives inside the board, which is the only place that
          knows whose game is being shown. Printed above it, it said "Your
          matchup" over a fixture between two other franchises. */}
      <MatchupBoard />
    </>
  );
}
