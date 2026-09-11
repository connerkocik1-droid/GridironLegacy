# Handoff: Pylon Fantasy — mobile Moves

## Overview

The mobile Moves screen. Three sections behind a sub-tab strip: **Free Agents, Trade Builder, The Record.**

Like the League screen, the copy here is **generated, not authored** — transaction detail lines, waiver countdowns, trade verdicts and pick values are all computed. The important structural idea: **the transaction log is the single source of truth for ownership.** `POOL` holds each player's owner *before* the log is applied; `TX` is replayed oldest-first over it to produce current rosters, the free-agent pool and waiver status. That is why the three tabs cannot contradict each other, and it is the behaviour to preserve when porting.

Season state in the prototype: **Week 4, three weeks graded.**

## About the design files

`Pylon Moves.dc.html` is a **Design Component** in the same format as the files in `prototype/` — same `support.js` runtime, same `<x-dc>` template + `class Component extends DCLogic` structure, same Nocturne stylesheet path (`_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/`). It runs unmodified in `prototype/`; port into `src/` using this file as the spec.

Fidelity: **high**. Colors, type, spacing and motion are final.

## Files in this bundle

- `Pylon Moves.dc.html` — the screen. Template + logic in one file.
- `ios-frame.jsx` — iPhone bezel wrapper (`IOSDevice`). **Presentation only** — drop it when porting.

Not bundled (already in the repo): `prototype/support.js`, `_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/styles.css` and `_ds_bundle.js`.

## The six generated features

These are the point of the screen. Each is computed, and each branches — do not flatten a branch into a single string.

| Feature | Where | How it's derived |
| --- | --- | --- |
| Live waiver clock | Header | Real countdown to the next 3:00 AM run, ticking each second |
| Trending strip | Free Agents | Most-moved players from \`TX\`, net adds minus drops, color-coded |
| Roster-need callout | Free Agents | Three-tier ladder, always renders — see below |
| Fit chips | Free Agents rows | \`FILLS <POS>\` / \`STARTER\` / \`OVER <NAME>\` from the same comparison |
| Partner fit ranking | Trade Builder | \`fitScore\` — only the top scorer gets the ◆, none if nobody scores |
| Trade auto-balancer | Trade Builder | Finds the single pick nearest the gap; suppressed unless it lands within 8 points |

### The roster-need ladder

Falls through in order, so something always shows:

1. **ROSTER HOLE** (amber) — a starting slot is unfilled.
2. **STARTER UPGRADE** (amber) — a free agent's per-game beats your weakest starter at that position.
3. **BENCH UPGRADE** (green) — a free agent beats the worst player you are holding.
4. **NO UPGRADES** (grey) — explicit empty state naming your weakest roster spot.

On a strong roster tiers 1 and 2 rarely fire, which is why 3 and 4 exist. An earlier version compared only against starters and rendered nothing almost every week.

### \`fitScore\` semantics

A position counts only when **one side is genuinely short and the other genuinely deep**:

\`\`\`
if (myDepth < need && theirDepth > need) score += min(need - myDepth, theirDepth - need)
if (theirDepth < need && myDepth > need) score += min(need - theirDepth, myDepth - need)
\`\`\`

Crediting surplus alone makes every manager a "best fit" and the badge meaningless.

## Read this before porting

Three things will not survive a mechanical port.

**1. The data is fabricated.** \`POOL\` holds invented players with invented weekly scores, and \`OWNERS\` uses seeded franchise names. Every field has to be mapped onto the real schema. A port that compiles while showing invented numbers is the most likely failure mode — wire the data first, then judge the screen.

**2. The generators are the product.** Each generated sentence and badge branches on the data. Flattening those branches into one string is easy and removes the reason the screen exists. Specific traps, each of which was a real bug caught in review:

- A badge that renders on every row carries no information — thresholds must be relative (top scorer), not absolute.
- A suggestion the data cannot satisfy is worse than no suggestion — guard it.
- An insight tier that never triggers on a strong roster renders an invisible module — always provide the fall-through.

**3. The ownership replay is a design decision.** If the backend already stores current rosters, the natural move is to read those and delete the replay. That holds until a trade and a waiver claim land in the same nightly run and the three tabs disagree. Keep one source of truth.

## Suggested order of work

1. Land \`Pylon Moves.dc.html\` in \`prototype/\` unchanged and look at it in the real app shell.
2. Map \`POOL\` / \`TX\` to real queries. Stop and check the numbers.
3. Port the generators one at a time, keeping the branches.
4. Wire the action buttons last — a successful claim appends to \`TX\` and the replay does the rest.

## Source tables

**`POOL`** — one row per player: `[name, pos, nflTeam, ownerIndexBeforeLog, preseasonPositionalRank, wk1, wk2, wk3, rostered%]`. `-1` means free agent at the start of the window.

**`TX`** — the transaction log: `{kind, player, by, from|to, h}` where `h` is hours ago. Kinds: `ADDED`, `CLAIM`, `RECEIVED`, `SENT`, `DROP`.

**`OWNERS`** — franchise index → "Team · Manager". From `supabase/seed.sql`.

`ME` is the current user's franchise index. `WEEK` / `PLAYED` set the season position.

### The replay

```
TX sorted oldest-first, then for each row:
  DROP      → owner = -1, waiver clock = 24h − hoursAgo (null once elapsed)
  SENT      → owner = t.to
  otherwise → owner = t.by
