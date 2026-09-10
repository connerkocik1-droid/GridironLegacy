# Handoff: Pylon Fantasy — mobile League

## Overview

The mobile League screen. Seven sections behind a sub-tab strip, ordered by use: **Overview, Standings, Chat, Moves, News, Ranks, Rules**.

The defining property of this screen: **almost nothing is authored prose**. Headlines, trade grades, matchup reads and the three rotating Overview cards are all generated from two tables (weekly scores, player scoring vs. draft position). Pushing a real week of results into those tables rewrites the page. Treat the generators as the spec — they are the part worth porting carefully.

State of the season in the prototype: **Week 4, three weeks graded.**

## About the design files

`Pylon League.dc.html` is a **Design Component** in the same format as the files in `prototype/` — same `support.js` runtime, same `<x-dc>` template + `class Component extends DCLogic` structure, same Nocturne stylesheet path (`_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/`). It runs unmodified in `prototype/`; port into `src/` using this file as the spec.

Fidelity: **high**. Colors, type, spacing and motion are final.

## Files in this bundle

- `Pylon League.dc.html` — the screen. Template + logic in one file.
- `ios-frame.jsx` — iPhone bezel wrapper (`IOSDevice`). **Presentation only** — drop it when porting.
- `image-slot.js` — drag-and-drop image placeholder standing in for player headshots. Replace with your real headshot source, keyed by player id.

Not bundled (already in the repo): `prototype/support.js`, `_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/styles.css` and `_ds_bundle.js`.

## The two source tables

Everything derives from these. In the real app they are queries, not constants.

**`SCHEDULE`** — array of weeks, each an array of `[teamIndex, teamIndex]` pairings. `WEEK` marks the current (unplayed) week.

**`SCORES`** — per franchise, an array of weekly point totals for graded weeks.

**`PLAYERS`** — per player: `n` (name), `pos`, `t` (NFL team), `pre` (preseason positional rank), `wk` (weekly fantasy points).

**`TEAMS`** — franchise, owner, division, power score. From `supabase/seed.sql`.

### Derived helpers

| Function | What it returns |
| --- | --- |
| `total(p)` | Player's season points |
| `currentRank(p)` | Player's current positional rank, by points |
| `table()` | Per franchise: results array, W/L, active streak + kind, points for |
| `slotId(name)` | Stable headshot slot id (`hs-zay-flowers`) |

## Section by section

### Overview

**Three rotating cards**, auto-advancing every 6.5s, dots to jump. All computed:

1. **Best Value** — the player with the largest gain against preseason positional rank. Large headshot, `WR31 → WR3 ▲28`, points / per-game / overall rank, and a generated sentence.
2. **Hot Streak** — every team tied at the longest *active* win streak (handles ties and the single-leader case in one code path). W/L pips per week, record, points for.
3. **MVP** — top three scorers league-wide as compact rows with gold / silver / bronze medals, headshot, points tinted to the medal.

Below: a **live wire ticker** of recent moves, then the **week 4 slate** — tap any game to expand a win-probability bar, the spread, and a generated read that differs for tight / normal / lopsided gaps. The user's own matchup is highlighted.

### Standings

Toggles **Divisions** (North / South, ordered by record then points for) and **Power** (league-wide power score). Records, PF and bars all come from `table()`.

### Chat

Bubbles, own messages right-aligned, tap-to-toggle reactions with live counts, typing indicator, working input.

### Moves

A move record is only `{kind, who, when, player, side, cost}`. The grade and write-up are **generated**: the player's rank movement decides `STEAL` (≥10 spots to the acquirer) / `SHARP` (≥3) / `EVEN` / `RISKY` (≤−3), and the sentence states points scored, current rank, draft rank and which side the value moved toward. Filterable by kind.

### News

Five item types, each generated from the week's numbers: highest single week, biggest riser, longest streak, points-for leader, and any winless teams. No authored headlines.

### Ranks

Consensus board, position-filterable, sorted by projection, with ▲▼ movement against board order.

### Rules

Accordion — the one place authored text is correct, since league rules don't fluctuate. Drawn from `DRAFT-PICKS.md` and `supabase/seed.sql` settings.

## What to wire when porting

1. **`SCORES` / `SCHEDULE`** → real matchup and scoring tables. Everything else follows.
2. **`PLAYERS.pre`** → preseason positional rank from your draft board (`src/data/board-leaders.js` has ADP for the top of the board). `wk` → weekly fantasy points.
3. **Headshots** → replace `<image-slot>` with your image source, keyed by the same `slotId(name)` scheme.
4. **Chat** → real messages and reactions; the prototype keeps them in component state.
5. **Moves** → your transaction log; keep the record thin and let the generator write the copy.
6. **Power score** → currently authored per franchise in `TEAMS`; compute it from roster projection, depth and age.

## Behaviour worth preserving

- Every generated sentence branches on the data (ties, single leaders, winless teams, lopsided vs. tight games). Don't collapse those branches into one string.
- Overview rotation pauses implicitly when the user is on another tab (the interval checks `tab === "Overview"`).
- Records read `0-0` and points `0.0` when no weeks are graded — the empty state is already handled.

## State

`tab`, `nav`, `standingsMode`, `moveFilter`, `posFilter`, `openRule`, `openGame`, `story` (rotation index), `reacts`, `draft`, `sent`.

## Design tokens

Nocturne, dark. Use `var(--color-text)`, `var(--font-heading)`, `var(--font-body)` where available.

- Ground `#0f111c` with radial washes `#23274a` top-left, `#2b1e3d` top-right
- Surfaces `rgba(22,24,38,.72)`; hero card `linear-gradient(160deg, rgba(38,32,64,.92), rgba(20,22,36,.86))`
- Accent `#b5abfc`, deeper `#5d5294`, tints `rgba(145,132,217,.06–.36)`
- Muted `#a8adc0` / `#8f94a8` / `#75798c` / `#595d6c`
- Positive `#7fd8a8`, negative `#e07a7a`, warning `#e0b573`, live `#ff9a5c`
- Medals: gold `#e8c56a` (`#f0d488→#b8892f`), silver `#c4cad6` (`#d8dde7→#8b93a3`), bronze `#cd9060` (`#e0a878→#96603a`)
- Radii 16 hero / 14 cards / 12 items / 10 rows / 8 buttons; gutter 18px
- Micro-labels 8–10px at .1–.28em tracking; body 11–13px; `tabular-nums` on the root

## Motion

`lg-pulse` (live dots), `lg-rise` (card and row entrances), `lg-grow` (bars from zero), `lg-sweep` (sheen across the hero), `lg-marquee` (wire ticker, 30s), `lg-blink` (typing dots).

## Suggested prompt for Claude Code

> This bundle contains a Design Component prototype of the mobile League screen for this repo (same format as `prototype/`). Read `README.md` first. Land it in `prototype/` unchanged, then plan the port into `src/`. The important part is that headlines, trade grades and the three rotating Overview cards are GENERATED from two data tables, not authored — see "The two source tables" and "What to wire when porting". Preserve the generators and their branching. Do not ship `ios-frame.jsx`. Show me the plan before writing app code.
