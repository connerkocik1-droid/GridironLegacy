# Handoff: Pylon Fantasy — mobile Home

## Overview

A redesign of the fantasy app's mobile Home screen for the pre-week state (Week 1, 2026, before any games are played). It replaces the sparse matchup + mini-games link with a live NFL ticker, a ticking kickoff countdown, a rivalry-framed matchup hero that pages across the next five weeks, a power-rank movers list, and a row of mini-game tiles.

## About the design files

`Pylon Home.dc.html` is a **Design Component** in the same format as the existing files in `prototype/` — same `support.js` runtime, same `<x-dc>` template + `class Component extends DCLogic` structure, same Nocturne stylesheet path (`_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/`). It is a working prototype, not production code: the data is inline constants, not API calls.

Two ways to land it:

**A — drop it into `prototype/` as-is.** It runs unmodified next to `Home.dc.html`. Copy both files in; it becomes the mobile counterpart to the existing desktop Home.

**B — port it into `src/`** (Next.js app) as the real mobile Home, using the repo's existing components and data layer. In that case treat the DC file as the spec.

Fidelity: **high**. Colors, type, spacing and motion are final.

## Files in this bundle

- `Pylon Home.dc.html` — the screen. Template + logic in one file.
- `ios-frame.jsx` — the iPhone bezel wrapper (`IOSDevice`). **Presentation only.** It exists so the design reads as a phone screen; drop it when porting into the real app and let the screen fill the viewport.

Not bundled (already in the repo / project): `prototype/support.js`, `_ds/nocturne-a15a1733-bc9c-441e-a8c1-6f7c4c14cee0/styles.css` and `_ds_bundle.js`.

## Structure, top to bottom

1. **Header** (sticky) — orange pylon mark, `PYLON FANTASY` wordmark (accent on the second word), notification bell with a pulsing unread dot, avatar.
2. **NFL ticker** — full-width marquee of Week 1 games (`DAL @ PHI · THU 8:20 PM` …), 34s linear loop, list duplicated for a seamless wrap, edge fade masks left and right. Every 8th dot pulses orange to mark the next game.
3. **Kickoff countdown** — `KICKOFF IN 2D 05:41:33`, orange, ticks every second off a target timestamp.
4. **Matchup hero** — the centerpiece. Week label, home/away, and a `‹ 1/5 ›` pager stepping through the next five opponents. Each shows both team names + owners, projected totals, a share bar (your projected share of the two totals) with `YOU FAVORED` / `UNDERDOG` and a win probability, then three stats and a one-line stakes sentence.
5. **Power rank** — five rows (expandable to 12): rank, team name, owner first name, a score bar, `AVG AGE` and points-for, and a ▲/▼ movement chip (green up, red down, em dash for no change). The user's own row is tinted.
6. **Mini-games** — three tiles: Pick-'Em, 20-0 Mode, Mock Draft (10-team SF).
7. **Tab bar** — Home / My Team / League / Moves / Office, Phosphor icons, active tab gets a tint plus a glowing 34px accent mark that animates in along the top edge.

## Dynamic values — important

Three values are computed, not written, so they stay honest pre-season and move on their own once results exist. Wire these to real data when porting.

| Value | Source in the prototype | Behavior |
| --- | --- | --- |
| Opponent record | `RESULTS[team]` — array of `"W"`/`"L"`, one per completed week | Empty pre-week-1, so renders `0-0` |
| Points-for gap | `SEASON_PF[team]` — array of weekly point totals | Empty pre-week-1, so renders `0.0`; signed `+`/`−` once populated |
| Team points-for (power rank) | same `SEASON_PF` | `0.0` pre-week-1 |

Everything else (projections, average roster age, power score, stakes copy) is static prototype data.

## State

- `i` — matchup pager index, 0–4
- `expanded` — power rank showing 5 vs. 12
- `tab` — active bottom tab
- `left` — ms until kickoff, updated on a 1s interval, cleared on unmount

## Design tokens

Nocturne, dark. Off the stylesheet where possible (`var(--color-text)`, `var(--font-heading)`, `var(--font-body)`).

- Ground `#0f111c` with two radial washes: `#23274a` top-left, `#2b1e3d` top-right
- Surfaces `rgba(22,24,38,.72)`; hero `linear-gradient(160deg, rgba(38,32,64,.9), rgba(20,22,36,.86))`
- Accent `#b5abfc`; deeper `#5d5294`; accent tints `rgba(145,132,217,.12–.36)` for fills and borders
- Muted text `#8f94a8`, dim `#75798c`, dimmest `#595d6c`
- Live/alert orange `#ff9a5c`; pylon mark `#ffb066 → #e0682a`
- Up `#7fd8a8`, down `#e07a7a`
- Radii: 16px hero, 14px list, 12px tiles, 10px inset panel, 7px pager buttons
- Gutter 18px; card padding 16–18px; row padding 11px 13px
- Type: uppercase micro-labels at 8–10px with .12–.34em tracking; body 11–13px; team names 18px; scores 34px. `font-variant-numeric: tabular-nums` set on the root so numbers don't jitter as they tick.

## Motion

All CSS keyframes, defined in `<helmet>`.

- `pf-marquee` — ticker, 34s linear infinite
- `pf-pulse` — live dots, 1.4–1.7s ease infinite (opacity + scale)
- `pf-sweep` — 6s diagonal sheen across the hero card
- `pf-rise` — hero entrance, .5s
- `pf-grow` — bars grow from zero on mount, .8–.9s
- Share bar also transitions `width` over .6s `cubic-bezier(.2,.8,.2,1)` when the pager changes
- Tab mark animates `width` 0 → 34px over .25s

## Interactions

- Pager `‹`/`›` wrap around the five matchups; all stats, bars and copy swap together.
- `ALL 12 TEAMS` / `SHOW TOP 5` toggles the power rank.
- Tab bar switches the active tab visually only (no routing in the prototype).
- Mini-game tiles are `<a href="#">` with a hover state — point them at `20-0 Mode.dc.html` and the Pick-'Em / mock-draft routes.

## Suggested prompt for Claude Code

> This bundle contains a Design Component prototype of a redesigned mobile Home screen for this repo (same format as `prototype/Home.dc.html`). Read `README.md` first. Land it as `prototype/Pylon Home.dc.html` unchanged, then tell me what it would take to port it into `src/` against the real league data — specifically the three dynamic values documented under "Dynamic values". Do not ship the `ios-frame.jsx` bezel into the app.
