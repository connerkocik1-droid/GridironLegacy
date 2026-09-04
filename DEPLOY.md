# Pylon Fantasy — going live

Everything below assumes you want the same product you have now, running on the
public internet, for twelve real managers, with live ESPN scoring. It is written
so a competent web developer can follow it start to finish, and so you can
follow along and know what is happening.

Read section 0 and section 1 before writing any code. The rest is in order.

---

## 0. What you actually have

Take an inventory before you move anything, because the value is not spread
evenly across these files.

### The valuable part — ports over untouched

| File | What it holds |
| --- | --- |
| `league-data.js` | The 585-player pool with consensus ADP, positional ranks, bye weeks, injury designations, archetypes and insights. Plus 2025 passing/rushing/receiving/kicking/defense production, depth-chart roles, ages and experience, team and NFL name tables, and the art loaders. |
| `league-sim.js` | The draft replay (`buildLeague`), best-legal-lineup solver (`startersOf`), scoring projection (`proj`), dynasty valuation (`dynastyValue`), and pick valuation. |
| `league-settings.js` | League rules, divisions, draft schedule, lottery, trade block, season shape, and the IndexedDB video store. |
| `twenty-zero-data.js` | The 20-0 minigame pools, 2002–2025, QB/RB/WR/TE/DL/LB/DB, scored per position. |
| `board-leaders.js` | The home page's board leaders. |
| `logos.state.json` | 32 NFL team marks as data URLs. |
| `headshots.state.json` | ~510 player headshots as WebP data URLs (~2 MB). |
| `ages.state.json` | Age and experience for ~3,000 players. |
| `nfl-draft-chime.mp3` | The pick-in chime. |

This is months of data work. None of it is coupled to the environment it was
built in — it is plain ES modules and JSON. **It all survives.**

### The part that gets rebuilt

| File | Why |
| --- | --- |
| `*.dc.html` (11 pages) | Each page is a template plus a logic class, rendered by a runtime (`support.js`) that lives in this environment. The *logic* survives almost verbatim; the *template* becomes JSX. |
| `support.js` | The runtime. Not yours to ship — you replace it with React. |
| `_ds/nocturne-…/` | The Nocturne design system stylesheet. Copy `styles.css` across; it is a normal stylesheet. |

### The part that must be replaced outright

**All persistence.** Everything currently lives in the browser:

| Key | Holds | Store |
| --- | --- | --- |
| `gl.manager` | The signed-in manager | localStorage |
| `gl.accounts` | All accounts, keyed by league slot | localStorage |
| `gl.league` | Divisions, draft date, lottery order, roster rules, ready flags | localStorage |
| `gl.block` | The trade block | localStorage |
| `gl.trades` | Executed trade log | localStorage |
| `gl-media` → `files` → `intro` | The draft intro video | IndexedDB |

This is the single biggest gap between what you have and a live league. Right
now, if twelve people opened the site, each would get a **private, separate
league** — their own accounts, their own rosters, their own draft. Nothing is
shared. Section 5 fixes this and it is not optional.

---

## 1. Decisions to make before you start

**1.1 — Is this public or private?**
NFL team marks and player headshots are licensed material. A private league
among friends is one thing; a public site is another. Decide now, because it
changes whether you ship `logos.state.json` at all. If public, swap the marks
for your own generic position/team glyphs and drop the headshots to initials.

**1.2 — Are you paying for hosting?**
The stack below runs free at twelve users. Vercel's hobby tier and Supabase's
free tier both comfortably cover one league. You will pay when you exceed them,
not before.

**1.3 — Who is the commissioner?**
One account holds league administration. It is set in `league-settings.js` as
`commissionerSlot` and defaults to `HELX`. In the live version this becomes a
column on the accounts table.

**1.4 — Do you need the draft to be truly live?**
Twelve people watching one board with one clock, seeing each other's picks in
real time, is a genuinely harder problem than the rest of the site combined.
Supabase Realtime handles it, and section 7 covers it. If you are willing to run
the draft with everyone in a voice call and the commissioner entering picks,
you can skip section 7 entirely and save yourself a week.

---

## 2. Set up the repository

```bash
mkdir pylon-fantasy && cd pylon-fantasy
npx create-next-app@latest . --typescript --app --no-tailwind --eslint
git init && git add -A && git commit -m "scaffold"
```

Create the folders you will need:

