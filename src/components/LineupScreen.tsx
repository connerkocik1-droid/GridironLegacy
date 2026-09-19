"use client";

import { Suspense } from "react";
import MatchupBoard from "./MatchupBoard";
import Skeleton from "./Skeleton";

/**
 * The matchup, and only the matchup.
 *
 * This used to open with the reader's whole roster above the head-to-head, on
 * the reasoning that the second question after "who is scoring for me" is
 * "against what". The reasoning was right and the layout was not: the
 * head-to-head already answers the first question in its left-hand column, so
 * the roster above it was the same eleven men listed twice, and the page came
 * to just under four phone screens — the score a manager opened it for sat
 * two screens down.
 *
 * The roster went to My Team, where it now says more than this page ever did
 * about each man. What is left here is the thing this page is named for, and
 * it fits on one screen.
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
  // The heading lives inside the board, which is the only place that knows
  // whose game is being shown. Printed above it, it said "Your matchup" over a
  // fixture between two other franchises.
  return <MatchupBoard />;
}
