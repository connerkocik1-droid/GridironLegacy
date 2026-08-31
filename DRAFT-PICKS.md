# Draft picks

Every franchise owns a pick in every round of every draft, and can trade the
ones that are not for this season.

## Where the order comes from

Draft position is the inverse of the record: the worst team picks first.

Precisely, franchises are sorted by win percentage ascending, then by points
scored ascending, then by franchise slot. Win percentage rather than wins, so
a franchise on a bye is not punished for having played fewer games. Points
break a tie because two 4-9 teams are not equally bad.

Before any week has been graded every record is identical and the order falls
back to the franchise slot. That is arbitrary, but it is *stable* — the
nightly run will not reshuffle the board for no reason — and it is replaced by
something real as soon as a game is settled.

The same order is used in every round. A rookie draft is not a snake.

## When it runs

`/api/cron/draft-picks`, nightly at **07:00 UTC** (`vercel.json`). That is 3am
US Eastern for the daylight-saving half of the year, 2am for the rest. Change
the hour in `vercel.json` if your league keeps different time.

The job does two things:

- **Creates** any pick that does not exist yet, for next season.
- **Reorders** the picks for that season from the current standings.

It never changes who owns a pick. A pick traded in October is still owned by
the same franchise in November, and running the job twice does nothing the
second time.

## How long a draft is

- The **inaugural** draft uses the league's own `rounds` setting (24 by
  default) — it is filling empty rosters.
- **Every draft after it** is a rookie draft and uses `rookieRounds`,
  which defaults to **5**. Set it in the league's settings JSON to change it.

## What can be traded

Picks for the inaugural season are **not** tradeable. Every later season is.

This is deliberate: trading away your first-ever draft before a ball has been
thrown is how a league loses a manager in week one. The rule is enforced in
the database, in `execute_trade`, not only in the interface — so it holds even
for an offer made days earlier.

`leagues.inaugural_season` is what decides this. It is set to the league's
season when this migration runs and should not be changed afterwards.

## Two ideas kept apart

- `origin_manager` — whose record places the pick within its round. Never
  changes. Trading your first-rounder away does not make it a better pick.
- `manager_id` — who holds it. A trade moves this and nothing else.

So "Charlie's 2027 1st" stays Charlie's 2027 1st, and falls exactly where
Charlie's season says it should, no matter how many times it changes hands.