```bash
mkdir -p src/data src/lib src/components public/assets supabase
```

---

## 3. Move the data across — do this first

This is the step that preserves everything, and it is almost entirely file
copying. Do it before any UI work, so that if you stall on the UI the valuable
part is already safe in a repo.

**3.1 — Copy the modules.**

```bash
# from your export of this project
cp league-data.js league-sim.js league-settings.js \
   twenty-zero-data.js board-leaders.js  ./src/data/
```

They are ES modules already. Next.js imports them as-is:

```js
import { POOL, statLine, teamName } from "@/data/league-data";
```

**3.2 — Get the images out of JSON and into real files.**

`headshots.state.json` is a ~2 MB object of data URLs. Shipping that as a single
JSON blob means every visitor downloads all 510 headshots before seeing one.
Explode it into files:

```js
// scripts/extract-images.mjs — run once with: node scripts/extract-images.mjs
import fs from "node:fs";
import path from "node:path";

for (const [src, dir] of [
  ["headshots.state.json", "public/assets/headshots"],
  ["logos.state.json", "public/assets/logos"]
]) {
  fs.mkdirSync(dir, { recursive: true });
  const map = JSON.parse(fs.readFileSync(src, "utf8"));
  const index = {};
  for (const [key, dataUrl] of Object.entries(map)) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!m) continue;
    const [, ext, b64] = m;
    const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const file = `${slug}.${ext}`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(b64, "base64"));
    index[key] = file;
  }
  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index));
  console.log(dir, Object.keys(index).length, "files");
}
```

Then rewrite the two loaders in `league-data.js` so `headshot(name)` and
`logo(abbr)` return `/assets/headshots/<file>` instead of a data URL, reading
the small `index.json` rather than the 2 MB blob.

**3.3 — Copy the remaining assets.**

```bash
cp nfl-draft-chime.mp3 public/assets/
cp _ds/nocturne-*/styles.css src/app/nocturne.css
```

Import the stylesheet once in `src/app/layout.tsx`.

**3.4 — Commit.**

```bash
git add -A && git commit -m "data layer: pool, sim, settings, images"
```

At this point everything of value is preserved and version-controlled. The rest
is rebuilding a shell around it.

---

## 4. Port the pages

Each `.dc.html` file has two halves. The mapping is mechanical:

| In the `.dc.html` | Becomes |
| --- | --- |
| The template (markup between `<x-dc>` tags) | JSX in a React component's return |
| `class Component extends DCLogic` | A React component — the class body ports nearly verbatim |
| `renderVals()` | The body of the component, before `return` |
| `{{ someValue }}` | `{someValue}` |
| `<sc-for list={{ rows }} as="r">…</sc-for>` | `{rows.map(r => …)}` |
| `<sc-if value={{ flag }}>…</sc-if>` | `{flag && (…)}` |
| `style="color:red;font-size:12px"` | `style={{ color: "red", fontSize: 12 }}` |
| `onClick="{{ handler }}"` | `onClick={handler}` |

**Do this one page at a time, in this order** — each is more useful than the
last, and you can deploy after any of them:

1. **`My Team.dc.html`** — smallest surface, exercises the data layer end to end.
2. **`League.dc.html`** — read-only, proves `buildLeague` and `startersOf`.
3. **`Matchup.dc.html`** — read-only, proves `proj`.
4. **`Home.dc.html`** — has the pre/post-draft toggle.
5. **`Sign Up.dc.html`** — first page needing the database (section 5).
6. **`Trades.dc.html`** — needs the database for shared state.
7. **`Commissioner.dc.html`** — needs the database and admin auth.
8. **`Pylon Fantasy.dc.html`** — the draft room, hardest, needs realtime.
9. **`News.dc.html`**, **`Player News.dc.html`** — need the server-side reader (section 6).
10. **`20-0 Mode.dc.html`** — self-contained, no shared state; port whenever.

The style values are already inline objects in the logic classes (they are
built as strings today) — most convert with a small helper, or leave them as
strings and use `style={parseStyle(str)}`. Do not rewrite the visual design
during the port. Port first, then change things.

---

## 5. The database — accounts, rosters, and shared league state

This is the part that turns twelve private copies into one league.

**5.1 — Create a Supabase project** at supabase.com, then:

```bash
npm install @supabase/supabase-js @supabase/ssr
```

**5.2 — Schema.** Run this in the Supabase SQL editor:

