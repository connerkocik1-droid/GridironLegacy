/**
 * Just enough Supabase for the front door to let the audit in.
 *
 * The audit intercepts every /api/* call in the browser, but the home page
 * decides whether somebody is signed in on the SERVER, and that decision talks
 * to Supabase directly — so a browser interception cannot reach it. This
 * stands in: an auth endpoint that says yes, and the one PostgREST query
 * currentManager() makes.
 *
 * Nothing here is a test of Supabase. It exists so that the pages under
 * measurement render their signed-in layout instead of the sign-in page.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.STUB_PORT ?? 54321);
const LEAGUE_ID = process.env.LEAGUE_ID ?? "league-a";

const USER = {
  id: "auth-user-0",
  aud: "authenticated",
  role: "authenticated",
  email: "t01@pylon.local",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

const MANAGER = {
  id: "m0",
  slot: "T01",
  name: "Conner",
  franchise: "Steel Cartel",
  league_id: LEAGUE_ID,
  is_commissioner: true,
  ready: false,
};

// The audit drives this through /__state to move between signed-in, signed-out
// and signed-in-with-no-franchise without restarting anything.
let state = { authed: true, managerLeague: LEAGUE_ID };

createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("content-type", "application/json");

  if (url.pathname === "/__state") {
    let body = "";
    req.on("data", (c) => (body += c));
    return req.on("end", () => {
      state = { ...state, ...JSON.parse(body || "{}") };
      res.end(JSON.stringify({ ok: true, state }));
    });
  }

  if (url.pathname === "/auth/v1/user") {
    if (!req.headers.authorization || !state.authed) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ message: "no token" }));
    }
    return res.end(JSON.stringify(USER));
  }

  if (url.pathname === "/rest/v1/managers") {
    const byAuth = url.searchParams.get("auth_user_id");
    const wantsLeague = url.searchParams.get("league_id");

    // The league-wide franchise list the signed-out page asks for.
    if (!byAuth) {
      return res.end(
        JSON.stringify([
          {
            id: "m0", slot: "T01", name: "Open", franchise: "Steel Cartel",
            pin_hash: null, is_commissioner: true, division: "East",
          },
          {
            id: "m1", slot: "T02", name: "Open", franchise: "Bay Area Brawlers",
            pin_hash: null, is_commissioner: false, division: "West",
          },
        ]),
      );
    }

    if (state.managerLeague === null) return res.end("[]");
    // Scoped queries must not return a franchise from another league.
    if (wantsLeague && wantsLeague !== `eq.${state.managerLeague}`) return res.end("[]");
    return res.end(JSON.stringify([{ ...MANAGER, league_id: state.managerLeague }]));
  }

  if (url.pathname === "/rest/v1/leagues") {
    return res.end(JSON.stringify([{ id: LEAGUE_ID, name: "Pylon Fantasy", season: 2026 }]));
  }

  res.end("[]");
}).listen(PORT, "127.0.0.1", () => console.log(`supabase stub on ${PORT}`));
