# Age modifiers

This is a dynasty league, so a thirty-year-old back who will score 250 points
is not worth the same as a twenty-three-year-old who will score 250 points.
One has two seasons left and the other has five.

Every board in the app is ordered by an age-adjusted ADP rather than the raw
consensus one: the draft room, the free-agent list, the mock draft, the
rehearsal room, and the clock when it takes a pick for somebody who missed it.

## The numbers

They come from `Dynasty_Draft_Modifiers.xlsx`, extracted verbatim to
`src/data/dynasty-modifiers.json`. The unit tests read that file and check
every one of its 68 rows against the code, so the two cannot drift apart.

A modifier above 1 makes a player more valuable. ADP counts the other way — a
lower number is an earlier pick — so it is applied by dividing:

```
dynasty ADP = ADP ÷ modifier
```

A 1.2 on ADP 24 becomes 20. A 0.8 on ADP 100 becomes 125.

## Two things the sheet does not say

**Quarterbacks have no row for 32.** The sheet lists 31 (1.00) and then 33
(0.95). Ages are read as bands that run until the next row, so 32 sits inside
the one 31 opened and keeps 1.00. That is the reading that changes least. If
the league meant 32 to be 0.95, add the row to the spreadsheet and re-extract.

**Defences are not in the sheet at all**, which is right — a defence does not
have a birthday. They are never adjusted.

## Players with no age

The pool knows an age for 474 of its 585 players. The rest — mostly rookies —
are left exactly where the consensus put them. Guessing at an unknown age
would move somebody up or down the board on no evidence, which is worse than
not moving them.

## Changing them

Edit the spreadsheet, then re-extract it to
`src/data/dynasty-modifiers.json`, then update the bands in
`src/lib/dynasty.ts` to match. The tests will fail until they agree, which is
the point.