```sql
-- One row per league. You will have one, but do not hard-code that.
create table leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  season int not null default 2026,
  commissioner_slot text,
  settings jsonb not null default '{}'::jsonb,   -- everything league-settings.js holds
  lottery_order text[],
  draft_at timestamptz,
  created_at timestamptz default now()
);

-- One row per manager. slot is the franchise code: STL, BLZ, HELX…
create table managers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  slot text not null,
  name text not null,
  franchise text not null,
  pin_hash text,                                  -- null = must set a new PIN
  is_commissioner boolean default false,
  ready boolean default false,
  created_at timestamptz default now(),
  unique (league_id, slot)
);

-- One row per rostered player. This replaces buildLeague at runtime:
-- buildLeague seeds it once, then it is the source of truth.
create table roster_slots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  manager_id uuid references managers(id) on delete cascade,
  player_name text not null,
  acquired text not null default 'draft',         -- draft | trade | waiver
  overall_pick int,
  lineup_slot text,                               -- QB, RB, FLEX, BENCH, IR…
  unique (league_id, player_name)
);

create table draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  overall int not null,
  round int not null,
  manager_id uuid references managers(id),
  player_name text,
  picked_at timestamptz,
  unique (league_id, overall)
);

create table trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid references leagues(id) on delete cascade,
  from_manager uuid references managers(id),
  to_manager uuid references managers(id),
  offer jsonb not null,                           -- { give: [...], get: [...] }
  status text not null default 'open',            -- open | countered | agreed | executed | declined
  from_accepted boolean default false,
  to_accepted boolean default false,
  thread jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  executed_at timestamptz
);

create table trade_block (
  league_id uuid references leagues(id) on delete cascade,
  player_name text not null,
  manager_id uuid references managers(id) on delete cascade,
  listed_at timestamptz default now(),
  primary key (league_id, player_name)
);

-- Live scoring, written by the ESPN job in section 6.
create table player_scores (
  league_id uuid references leagues(id) on delete cascade,
  week int not null,
  player_name text not null,
  points numeric not null default 0,
  stat_line text,
  updated_at timestamptz default now(),
  primary key (league_id, week, player_name)
);
```

**5.3 — Seed it once from what you already have.**

```js
// scripts/seed.mjs
import { createClient } from "@supabase/supabase-js";
import * as m from "../src/data/league-data.js";
import * as sim from "../src/data/league-sim.js";

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const { data: league } = await db.from("leagues")
  .insert({ name: "Pylon Fantasy", commissioner_slot: "HELX" })
  .select().single();

const managers = [];
for (const slot of m.TEAMS) {
  const { data } = await db.from("managers").insert({
    league_id: league.id, slot,
    name: slot, franchise: m.TEAM_NAMES[slot],
    is_commissioner: slot === "HELX"
  }).select().single();
  managers.push(data);
}

// The placeholder rosters. Delete this block if you want to draft from empty.
const rosters = sim.buildLeague(m);
for (let i = 0; i < rosters.length; i++) {
  await db.from("roster_slots").insert(rosters[i].map(x => ({
    league_id: league.id, manager_id: managers[i].id,
    player_name: x.p.n, overall_pick: x.ov, lineup_slot: "BENCH"
  })));
}
console.log("seeded", league.id);
```

**5.4 — PINs must be hashed.** Never store the four digits. On sign-up:

```js
import bcrypt from "bcryptjs";
const pin_hash = await bcrypt.hash(pin, 10);
```

On sign-in, `bcrypt.compare`. A four-digit PIN is weak by design — that is fine
for a fantasy league, but add a rate limit (five attempts, then a one-minute
lockout) so it cannot be brute-forced in a loop.

**5.5 — Row-level security.** Turn RLS on for every table. The rules you need:

- Anyone signed in can *read* their league's rosters, trades and block.
- A manager can only *write* to their own roster and their own trades.
- Only `is_commissioner` can write to `leagues.settings` or delete rosters.

Skipping this means any manager can edit any roster from the browser console.

---

## 6. ESPN — live stats and scoring

**6.1 — Understand what you are using.** These endpoints are public and
undocumented. They are not an official API, there is no contract, and they can
change without notice. Build so that a failure degrades gracefully rather than
breaking the page — the News page already does this and the pattern is worth
keeping.

The endpoints this project uses today:

