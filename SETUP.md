# Getting Gridiron Legacy live

Everything here needs an account only you hold — Supabase, Vercel, GitHub
settings. Work through it in order; it takes about half an hour.

If you have already deployed and every page 404s, skip to step 5. That is the
usual cause.

---

## 1. Create the Supabase project

At [supabase.com](https://supabase.com), create a project. Free tier is ample
for twelve managers.

From **Project Settings → API**, copy three values — you will need them twice:

| Value | Where it goes |
| --- | --- |
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_KEY` |

**The service_role key bypasses row-level security.** It must never appear in a
`NEXT_PUBLIC_` variable or anywhere that reaches a browser.

---

## 2. Run the migrations

In the Supabase dashboard, open **SQL Editor**. Run each file in
`supabase/migrations/` **in numerical order**, one at a time:

```
0001_schema.sql        tables, row-level security
0002_trades.sql        trades, executed atomically
0003_draft.sql         draft board, picks, autodraft
0004_auth.sql          PIN attempts, rate limiting, PIN reset
0005_team_count.sql    league size, draft board generation
0006_draft_control.sql start, pause, resume
0007_waivers.sql       waiver claims, roster capacity
0008_schedule.sql      matchups, grading, standings
0009_divisions.sql     two divisions, divisional rematches
```

Each is idempotent enough to re-run if one fails midway, but run them in order:
later files depend on earlier ones.

---

## 3. Seed the league

From a checkout on your own machine, with `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY` set (a `.env.local` file works):

```bash
npm install
node scripts/seed.mjs                 # twelve franchises
node scripts/seed.mjs --teams 8       # or however many you expect
```

Every franchise is created **open** — no PIN, no owner. People claim one at
`/signin`, and claiming is what sets the PIN.

The script prints a league id. Keep it: that is `LEAGUE_ID`.

---

## 4. Set the environment variables in Vercel

**Project → Settings → Environment Variables.** Add all seven, to Production
*and* Preview:

```
NEXT_PUBLIC_SUPABASE_URL       from step 1
NEXT_PUBLIC_SUPABASE_ANON_KEY  from step 1
SUPABASE_URL                   same as the first
SUPABASE_SERVICE_KEY           from step 1 — never NEXT_PUBLIC_
LEAGUE_ID                      printed by the seed script
AUTH_SECRET                    openssl rand -hex 32
CRON_SECRET                    openssl rand -hex 32
```

`AUTH_SECRET` signs the session behind every manager's PIN. **Changing it later
locks everyone out until each PIN is reset**, so set it once and leave it.

Redeploy after adding them; Vercel does not pick up new variables on a running
deployment.

---

## 5. Point Vercel at a branch that has the app

**This is why a deployment can succeed and still 404 on every page.**

`main` is still the original prototype upload: loose `.dc.html` files, CSVs and
PNGs, with no `package.json`. Vercel finds no framework, serves the files as
static, and nothing matches a route.

Either:

- **Merge the pull request into `main`** (preferred — every later deploy just
  works), or
- **Project → Settings → Git → Production Branch**, and set it to the branch
  holding the app.

To confirm which branch Vercel is building, open the deployment and read the
commit it names.

---

## 6. Schedule the jobs

`vercel.json` carries two cron jobs, which is the Hobby plan's limit — one
daily catch-up scoring run and the weekly waiver run.

Live scoring and the draft clock need to run far more often than once a day, so
they live in `.github/workflows/cron.yml`. In **GitHub → Settings → Secrets and
variables → Actions**, add:

```
SITE_URL      https://your-app.vercel.app
CRON_SECRET   the same value you set in Vercel
```

GitHub's scheduler is best-effort and can fire several minutes late. If the
draft clock matters to you, move those jobs back into `vercel.json` on Vercel
Pro instead.

You can run any job by hand from the Actions tab — useful for testing.

---

## 7. Open the league

1. Sign in at `/signin` and claim the commissioner franchise.
2. In the league office, set the size and the two divisions.
3. **Build the schedule.** The page tells you how long the season comes out —
   twelve franchises is sixteen regular weeks, which leaves no room for
   playoffs inside an NFL season. Decide that before people start playing: the
   schedule cannot be rebuilt once a week has been graded.
4. Send everyone else to `/signin` to claim theirs.
5. Start the draft from the league office when everyone is in.

---

## Before you invite eleven people

- [ ] `npm run verify-espn` **from your own machine, during a game week.** These
      endpoints are undocumented and can change without notice, and nothing in
      the test suite proves the live shape — only that the code handles what it
      is given.
- [ ] `npm run build && grep -r "service_role" .next/static` returns nothing.
- [ ] A second person has claimed a franchise and signed in.
- [ ] A PIN reset has been tested end to end.
- [ ] The draft has been rehearsed with three browsers open at once.
- [ ] You have decided the licensing question in `DEPLOY.md` section 1.1 —
      player headshots hotlink ESPN's CDN and the team marks are licensed
      material. A private league among friends is one thing; a public site is
      another.

---

## If something is wrong

**Every page 404s** — Vercel is building a branch without the app. Step 5.

**"The league database is not configured yet"** — the Supabase variables are
missing or the deployment predates them. Step 4, then redeploy.

**Signing in fails for everyone at once** — `AUTH_SECRET` changed. Every PIN
must be reset by the commissioner.

**Scores never appear** — check the Actions tab for the scheduled run, then run
`verify-espn`. The endpoints may have drifted.

**The deployment itself fails** — check the cron count in `vercel.json`. Hobby
allows two, each at most once a day; more than that is rejected outright.
