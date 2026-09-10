# Handoff: Pylon Fantasy — mobile My Team

## Overview

The redesigned mobile My Team screen, pre-week (Week 1, 2026, nothing played yet). Six sections behind a sub-tab strip: Roster, Matchup, News, Watch, Trades, Edit.

The league is **best ball**, so there is no lineup setting. The roster groups by position rather than starters/bench, and each player carries a **start rate** — the share of simulated weeks they land in the optimal lineup. The players the optimal lineup would take right now are highlighted with an accent edge and a slot chip (QB, RB1, RB2, WR1, WR2, TE, FLEX, K, D/ST). Ordering is by projection before kickoff and should switch to live points once a week is running.

## About the design files

`Pylon My Team.dc.html` is a **Design Component** in the same format as the existing files in `prototype/` — same `support.js` runtime, same `<x-dc>` template + `class Component extends DCLogic` structure, same Nocturne stylesheet path (`_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/`). It is a working prototype, not production code: data lives in inline constants, not API calls.

Two ways to land it:

**A — drop it into `prototype/` as-is.** It runs unmodified next to the existing `My Team.dc.html` (which is the wide desktop version).

**B — port it into `src/`** as the real mobile My Team, using the repo's components and data layer. Treat this file as the spec.

Fidelity: **high**. Colors, type, spacing and motion are final.

## Files in this bundle

- `Pylon My Team.dc.html` — the screen. Template + logic in one file.
- `ios-frame.jsx` — iPhone bezel wrapper (`IOSDevice`). **Presentation only** — drop it when porting and let the screen fill the viewport.
- `image-slot.js` — drag-and-drop image placeholder used for the team photo on the Edit tab. Replace with a real upload control.

Not bundled (already in the repo): `prototype/support.js`, `_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/styles.css` and `_ds_bundle.js`.

## Structure

**Header (sticky)** — abbreviation tile, team name, manager name, pencil button jumping to Edit. Beneath it a four-stat row (Projected, On roster, Record, Points for), then the sub-tab strip.

**Roster** — one card per position group (QB, RB, WR, TE, K, D/ST, IR), sorted by projection. Each row: name, slot chip if in the optimal lineup, injury flag, team + role note, a start-rate bar, and the projection. Highlighted rows carry a 2px accent inset edge. IR rows read "OUT" and dim to 60%.

**Matchup** — projected total vs. opponent with a share bar and win probability, then the projected optimal lineup slot by slot against theirs.

**News** — filter chips (All / Injury / Role / Matchup) over cards tagged by kind, tinted amber for injury, accent for role, neutral for matchup.

**Watch** — tracked players with a TRACK / TRACKING toggle.

**Trades** — incoming offers with a get/give split, a one-line verdict, and Accept / Decline; below that the trade block with LIST / LISTED toggles.

**Edit** — team name, abbreviation, read-only manager, a full-width team photo drop slot; an Alerts card with four toggles; a Security card with a Change PIN button that expands current/new PIN fields; Save.

**Tab bar** — Home / My Team / League / Moves / Office, Phosphor icons, glowing accent mark on the active tab.

## Data notes

- `ROSTER` is transcribed from `src/data/league-data.js` (`STARTERS`, `BENCH`, `IR`) — same players, teams and projections. When porting, read that module directly rather than re-typing it.
- `sr` (start rate) is **authored prototype data**, not derived. Real implementation should compute it from simulated weeks.
- `optimal()` builds the best-ball lineup from projections: QB 1, RB 2, WR 2, TE 1, FLEX 2, K 1, D/ST 1 — matching `settings.starters` in `supabase/seed.sql`. IR players are excluded.
- Record and points-for read `0-0` / `0.0` pre-week-1.
- News, watchlist, trade offers and the block are prototype content built around the real roster.
- Edit-tab state (name, abbreviation, alert toggles, PIN panel) is local component state; wire to the `managers` table. The PIN flow is UI only.

## State

- `tab` — active sub-section
- `newsFilter` — All / Injury / Role / Matchup
- `nav` — active bottom tab
- `teamName`, `abbrev` — Edit fields
- `block`, `watch` — per-player toggle maps
- `alerts` — four booleans
- `pinOpen` — PIN panel expanded

## Design tokens

Nocturne, dark. Off the stylesheet where possible (`var(--color-text)`, `var(--font-heading)`, `var(--font-body)`).

- Ground `#0f111c` with two radial washes: `#23274a` top-left, `#2b1e3d` top-right
- Surfaces `rgba(22,24,38,.72)`; matchup hero `linear-gradient(160deg, rgba(38,32,64,.9), rgba(20,22,36,.86))`
- Accent `#b5abfc`; deeper `#5d5294`; accent tints `rgba(145,132,217,.08–.36)`
- Muted text `#8f94a8`, dim `#75798c`, dimmest `#595d6c`
- Warning / injury `#e0b573`; live `#ff9a5c`; positive `#7fd8a8`; negative `#e07a7a`
- Radii: 16px hero, 14px cards, 12px news, 9px inputs, 8px buttons
- Gutter 18px; card padding 14–16px; row padding 11px 13px
- Type: uppercase micro-labels 8–10px with .1–.28em tracking; body 10–13px; team name 21px; scores 30px. `font-variant-numeric: tabular-nums` on the root.

## Motion

CSS keyframes in `<helmet>`: `mt-pulse` (live dot), `mt-rise` (entrance), `mt-grow` (bars from zero), `mt-sweep` (diagonal sheen on the matchup card). Toggles transition over .2s; tab mark width over .25s.

## Suggested prompt for Claude Code

> This bundle contains a Design Component prototype of a redesigned mobile My Team screen for this repo (same format as `prototype/My Team.dc.html`). Read `README.md` first. Land it as-is in `prototype/`, then plan the port into `src/` against the real league data — see "Data notes" for what is grounded in `src/data/league-data.js` and what is prototype-only. The league is best ball: there is no lineup setting. Do not ship the `ios-frame.jsx` bezel into the app. Show me the plan before writing app code.