```
# News wire — already in News.dc.html
https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=40

# Team roster — used for ages and experience
https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{abbr}/roster

# Player search — used for headshots
https://site.web.api.espn.com/apis/search/v2?query={name}
```

The two you will add for live scoring:

```
# All games for a week, with live state and scores
https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week={n}&seasontype=2

# One game in full, including per-player statistics
https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={gameId}
```

**Verify both against a live game week before you build on them.** Fetch them
in a browser tab and read the shape. Do not trust the field names above without
checking — this is exactly the kind of thing that drifts.

**6.2 — Do the fetching on the server, not in the browser.** Right now the News
page fetches ESPN directly from each visitor's browser. That works because those
endpoints send permissive CORS headers, but it means twelve browsers hammering
ESPN independently, no caching, and no way to read CBS or NFL.com at all (they
do not send CORS headers, so a browser cannot read them).

Move it server-side:

```ts
// src/app/api/cron/scores/route.ts
import { createClient } from "@supabase/supabase-js";
import { POOL } from "@/data/league-data";

export const dynamic = "force-dynamic";

const scoring = { pass: 1/25, passTd: 4, int: -2, rush: 0.1, rec: 0.5, yds: 0.1, td: 6 };

export async function GET(req: Request) {
  // Vercel Cron sends this header; reject anything else.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("no", { status: 401 });
  }

  const week = currentWeek();                       // your own helper
  const board = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2`
  ).then(r => r.json());

  const rostered = new Set(POOL.map(p => p.n));
  const rows: any[] = [];

  for (const event of board.events ?? []) {
    const summary = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${event.id}`
    ).then(r => r.json());

    for (const team of summary.boxscore?.players ?? []) {
      for (const group of team.statistics ?? []) {
        for (const athlete of group.athletes ?? []) {
          const name = athlete.athlete?.displayName;
          if (!name || !rostered.has(name)) continue;
          rows.push({
            league_id: process.env.LEAGUE_ID,
            week,
            player_name: name,
            points: scorePlayer(group.name, athlete.stats, scoring),
            stat_line: athlete.stats?.join(" · ")
          });
        }
      }
    }
  }

  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  await db.from("player_scores").upsert(rows);
  return Response.json({ week, players: rows.length });
}
```

**6.3 — Schedule it.** In `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/scores", "schedule": "*/2 * * * 0" },
    { "path": "/api/cron/scores", "schedule": "*/2 * * * 1" },
    { "path": "/api/cron/scores", "schedule": "*/2 * * * 4" },
    { "path": "/api/cron/news",   "schedule": "*/15 * * * *" }
  ]
}
```

Every two minutes on Sunday, Monday and Thursday — the days games are played.
News every fifteen minutes, all week. Do not poll every minute all week; you
will get throttled and it buys you nothing.

**6.4 — Serve your own data.** Pages read `player_scores` from Supabase, never
ESPN directly. One consequence worth noticing: the Matchup page currently
*simulates* scoring from 2025 per-game rates and says so on screen. Once this
job is running, that simulation is replaced by real numbers — keep the honest
labelling, and have it say "simulated" only when it genuinely is (preseason, or
a week with no data yet).

**6.5 — CBS and NFL.com.** Same cron pattern, but those need HTML parsing rather
than JSON. Use their RSS feeds if available (`nfl.com/feeds/rss/news`) — far
more stable than scraping a page.

---

## 7. The live draft (skip if you are drafting in a voice call)

Twelve people, one board, one clock. Supabase Realtime carries it:

```ts
const channel = supabase.channel(`draft:${leagueId}`)
  .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "draft_picks" },
      ({ new: pick }) => applyPick(pick))
  .subscribe();
```

Three things to get right:

1. **The clock is the server's, not the browser's.** Store `pick_started_at` on
   the league row. Every client computes its own countdown from that timestamp.
   Otherwise twelve clocks drift apart and someone gets skipped.
2. **Picks must be atomic.** Two managers can click the same player in the same
   second. The `unique (league_id, player_name)` constraint on `roster_slots`
   makes the second one fail — catch that and tell them cleanly.
3. **Autodraft runs server-side.** A browser that closed cannot pick for itself.
   A scheduled function that checks for an expired clock and picks from the
   manager's queue is the only version that works.

The cinematic reveal, the lottery and the intro reel are all client-side and
port with no extra work.

---

## 8. Commissioner administration

You asked for two specific powers. Both belong behind `is_commissioner`, in a
panel clearly separated from the ordinary settings — everything above it is
reversible and these are not.

**8.1 — Reset rosters.**

```ts
// src/app/api/admin/reset-rosters/route.ts
export async function POST(req: Request) {
  const me = await requireCommissioner(req);       // 403 otherwise

  // Snapshot first. Commissioners hit this button by accident.
  const { data: before } = await db.from("roster_slots")
    .select("*").eq("league_id", me.league_id);
  await db.from("roster_backups").insert({
    league_id: me.league_id, kind: "rosters", payload: before
  });

  await db.from("roster_slots").delete().eq("league_id", me.league_id);
  await db.from("draft_picks").delete().eq("league_id", me.league_id);
  await db.from("leagues").update({ lottery_order: null }).eq("id", me.league_id);

  return Response.json({ cleared: before?.length ?? 0 });
}
```

Require the commissioner to type the league name to confirm. Add a "restore last
snapshot" action next to it.

**8.2 — Reset a manager's PIN.**

```ts
export async function POST(req: Request) {
  const me = await requireCommissioner(req);
  const { managerId } = await req.json();

  // Null the hash — it does not set a new PIN, it forces the manager to.
  await db.from("managers")
    .update({ pin_hash: null })
    .eq("id", managerId)
    .eq("league_id", me.league_id);

  return Response.json({ ok: true });
}
```

**This shape matters.** The commissioner clears a PIN; they never see or set
one. If a commissioner could set another manager's PIN, they could sign in as
any team in the league. On next sign-in, a manager with a null hash is sent
through PIN creation instead of PIN entry.

Both actions should write to an `admin_log` table — who did what, when. In a
twelve-person league, "the rosters just vanished" is a conversation you want
records for.

---

## 9. Deploy

```bash
npm i -g vercel
vercel link
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_KEY      # server only — never NEXT_PUBLIC_
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add CRON_SECRET
vercel env add LEAGUE_ID
vercel --prod
```

Point a domain at it in the Vercel dashboard.

**The one mistake to avoid:** `SUPABASE_SERVICE_KEY` bypasses row-level
security. It must never appear in a `NEXT_PUBLIC_` variable or in any file that
reaches the browser. Server routes only.

---

## 10. Order of work

If you do this in one stretch, roughly:

| Phase | Work | Rough size |
| --- | --- | --- |
| 3 | Data across, images extracted | half a day |
| 4 (1–4) | Four read-only pages ported | two days |
| 5 | Supabase schema, auth, seed | two days |
| 4 (5–7) | Sign-up, Trades, Commissioner on live data | three days |
| 6 | ESPN ingestion and scoring | two days |
| 8 | Admin panel | half a day |
| 4 (8) + 7 | Draft room and realtime | three days, and the riskiest |
| 9 | Deploy, domain, smoke test | half a day |

Around two and a half weeks of focused work, and you can ship after phase 5 with
a read-only site that already looks like the finished thing.

---

## 11. Before you invite eleven people

- [ ] Every table has RLS on, and you have tested it by trying to edit another
      manager's roster from the browser console.
- [ ] PINs are hashed. Grep the repo for anything storing four raw digits.
- [ ] `SUPABASE_SERVICE_KEY` does not appear in any client bundle.
      (`npm run build && grep -r "service" .next/static` — should return nothing.)
- [ ] The ESPN cron has run through a real game day and the numbers match what
      ESPN's own scoreboard shows.
- [ ] Reset rosters has been tested, and the snapshot restores.
- [ ] A PIN reset has been tested end to end with a second account.
- [ ] The draft has been rehearsed with at least three browsers open at once.
- [ ] You have decided the licensing question from 1.1.

---

## 12. What does not port, and what to do about it

**The intro video.** It lives in IndexedDB on the commissioner's machine. Live,
upload it to Supabase Storage and store the URL in `leagues.settings`. Then
every manager sees the same reel, which is what you wanted anyway.

**The 20-0 leaderboard.** Currently seeded with placeholder names and not
persisted. Add a `minigame_scores` table and it becomes a real league-wide
leaderboard — the feature you originally asked for.

**The weekly pick-em.** Not built, because it needs the NFL schedule and I would
have had to invent the matchups. Once you have the real schedule, the
`scoreboard` endpoint in 6.1 gives you the games *and* their results, so pick-em
and live scoring end up sharing one ingestion job.