```

This is the whole ownership model. Rosters, the free-agent list and the amber "on waivers" state all read out of it. Waivers run nightly (3:00 AM), matching the league rule that a dropped player sits one day before release.

### Derived helpers

| Function | Returns |
| --- | --- |
| `total(p)` | Player's season points |
| `rank(p)` | Current positional rank by points |
| `stamp(h)` | Relative timestamp (`40M`, `4H`, `YDAY`, `MON`) |
| `dayOf(h)` | Day-group label (`TODAY` / `YESTERDAY` / `EARLIER`) |
| `draftOrder()` | Franchise indices ordered weakest-first by roster points |
| `picksFor(owner)` | That franchise's 2027 R1–R5 picks with derived slot and value |

## Section by section

### Free Agents

Position filters (All / QB / RB / WR / TE) and sort by **Points / Trend / Rostered**. Each row carries a three-week bar chart of actual scoring, points-per-game, rostered percentage, and a status line giving current positional rank against draft rank.

The meaningful distinction: a player dropped inside the last 24h shows an **amber left edge**, "clears in Nh", and a `CLAIM` button. Everyone else is a plain `ADD`. Both derive from the replay — no authored flag.

Trend is `wk3 − mean(wk1, wk2)`, shown as ▲/▼ only past a ±2 threshold.

### Trade Builder

Pick a partner from the chip row, then tap to select on either side. Four selectable pools: your players, your 2027 picks (R1–R5), their players, their picks.

- **Player value** = season points scored.
- **Pick value** = derived from round and draft slot: `((6 − round) / 5) × (30 + (10 − slot) × 2.5)`, where slot comes from `draftOrder()` — inverse of roster strength, matching `DRAFT-PICKS.md`. A pick is worth more to a weak team because it lands earlier.
- **Verdict** is generated from the difference: under 5 points reads as even; otherwise it names who is ahead and by how much.

2027 is the first tradeable year — inaugural-season picks stay untradeable per the league rules, so they are not offered here.

The balance bar and totals update live; `SEND OFFER` is disabled until something is selected.

### The Record

Every transaction, newest first, grouped by derived day label. Five color codes, each also drawn as a left edge on the row:

| Kind | Color |
| --- | --- |
| `ADDED` (free agency) | `#7fd8a8` green |
| `CLAIM` (waivers) | `#e0b573` amber |
| `RECEIVED` (trade in) | `#b5abfc` accent |
| `SENT` (trade out) | `#8f94a8` grey |
| `DROP` | `#e07a7a` red |

Filter chips isolate any single kind. Each detail line is generated: who did what, the counterparty for trades, and what that player has scored since — so the log doubles as a value record rather than a bare audit trail.

## What to wire when porting

1. **`POOL` / `TX`** → real player and transaction tables. Keep the replay; do not store current ownership denormalised alongside a log that can disagree with it.
2. **`h` (hours ago)** → real timestamps. `stamp` / `dayOf` become date formatting.
3. **Waiver window** → currently 24h from the drop; read it from league settings.
4. **Pick value** → the formula is a reasonable default, not gospel. If you adopt a real value chart, keep the derivation from live standings so values move as the season does.
5. **`rostered%`** → real league-wide roster rates.
6. **Claim / add / offer buttons** → currently local state; wire to the transaction endpoint. A successful claim should append to `TX`, and the replay handles the rest.

## Behaviour worth preserving

- Ownership derives from the log, in one place.
- The waiver-vs-free-agent split is computed, and the row's whole treatment (edge, button label, status text) follows from it.
- Generated sentences branch on the data — even trades, lopsided trades, empty selection — rather than resolving to one string.

## State

`tab`, `nav`, `pos`, `txFilter`, `sort`, `partner`, `send` (players and picks keyed together), `get`, `claimed`, `offered`.

Pick selections key as `pick:<owner>:2027:<round>` so players and picks share one selection map.

## Design tokens

Nocturne, dark. Use `var(--color-text)`, `var(--font-heading)`, `var(--font-body)` where available.

- Ground `#0f111c` with radial washes `#23274a` top-left, `#2b1e3d` top-right
- Surfaces `rgba(22,24,38,.72)`; trade summary `linear-gradient(160deg, rgba(38,32,64,.9), rgba(20,22,36,.86))`
- Accent `#b5abfc`, deeper `#5d5294`, tints `rgba(145,132,217,.13–.36)`
- Muted `#b2b6ca` / `#8f94a8` / `#75798c` / `#595d6c`
- Transaction colors as tabulated above
- Radii 14 cards / 9–10 picks and buttons / 7 row buttons / 5 checkboxes; gutter 18px
- Micro-labels 7–10px at .08–.24em tracking; body 9–13px; `tabular-nums` on the root

## Motion

`mv-pulse` (waiver dot), `mv-rise`, `mv-grow` (bars from zero), `mv-sweep` (sheen across the trade summary). The balance bar transitions width over .4s `cubic-bezier(.2,.8,.2,1)`.

## Suggested prompt for Claude Code

> This bundle contains a Design Component prototype of the mobile Moves screen for this repo (same format as `prototype/`). Read `README.md` first. Land it in `prototype/` unchanged, then plan the port into `src/`. The critical design decision: the transaction log is the single source of truth — current rosters, the free-agent pool and waiver status are all DERIVED by replaying it, and pick values derive from live standings. Preserve that model rather than storing ownership separately. Do not ship `ios-frame.jsx`. Show me the plan before writing app code.
