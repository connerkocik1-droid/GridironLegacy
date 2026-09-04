/**
 * Creates the league, its open franchises, and the draft board.
 *
 * Run once, against a database that has had every migration in
 * supabase/migrations applied:
 *
 *   node scripts/seed.mjs                  # 12 franchises, the default
 *   node scripts/seed.mjs --teams 8        # a smaller league
 *   node scripts/seed.mjs --name "My League" --commissioner HELX
 *
 * Every franchise is created OPEN: no PIN, no owner. Managers claim one on the
 * sign-in page, which is what sets the PIN. The commissioner slot is the only
 * one marked in advance, and it is still claimed the same way.
 *
 * Prints the league id to put in LEAGUE_ID.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// The seeded franchise names, used in order. Past these, the commissioner's
// team-count control generates "Franchise 13" and so on.
const SEED_FRANCHISES = [
  ["STL", "Steel Cartel"],
  ["BLZ", "Blaze Syndicate"],
  ["RVN", "Ravenous"],
  ["APEX", "Apex Union"],
  ["NOVA", "Nova Collective"],
  ["HELX", "Helix Nine"],
  ["VOLT", "Voltage"],
  ["ONYX", "Onyx Row"],
  ["ORBT", "Orbital"],
  ["FLUX", "Flux Capital"],
  ["ZEN", "Zenith"],
  ["TITN", "Titanfall"],
];

const DEFAULT_SETTINGS = {
  rounds: 18,
  pickSeconds: 90,
  cinematicRounds: 3,
  lottery: true,
  scoring: "half",
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 8,
  ir: 2,
  regularWeeks: 13,
  playoffWeeks: 4,
  tradePicksWeek: 8,
};

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Read .env.local without a dependency, so the script runs on a clean checkout.
function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local; rely on the real environment.
  }
}

loadEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set. See .env.example.");
  process.exit(1);
}

const teams = Number(arg("--teams", "12"));
if (!Number.isInteger(teams) || teams < 2 || teams > 16) {
  console.error("--teams must be a whole number from 2 to 16.");
  process.exit(1);
}

const leagueName = arg("--name", "Gridiron Legacy");
const commissionerSlot = arg("--commissioner", SEED_FRANCHISES[0][0]).toUpperCase();
const season = Number(arg("--season", "2026"));

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: existing } = await db.from("leagues").select("id, name").limit(1);
if (existing?.length) {
  console.error(
    `A league already exists (${existing[0].name}, ${existing[0].id}).\n` +
      "Seeding again would create a second one. Delete it first if that is what you want.",
  );
  process.exit(1);
}

const { data: league, error: leagueError } = await db
  .from("leagues")
  .insert({
    name: leagueName,
    season,
    commissioner_slot: commissionerSlot,
    settings: DEFAULT_SETTINGS,
    draft_state: "pending",
    current_pick: 1,
  })
  .select("id")
  .single();

if (leagueError) {
  console.error("Could not create the league:", leagueError.message);
  process.exit(1);
}

const franchises = [];
for (let i = 0; i < teams; i++) {
  const [slot, franchise] = SEED_FRANCHISES[i] ?? [
    `T${String(i + 1).padStart(2, "0")}`,
    `Franchise ${i + 1}`,
  ];
  franchises.push({
    league_id: league.id,
    slot,
    // "Open" until somebody claims it and gives their own name.
    name: "Open",
    franchise,
    pin_hash: null,
    is_commissioner: slot === commissionerSlot,
  });
}

if (!franchises.some((f) => f.is_commissioner)) {
  franchises[0].is_commissioner = true;
  console.warn(
    `No franchise matched --commissioner ${commissionerSlot}; ` +
      `${franchises[0].slot} holds the league office instead.`,
  );
}

const { error: managerError } = await db.from("managers").insert(franchises);
if (managerError) {
  console.error("Could not create the franchises:", managerError.message);
  process.exit(1);
}

// The board is generated, never typed in — the same function the commissioner's
// team-count control calls, so a seeded league and an edited one agree.
const { data: board, error: boardError } = await db.rpc("rebuild_draft_board", {
  p_league_id: league.id,
});

if (boardError) {
  console.error("Could not build the draft board:", boardError.message);
  process.exit(1);
}

console.log(`\nSeeded "${leagueName}" — ${teams} open franchises.\n`);
for (const f of franchises) {
  console.log(`  ${f.slot.padEnd(5)} ${f.franchise}${f.is_commissioner ? "  (commissioner)" : ""}`);
}
console.log(`\n  Draft board: ${board.picks} picks over ${board.rounds} rounds.`);
console.log(`\nSet this in your environment:\n\n  LEAGUE_ID=${league.id}\n`);
console.log("Every franchise is unclaimed. Send people to /signin to claim one.");
