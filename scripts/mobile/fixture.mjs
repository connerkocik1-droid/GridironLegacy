/**
 * Enough of a league that every page has something real to lay out.
 *
 * Deliberately hostile data: a twelve-team league rather than four, long
 * franchise names, long player names, and every panel populated. An empty
 * fixture lays out beautifully on a phone and proves nothing.
 */
export const ME = {
  id: "m0", slot: "T01", franchise: "Steel Cartel", league_id: "l1",
  name: "Conner", waiver_priority: 7,
};

const NAMES = [
  ["m0", "T01", "Conner", "Steel Cartel", "North"],
  ["m1", "T02", "Dana", "Bay Area Brawlers", "North"],
  ["m2", "T03", "Open", "Open Team", "North"],
  ["m3", "T04", "Kim", "Kim's Very Long Franchise Name", "North"],
  ["m4", "T05", "Alex", "Thunderbolts", "North"],
  ["m5", "T06", "Sam", "Riverside Rattlesnakes", "North"],
  ["m6", "T07", "Jo", "Nine Lives", "South"],
  ["m7", "T08", "Pat", "Gold Coast Gladiators", "South"],
  ["m8", "T09", "Chris", "Iron Rail", "South"],
  ["m9", "T10", "Morgan", "Dust Devils", "South"],
  ["m10", "T11", "Riley", "Harbour Hounds", "South"],
  ["m11", "T12", "Casey", "Northside Nomads", "South"],
];

export const MANAGERS = NAMES.map(([id, slot, name, franchise, division]) => ({
  id, slot, name, franchise, division,
}));

const ROSTER = [
  ["Jayden Daniels", "QB"], ["Jahmyr Gibbs", "RB"], ["Bijan Robinson", "RB"],
  ["Ja'Marr Chase", "WR"], ["Puka Nacua", "WR"], ["Brock Bowers", "TE"],
  ["James Cook III", "FLEX"], ["Marvin Harrison Jr.", "FLEX"],
  ["Brandon Aubrey", "K"], ["Baltimore Ravens D/ST", "D/ST"],
  ["Rome Odunze", "BENCH"], ["Tank Bigsby", "BENCH"], ["Trey McBride", "BENCH"],
  // Carries the draft pool's questionable flag and is on no injury report.
  // He is here so the audit can see a badge that should not be drawn: the
  // roster used to hold nobody in this state, which is why nothing caught
  // healthOf falling back to that flag for a hundred and thirty-eight players.
  ["Christian McCaffrey", "BENCH"],
];

const SETTINGS = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 8, ir: 2, rounds: 18, cinematicRounds: 3,
  // The clock is a ladder now. pickSeconds is kept beside it because a league
  // that has not been migrated still has only that, and the office has to lay
  // out either one without falling over.
  pickSeconds: 90,
  pickClock: [
    { throughRound: 4, seconds: 90 },
    { throughRound: 10, seconds: 75 },
    { throughRound: null, seconds: 60 },
  ],
  regularWeeks: 16, waiverDays: 1, tradeDeadlineWeek: 14,
};

// A side of a fixture, as api/schedule sends one: the score, where the week is
// expected to finish, how much football is left, and the record under the name.
const side = (m, points, extra = {}) => ({
  ...m,
  claimed: m.name !== "Open",
  points,
  record: { w: 2, l: 1, t: 0 },
  projected: null,
  yetToPlay: null,
  inPlay: null,
  ...extra,
});
/** A side in the week being played, which is the only week with an outlook. */
const livingSide = (m, points, projected, yetToPlay, inPlay = 0) =>
  side(m, points, { projected, yetToPlay, inPlay });
const ago = (mins) => new Date(Date.now() - mins * 60_000).toISOString();

export function routes(page, over = {}) {
  const json = (body) => (r) => r.fulfill({ json: body });

  // The email a manager has given, so the settings panel has something to show
  // and the form starts in the state a returning manager actually sees.
  let managerEmail = "conner@example.com";
  let managerWantsMail = true;

  // Who the browser thinks is signed in. The Supabase stand-in has an authed
  // flag of its own, but that only reaches what the server renders — this is
  // what every client component asking useMe() gets, and until it could say
  // "nobody" the signed-out screen was only half signed out. Anything whose
  // visibility depends on being signed in, like the bottom tab bar, was
  // measured in the wrong state.
  page.route("**/api/auth/me", (r) =>
    r.fulfill({ json: {
      manager: over.signedOut
        ? null
        : {
            ...ME, is_commissioner: true, ready: false, logo: null,
            email: managerEmail, email_notices: managerWantsMail,
            // Owing, so the band at the top of the home page is measured
            // rather than merely written. over.duesPaid tries the other side.
            dues_paid: over.duesPaid === true,
          },
      configured: true,
      // Which of the two the fourth tab is. The fixture league is mid-season
      // and its commissioner has given the word, so the tab is Moves — except
      // on the runs that exist to measure the draft room, where the league has
      // plainly not given it yet.
      movesTab: over.draftState == null && !over.myTurn && !over.preseason,
      // The league is collecting. over.noDues is a league that does not.
      duesNote: over.noDues ? null : "$50 to @conner on Venmo by 1 September.",
    } }),
  );

  page.route("**/api/profile", (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    if (body.email !== undefined) managerEmail = body.email || null;
    if (body.emailNotices !== undefined) managerWantsMail = body.emailNotices;
    return r.fulfill({ json: {
      ok: true,
      franchise: body.franchise ?? ME.franchise,
      email: managerEmail,
      emailNotices: managerWantsMail,
    } });
  });
  page.route("**/api/logos", json({ logos: {} }));
  // The injury report, with one of each state that draws a badge — so any
  // screen showing players shows every colour the badge can be.
  page.route("**/api/player-status", json({
    statuses: {
      "puka nacua": { status: "questionable", detail: "Questionable", note: "Knee" },
      "james cook": { status: "out", detail: "Out", note: "Ankle" },
      "trey mcbride": { status: "ir", detail: "Injured Reserve", note: "Back" },
      "tank bigsby": { status: "suspended", detail: "Suspension", note: "" },
    },
    fetchedAt: new Date().toISOString(),
  }));

  page.route("**/api/player/**", (r) => {
    const name = decodeURIComponent((r.request().url().split("/api/player/")[1] ?? "").split("?")[0]);

    // Draftable, but with no 2025 line in the historical pool — which is most
    // of the pool, since it keeps standout seasons rather than every season.
    // The page has to say the season is missing rather than leave a gap.
    if (name === "Blank Slate") {
      return r.fulfill({ json: {
        profile: {
          name, found: true, position: "TE", team: "NYJ", bye: 9,
          headshot: "", teamLogo: "",
          adp: 180, posRank: "TE22", rostered: 4.1,
          archetype: "Depth Piece", insight: "A body at the position.",
          career: [],
        },
        news: [], season: { year: 2026, total: 0, best: 0, statLine: "", weeks: [] },
        owner: null,
      } });
    }

    // A player the pool never heard of: claimed off waivers, never draftable.
    // His page has to render anyway, and has to promise nothing.
    if (name === "Nobody At All") {
      return r.fulfill({ json: {
        profile: {
          name, found: false, position: "", team: "", bye: null,
          headshot: "", teamLogo: "",
          adp: null, posRank: null, rostered: null,
          archetype: null, insight: null, career: [],
        },
        news: [], season: null, owner: null,
      } });
    }

    return r.fulfill({ json: {
      profile: {
        name, found: true, position: "WR", team: "LAR", bye: 11,
        headshot: "", teamLogo: "",
        adp: 6.5, posRank: "WR4", rostered: 99.9,
        archetype: "Volume Machine",
        insight: "Carries an injury designation and the market has not moved off him.",
        career: [
          { year: 2025, team: "LAR", position: "WR",
            line: "105 rec · 1,486 yds · 14.2 Y/R · 6 TD",
            line2: "160 tgt · 27.1% share · 274.6 FPTS · 16.2/G", era: "2020s" },
        ],
      },
      news: [],
      season: { year: 2026, total: 48.6, best: 22.4,
        statLine: "25 tgt · 19 rec · 302 rec yds · 1 rec TD",
        weeks: [
        { week: 1, points: 22.4, statLine: "11 tgt \u00b7 9 rec \u00b7 140 rec yds \u00b7 1 rec TD", stats: null },
        { week: 2, points: 14.8, statLine: "8 tgt \u00b7 6 rec \u00b7 88 rec yds", stats: null },
        { week: 3, points: 11.4, statLine: "6 tgt \u00b7 4 rec \u00b7 74 rec yds", stats: null },
      ] },
      owner: { slot: "T01", franchise: "Steel Cartel", mine: true, lineupSlot: "WR" },
    } });
  });


  // A watchlist with everything on it that a row can be: somebody else's
  // player, one of your own, a free agent, and one sitting on the wire — plus
  // the longest names in the pool, since this page is mostly names.
  page.route("**/api/watchlist**", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({
          json: {
            players: [
              "Marquez Valdes-Scantling", "Jacory Croskey-Merritt",
              "Jaxon Smith-Njigba", "Marvin Harrison Jr.",
            ],
            watching: [
              { name: "Marquez Valdes-Scantling", addedAt: ago(300),
                owner: { id: "m3", slot: "T04", franchise: "Kim's Very Long Franchise Name", mine: false },
                clearsAt: null },
              { name: "Jacory Croskey-Merritt", addedAt: ago(600), owner: null,
                clearsAt: new Date(Date.now() + 36e5).toISOString() },
              { name: "Jaxon Smith-Njigba", addedAt: ago(900), owner: null, clearsAt: null },
              { name: "Marvin Harrison Jr.", addedAt: ago(1200),
                owner: { id: "m0", slot: "T01", franchise: "Steel Cartel", mine: true },
                clearsAt: null },
            ],
          },
        })
      : r.fulfill({ json: { ok: true } }),
  );

  // The commissioner's scoring check. Hostile on purpose in the way that page
  // can actually be hostile: long names, a defence whose name is three words
  // and a suffix, deep breakdowns, and raw ESPN columns that want to run off
  // the side of a phone.
  const term = (stat, rule, points) => ({ stat, rule, points });
  const preseasonPlayer = (name, team, position, workload, points, terms, raw, source = "espn") => ({
    name, team, position, positionSource: source, workload, points,
    statLine: terms.map((t) => t.stat).join(" \u00b7 "),
    terms, raw, gameId: "401671800",
  });

  const psPlayers = [
    preseasonPlayer("Jacory Croskey-Merritt", "WSH", "QB", 43, 20, [
      term("250 pass yds", "\u00f7 25", 10), term("1 pass TD", "\u00d7 4", 4),
      term("2 interceptions", "\u00d7 -2", -4), term("40 rush yds", "\u00f7 10", 4),
      term("1 rush TD", "\u00d7 6", 6),
    ], [
      { group: "passing", stats: { "C/ATT": "22/35", YDS: "250", AVG: "7.1", TD: "1", INT: "2" } },
      { group: "rushing", stats: { CAR: "8", YDS: "40", AVG: "5.0", TD: "1", LONG: "12" } },
    ]),
    preseasonPlayer("Marquez Valdes-Scantling", "NO", "WR", 21, 17.5, [
      term("100 rec yds", "\u00f7 10", 10), term("1 rec TD", "\u00d7 6", 6),
      term("3 catches", "\u00d7 0.5", 1.5),
    ], [
      { group: "receiving", stats: { REC: "3", YDS: "100", AVG: "33.3", TD: "1", LONG: "62", TGTS: "5" } },
    ]),
    preseasonPlayer("Brandon Aubrey", "DAL", "K", 5, 13, [
      term("54 yd FG", "50+", 5), term("52 yd FG", "50+", 5),
      term("22 yd FG", "under 50", 3), term("1 missed FG", "\u00d7 -1", -1),
      term("1 XP", "\u00d7 1", 1),
    ], [{ group: "kicking", stats: { FG: "3/4", PCT: "75.0", LONG: "54", XP: "1/1", PTS: "10" } }]),
    preseasonPlayer("Jacksonville Jaguars D/ST", "JAX", "D/ST", 0, 10, [
      term("3 sacks", "\u00d7 1", 3), term("2 interceptions", "\u00d7 2", 4),
      term("1 fumble recovered", "\u00d7 2", 2), term("15 allowed", "14-20", 1),
    ], []),
    // The two rows that are not ESPN's own answer, so the page has to lay both
    // out: one the draft pool named, and one nobody could. The second is the
    // row that used to carry a guessed position — it now carries an admitted
    // blank, and the check reads it to make sure the guess has not come back.
    preseasonPlayer("Bhayshul Tuten", "JAX", "RB", 12, 8.4, [
      term("58 rush yds", "\u00f7 10", 5.8), term("26 rec yds", "\u00f7 10", 2.6),
    ], [{ group: "rushing", stats: { CAR: "12", YDS: "58", AVG: "4.8", TD: "0", LONG: "9" } }],
      "pool"),
    preseasonPlayer("Tanner Mordecai", "SF", "", 7, 3.1, [
      term("31 rec yds", "\u00f7 10", 3.1),
    ], [{ group: "receiving", stats: { REC: "3", YDS: "31", AVG: "10.3", TD: "0", LONG: "14", TGTS: "5" } }],
      "unknown"),
  ];

  page.route("**/api/admin/preseason**", json({
    week: 3, found: true, format: "ppr",
    games: [{ id: "401671800", label: "BUF 15 @ KC 24", state: "post", detail: "Final" }],
    players: psPlayers,
    // Nobody appears twice, because the real lineup builder will not do that
    // and a fixture that shows it teaches the audit to accept it.
    lineup: [
      { slot: "QB", player: psPlayers[0] },
      { slot: "RB", player: null },
      { slot: "RB", player: null },
      { slot: "WR", player: psPlayers[1] },
      { slot: "WR", player: null },
      { slot: "TE", player: null },
      { slot: "FLEX", player: null },
      { slot: "FLEX", player: null },
      { slot: "D/ST", player: psPlayers[3] },
      { slot: "K", player: psPlayers[2] },
    ],
    total: 60.5,
    failed: [], unattributed: [],
    fetchedAt: new Date().toISOString(),
  }));


  page.route("**/api/notices", (r) =>
    r.request().method() === "POST"
      ? r.fulfill({ json: { ok: true, read: 2 } })
      : r.fulfill({ json: {
          unread: 2,
          notices: [
            { id: "n1", kind: "draft", body: "You are on the clock.", href: "/draft",
              read_at: null, created_at: ago(3) },
            { id: "n2", kind: "waiver",
              body: "Your claim for Ashton Jeanty did not go through: That player is already rostered",
              href: "/free-agents", read_at: null, created_at: ago(300) },
          ],
        } }));

  const story = (id, headline, players) => ({
    id, headline,
    description: `Something happened involving ${players.join(" and ") || "nobody in particular"}.`,
    published: ago(90), byline: "ESPN", link: "https://example.com", image: null, players,
  });
  page.route("**/api/news", json({
    stories: [
      story("s1", "Bijan Robinson carries a heavy load again in a headline long enough to wrap", ["Bijan Robinson"]),
      story("s2", "Marvin Harrison Jr. is limited in practice", ["Marvin Harrison Jr."]),
      story("s3", "A league-wide rule change lands", []),
      story("s4", "Ashton Jeanty impresses", ["Ashton Jeanty"]),
    ],
  }));
  page.route("**/api/activity**", json({
    me: { id: "m0" }, managers: MANAGERS, total: 4, page: 0, hasMore: false,
    entries: [
      { id: "e1", kind: "trade", player: "Bijan Robinson", at: ago(20), managerId: "m0",
        franchise: "Steel Cartel", who: "Conner", mine: true,
        from: "Kim's Very Long Franchise Name", toWaivers: false, clearsAt: null, isPick: false },
      { id: "e2", kind: "trade", player: "2027 round 2 pick", at: ago(20), managerId: "m3",
        franchise: "Kim's Very Long Franchise Name", who: "Kim", mine: false,
        from: "Steel Cartel", toWaivers: false, clearsAt: null, isPick: true },
      { id: "e3", kind: "waiver", player: "Jayden Reed", at: ago(200), managerId: "m5",
        franchise: "Riverside Rattlesnakes", who: "Sam", mine: false, from: null,
        toWaivers: false, clearsAt: null, isPick: false },
      { id: "e4", kind: "drop", player: "Marvin Harrison Jr.", at: ago(900), managerId: "m0",
        franchise: "Steel Cartel", who: "Conner", mine: true, from: null,
        toWaivers: true, clearsAt: ago(-1400), isPick: false },
    ],
  }));

  // A league that has not drafted yet: no schedule, no scores, nothing graded,
  // and draft night still to come. It is the state every league is in on the
  // day the other eleven managers first sign in, and the home page looks
  // completely different in it.
  const preseasonHome = {
    meId: "m0",
    league: {
      name: "Pylon Fantasy", season: 2026,
      draftAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      draftState: "pending",
    },
    week: null, games: [], byes: [], trades: [],
    live: false, started: false, weekPhase: "upcoming",
    leaders: [], leaderBasis: "projected", power: [], played: false,
  };

  page.route("**/api/home", over.preseason ? json(preseasonHome) : json({
    meId: "m0",
    // draftState "complete" is the ordinary case for a league playing a week,
    // and it is what keeps the draft band off the home page here. The band's
    // own states are driven from a copy of this feed in its own check.
    league: {
      name: "Pylon Fantasy", season: 2026,
      draftAt: "2026-08-22T23:00:00Z", draftState: "complete",
    },
    week: 3,
    live: true, started: true, weekPhase: "live",
    games: MANAGERS.filter((_, i) => i % 2 === 0).map((m, i) => ({
      final: i > 0, mine: i === 0,
      home: { ...m, total: 104.6 - i * 9 },
      away: { ...MANAGERS[i * 2 + 1], total: 98.2 - i * 7 },
    })),
    byes: [],
    // Two offers, one of them a counter, with the longest names in the league
    // on both sides: this card sits under the score on the first screen
    // anybody sees, so it is the one that must not push the page sideways.
    trades: [
      { id: "t1", from: "Kim's Very Long Franchise Name", countered: false,
        get: ["Marvin Harrison Jr."], give: ["Jahmyr Gibbs", "Rome Odunze"],
        getPicks: 1, givePicks: 0 },
      { id: "t2", from: "Gold Coast Gladiators", countered: true,
        get: ["Brock Bowers", "Tank Bigsby", "Trey McBride"], give: [],
        getPicks: 0, givePicks: 2 },
    ],
    leaders: ["QB", "RB", "WR", "TE", "K", "D/ST"].map((position) => ({
      position,
      player: { name: "Marvin Harrison Jr.", team: "ARI", points: 88.4,
        franchise: "Kim's Very Long Franchise Name", managerSlot: "T04" },
    })),
    leaderBasis: "scored",
    power: MANAGERS.map((m, i) => ({
      id: m.id, slot: m.slot, franchise: m.franchise, name: m.name,
      rank: i + 1, rating: 90 - i * 6, wins: 12 - i, losses: i, ties: 0,
      pointsFor: 340 - i * 12, mine: i === 0,
    })),
    played: true,
  }));

  page.route("**/api/schedule", json({
    meId: "m0", league: { name: "Pylon Fantasy", season: 2026 },
    weeks: [1, 2, 3], liveWeek: 3,
    games: [
      { week: 1, final: true, divisional: true, live: false, mine: true,
        home: side(MANAGERS[0], 120.4), away: side(MANAGERS[3], 98.0),
        winProbability: 1 },
      { week: 1, final: true, divisional: false, live: false, mine: false,
        home: side(MANAGERS[2], 61.2), away: side(MANAGERS[5], 88.0),
        winProbability: 0 },
      { week: 3, final: false, divisional: false, live: true, mine: true,
        home: livingSide(MANAGERS[0], 44.1, 113.7, 5, 2),
        away: livingSide(MANAGERS[7], 30.0, 125.1, 6, 1),
        winProbability: 0.44 },
      // Two other franchises, which is the case the card exists for: pressing
      // it must open their game and not the reader's own.
      { week: 3, final: false, divisional: true, live: true, mine: false,
        home: livingSide(MANAGERS[4], 51.8, 108.2, 4, 1),
        away: livingSide(MANAGERS[9], 66.3, 118.9, 3, 2),
        winProbability: 0.37 },
    ],
  }));

  page.route("**/api/league", json({
    meId: "m0", league: { name: "Pylon Fantasy", season: 2026, settings: SETTINGS },
    weeksScored: 3, played: true,
    franchises: MANAGERS.map((m, i) => ({
      ...m, id: m.id, claimed: m.name !== "Open", isCommissioner: i === 0,
      pointsFor: 340 - i * 12,
      record: { wins: 12 - i, losses: i, ties: 0, divWins: 4, divLosses: 1,
        pointsFor: 340 - i * 12, pointsAgainst: 250 + i * 8 },
      // Every shape the strip can take, including a tie and a short run: a
      // franchise with two results must not be drawn as one with five.
      form: ["W", "L", "W", "T", "W"].slice(0, Math.max(2, 5 - (i % 4))),
      roster: ROSTER.map(([n, s]) => ({ name: n, slot: s, acquired: "draft" })),
    })),
  }));

  // A live postseason, which the standings page draws above the table.
  const seat = (id, seed, points) => ({
    id, franchise: MANAGERS.find((m) => m.id === id).franchise,
    who: null, seed, mine: id === "m0", points,
  });
  page.route("**/api/playoffs", json({
    seeded: true, season: 2026, me: { id: "m0" }, totalRounds: 3,
    champions: [{ season: 2025, manager_id: "m8", franchise: "Iron Rail",
      decided_at: "2026-01-05" }],
    seeds: [
      { seed: 1, id: "m0", franchise: "Steel Cartel", mine: true, bye: true },
      { seed: 2, id: "m3", franchise: "Kim's Very Long Franchise Name", mine: false, bye: true },
      { seed: 3, id: "m5", franchise: "Riverside Rattlesnakes", mine: false, bye: false },
      { seed: 4, id: "m7", franchise: "Gold Coast Gladiators", mine: false, bye: false },
      { seed: 5, id: "m8", franchise: "Iron Rail", mine: false, bye: false },
      { seed: 6, id: "m10", franchise: "Harbour Hounds", mine: false, bye: false },
    ],
    rounds: [
      { round: 1, games: [
        { id: "g1", week: 17, final: true, winner: "m5", onSeed: false,
          home: seat("m5", 3, 121.4), away: seat("m10", 6, 98.2) },
        { id: "g2", week: 17, final: true, winner: "m8", onSeed: true,
          home: seat("m7", 4, 110.0), away: seat("m8", 5, 110.0) },
      ] },
      { round: 2, games: [
        { id: "g3", week: 18, final: false, winner: null, onSeed: false,
          home: seat("m0", 1, 44.2), away: seat("m8", 5, 51.8) },
        { id: "g4", week: 18, final: false, winner: null, onSeed: false,
          home: seat("m3", 2, 39.0), away: seat("m5", 3, 30.1) },
      ] },
    ],
  }));

  // The longest line each position can produce, because a stat line that fits
  // is not the one that breaks a phone. A quarterback who also ran and also
  // threw a pick is six parts long and lands in a column half a screen wide.
  const LINES = {
    QB: "24/38 · 312 pass yds · 41 rush yds · 3 pass TD · 1 rush TD · 1 INT",
    RB: "18 car · 104 rush yds · 22 rec yds · 1 rush TD · 1 rec TD",
    WR: "11 tgt · 9 rec · 140 rec yds · 1 rec TD",
    TE: "8 tgt · 6 rec · 71 rec yds · 1 rec TD",
    K: "3/4 FG · 2/2 XP",
    "D/ST": "3.5 sack · 1 FR · 2 INT · 288 yds allowed · 1 KORTD · 1 PRTD",
  };
  const lineFor = (slot) => LINES[slot] ?? LINES.RB;

  // Best ball: the roster, not a lineup. One man is stashed on injured
  // reserve, because the reserve panel is the one part of this page with a
  // control on it and an empty panel proves nothing about its layout.
  const STASHED = ["Trey McBride"];
  const SCORES = Object.fromEntries(
    ROSTER.map(([n, slot], i) => [
      n,
      { points: 27.4 - i, statLine: lineFor(slot === "FLEX" || slot === "BENCH" ? "RB" : slot) },
    ]),
  );

  // Anybody's roster: ?manager= names whose, and somebody else's comes back
  // with mine:false so the board has nothing to press.
  page.route("**/api/lineup**", (r) => {
    const asked = new URL(r.request().url()).searchParams.get("manager");
    const theirs = asked && asked !== ME.id;
    return r.fulfill({ json: {
      week: 3,
      me: theirs
        ? { id: asked, slot: "T05", name: "Priya Raghunathan", franchise: "Thunderbolts" }
        : ME,
      mine: !theirs,
      settings: SETTINGS,
      roster: ROSTER.map(([n]) => n).filter((n) => !STASHED.includes(n)),
      injuredReserve: STASHED,
      live: true, started: true, weekPhase: "live", final: false,
      scores: SCORES,
    } });
  });

  page.route("**/api/scores", json({ week: 3, scores: Object.fromEntries(
    ROSTER.map(([n, slot], i) => [
      n,
      { points: 27.4 - i, statLine: lineFor(slot === "FLEX" || slot === "BENCH" ? "RB" : slot),
        updatedAt: "" },
    ]),
  ) }));
  // Any two franchises, not only yours: ?home= names the left-hand side, so a
  // fixture between two other managers opened from the band comes back with
  // mine:false and the header stops saying YOU over somebody else's team.
  page.route("**/api/matchup**", (r) => {
    const asHome = new URL(r.request().url()).searchParams.get("home");
    return r.fulfill({ json: asHome && asHome !== "m0"
      ? { week: 3, scheduled: true, final: false, live: true, started: true, weekPhase: "live",
          mine: false,
          winProbability: 0.42,
          home: { id: "m4", slot: "T05", name: "Priya Raghunathan", franchise: "Thunderbolts",
            total: 88.4, projected: 108.2, yetToPlay: 4, inPlay: 1, record: { w: 2, l: 1, t: 0 } },
          away: { id: "m7", slot: "T08", name: "Bartholomew Winterbottom",
            franchise: "Gold Coast Gladiators", total: 91.2, projected: 118.9,
            yetToPlay: 3, inPlay: 2, record: { w: 1, l: 2, t: 0 } },
          rows: ROSTER.filter(([, slot]) => slot !== "BENCH").map(([n, slot]) => ({ slot,
            home: { name: n, position: slot, team: "WSH", points: 12.1, projected: 12,
              live: true, statLine: lineFor(slot === "FLEX" ? "RB" : slot),
              game: { state: "in", opponent: "PHI", away: false, startsAt: ago(60) } },
            away: { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", points: 13.4,
              projected: 13, live: true, statLine: LINES.WR,
              game: { state: "post", opponent: "SEA", away: true, startsAt: ago(240) } } })),
          managers: MANAGERS }
      : MATCHUP });
  });

  const MATCHUP = {
    week: 3, scheduled: true, final: false, live: true, started: true, weekPhase: "live",
    mine: true,
    winProbability: 0.56,
    home: { id: "m0", slot: "T01", name: "Conner Kocik", franchise: "Steel Cartel",
      total: 104.6, projected: 125.1, yetToPlay: 3, inPlay: 2, record: { w: 2, l: 1, t: 0 } },
    away: { id: "m3", slot: "T04", name: "Kimberley Vandenberghe-Whitlock",
      franchise: "Kim's Very Long Franchise Name", total: 98.2, projected: 113.7,
      yetToPlay: 4, inPlay: 1, record: { w: 1, l: 2, t: 0 } },
    rows: ROSTER.filter(([, slot]) => slot !== "BENCH").map(([n, slot]) => ({ slot,
      home: { name: n, position: slot, team: "WSH", points: 18.2, projected: 17,
        live: true, statLine: lineFor(slot === "FLEX" ? "RB" : slot),
        game: { state: "in", opponent: "PHI", away: false, startsAt: ago(60) } },
      // Not kicked off: no stat line, so the row has to say who he plays and
      // when instead — which is the whole reason the game is hung on him.
      away: { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", points: 0,
        projected: 22, live: false, statLine: "",
        game: { state: "pre", opponent: "LV", away: true, startsAt: ago(-180) } } })),
    managers: MANAGERS,
  };
  // The slate the ticker rides on. Without it the strip renders nothing, so
  // every audit run measured a home page with the top rail missing — and the
  // link into the gamecast lives inside that rail.
  const SLATE = [
    ["401671801", "PHI", "Eagles", 17, "WSH", "Commanders", 21, "in", "3rd Quarter · 4:12"],
    ["401671802", "KC", "Chiefs", 28, "BUF", "Bills", 24, "post", "Final"],
    ["401671803", "SF", "49ers", 0, "SEA", "Seahawks", 0, "pre", "Sun 1:00 PM"],
  ];
  page.route("**/api/scoreboard**", json({
    games: SLATE.map(([id, aa, an, as_, ha, hn, hs, state, detail]) => ({
      id, date: ago(60), week: 3, seasonType: 2, state,
      completed: state === "post", statusDetail: detail,
      away: { abbrev: aa, name: an, score: as_, homeAway: "away", winner: as_ > hs, logo: "" },
      home: { abbrev: ha, name: hn, score: hs, homeAway: "home", winner: hs > as_, logo: "" },
    })),
    week: 3, seasonType: 2, played: true, fetchedAt: new Date().toISOString(),
  }));

  // One live game with this league all over it. Enough owned players to make
  // the list scroll, one unowned name doing damage, and a play feed long
  // enough that the drive log has to lay out more than a sentence.
  page.route("**/api/game/**", json({
    game: {
      id: "401671801", date: ago(96), week: 3, seasonType: 2, state: "in",
      completed: false, statusDetail: "3rd Quarter · 4:12",
      home: { abbrev: "WSH", name: "Commanders", score: 21, homeAway: "home", winner: false, logo: "",
        linescores: [7, 7, 7] },
      away: { abbrev: "PHI", name: "Eagles", score: 17, homeAway: "away", winner: false, logo: "",
        linescores: [3, 7, 7] },
      // Where the ball is, which is what the pitch graphic draws. Only ever
      // sent on a game in play.
      situation: { possession: "PHI", downDistanceText: "2nd & 6 at WSH 34",
        down: 2, distance: 6, yardLine: 66, lineToGain: 72 },
    },
    owned: [
      { name: "Jayden Daniels", team: "WSH", position: "QB", points: 22.4,
        statLine: "241 yd, 2 TD", franchise: "Steel Cartel", managerId: "m0" },
      { name: "Marvin Harrison Jr.", team: "PHI", position: "WR", points: 14.1,
        statLine: "6 rec, 81 yd", franchise: "Steel Cartel", managerId: "m0" },
      { name: "Saquon Barkley", team: "PHI", position: "RB", points: 19.8,
        statLine: "17 car, 96 yd, 1 TD", franchise: "Kim's Very Long Franchise Name",
        managerId: "m3" },
      { name: "Terry McLaurin", team: "WSH", position: "WR", points: 9.4,
        statLine: "4 rec, 54 yd", franchise: "Northside Nomads", managerId: "m11" },
    ],
    notable: [
      { name: "Dallas Goedert", team: "PHI", position: "TE", points: 11.2,
        statLine: "5 rec, 62 yd, 1 TD", franchise: null, managerId: null },
    ],
    scoring: [
      { type: "TD", team: "WSH", text: "Jayden Daniels 12 Yd Run (Zane Gonzalez Kick)",
        points: 7, period: 3, clock: "8:41" },
      { type: "FG", team: "PHI", text: "Jake Elliott 47 Yd Field Goal",
        points: 3, period: 2, clock: "0:04" },
    ],
    plays: Array.from({ length: 9 }, (_, i) => ({
      id: `p${i}`, period: 3, clock: `${12 - i}:0${i}`,
      text: i === 0
        ? "Jayden Daniels pass complete short right to Terry McLaurin for 14 yards, tackled by Cooper DeJean at the PHI 31."
        : "Saquon Barkley rush up the middle for 3 yards.",
      scoring: i === 4, homeScore: 21, awayScore: 17,
    })),
    // The real football box score, in ESPN's own groups and columns. Wide on
    // purpose: passing is eight columns, which is what the table has to scroll
    // sideways inside itself rather than pushing the page.
    box: [
      {
        team: "PHI",
        groups: [
          { group: "passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"],
            rows: [{ name: "Jalen Hurts", values: ["18/27", "212", "7.9", "1", "0", "2-14", "71.4", "104.2"] }] },
          { group: "rushing", labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
            rows: [
              { name: "Saquon Barkley", values: ["17", "96", "5.6", "1", "23"] },
              { name: "Jalen Hurts", values: ["6", "31", "5.2", "0", "11"] },
            ] },
          { group: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
            rows: [
              { name: "Marvin Harrison Jr.", values: ["6", "81", "13.5", "0", "24", "9"] },
              { name: "Dallas Goedert", values: ["5", "62", "12.4", "1", "19", "6"] },
            ] },
        ],
      },
      {
        team: "WSH",
        groups: [
          { group: "passing", labels: ["C/ATT", "YDS", "AVG", "TD", "INT", "SACKS", "QBR", "RTG"],
            rows: [{ name: "Jayden Daniels", values: ["22/30", "241", "8.0", "2", "0", "1-7", "88.1", "119.6"] }] },
          { group: "rushing", labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
            rows: [{ name: "Jayden Daniels", values: ["8", "54", "6.8", "1", "12"] }] },
          { group: "receiving", labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
            rows: [{ name: "Terry McLaurin", values: ["4", "54", "13.5", "0", "21", "7"] }] },
        ],
      },
    ],
    teamTotals: {
      PHI: { firstDowns: "17", thirdDownEff: "5-13", totalYards: "309", netPassingYards: "198",
        rushingYards: "111", turnovers: "1", totalPenaltiesYards: "6-45",
        sacksYardsLost: "2-14", possessionTime: "28:12" },
      WSH: { firstDowns: "21", thirdDownEff: "8-14", totalYards: "372", netPassingYards: "234",
        rushingYards: "138", turnovers: "0", totalPenaltiesYards: "4-30",
        sacksYardsLost: "1-7", possessionTime: "31:48" },
    },
    fetchedAt: new Date().toISOString(),
  }));

  page.route("**/api/rankings", json({ points: {}, rostered: {}, basis: "2025" }));

  page.route("**/api/players**", json({
    me: ME, mode: "waivers", waiverDays: 1, capacity: 25, held: 13,
    roster: ROSTER.map(([n, s]) => ({ player_name: n, lineup_slot: s })),
    claims: [{ id: "c1", add_player: "Ashton Jeanty", drop_player: "Tank Bigsby",
      claim_order: 1, status: "pending", reason: null }],
    wire: [
      { name: "Marvin Harrison Jr.", clearsAt: ago(-300), position: "WR", team: "ARI", mine: true },
      { name: "Jayden Reed", clearsAt: ago(-1800), position: "WR", team: "GB", mine: false },
    ],
    total: 3, page: 0, hasMore: false,
    players: [
      { name: "Ashton Jeanty", position: "RB", team: "LV", adp: 10, posRank: "RB6",
        bye: 10, clearsAt: null },
      { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", adp: 22, posRank: "WR9",
        bye: 8, clearsAt: ago(-300) },
      { name: "Seattle Seahawks D/ST", position: "D/ST", team: "SEA", adp: 240,
        posRank: "DST1", bye: 8, clearsAt: null },
    ],
  }));

  page.route("**/api/trades", json({
    me: ME, managers: MANAGERS, block: [], picks: [], inauguralSeason: 2026,
    trades: [{ id: "t1", from_manager: "m0", to_manager: "m3",
      offer: { give: ["Bijan Robinson"], get: ["Marvin Harrison Jr."], givePicks: [], getPicks: [] },
      status: "open", from_accepted: true, to_accepted: false, thread: [],
      created_at: ago(60), incoming: false, awaitingMe: false, canRescind: true }],
  }));
  // The chat, with state, so the room can actually be talked in: a route that
  // always answers the same thing would show a message appear and then vanish
  // on the next poll.
  let chat = [
    { id: "c1", managerId: "m3", body: "That trade was daylight robbery.",
      at: ago(42), mine: false },
    { id: "c2", managerId: "m0", body: "You accepted it.", at: ago(38), mine: true },
  ];

  page.route("**/api/chat**", (r) => {
    const method = r.request().method();

    if (method === "POST") {
      const body = JSON.parse(r.request().postData() ?? "{}");
      const message = {
        id: `c${chat.length + 1}`, managerId: "m0", body: body.body,
        at: new Date().toISOString(), mine: true,
      };
      chat = [...chat, message];
      return r.fulfill({ json: { ok: true, message } });
    }

    if (method === "DELETE") {
      const id = new URL(r.request().url()).searchParams.get("id");
      chat = chat.filter((m) => m.id !== id);
      return r.fulfill({ json: { ok: true } });
    }

    // `since` is honoured the way the real route honours it, because the
    // unread badge is built on it: a fixture that answers "everything" to a
    // question of "anything new?" makes an empty conversation look busy.
    const since = new URL(r.request().url()).searchParams.get("since");
    const messages = since
      ? chat.filter((m) => Date.parse(m.at) > Date.parse(since))
      : chat;

    return r.fulfill({ json: {
      me: { id: "m0", isCommissioner: true },
      managers: MANAGERS,
      messages,
    } });
  });

  page.route("**/api/rosters**", json({ players: ROSTER.map(([n]) => n) }));

  const PICKS = MANAGERS.map((m, i) => ({
    overall: i + 1, round: 1, manager_id: m.id,
    player_name: i < 2 ? ROSTER[i][0] : null,
    picked_at: i < 2 ? "2026-08-01T00:00:00Z" : null,
  }));
  // The clock is the round's, so the room is given the whole ladder as well as
  // the rung it is on. A queue with somebody already in it, because an empty
  // panel proves the empty state and nothing else.
  const PICK_CLOCK = [
    { throughRound: 4, seconds: 90 },
    { throughRound: 10, seconds: 75 },
    { throughRound: null, seconds: 60 },
  ];

  // The queue and the autodraft switch are state, not fixtures: the room polls
  // every five seconds and writes back what it holds, so a route that always
  // answers the same thing would quietly undo every edit a second after it was
  // made — and a check written against it would pass on a page that does not
  // work. These two remember.
  let queue = ["Marquez Valdes-Scantling", "Jacory Croskey-Merritt"];
  let autodraft = false;


  // Draft night is a sequence now, so the room can be asked for any point in
  // it. A draft in progress is the default; the lobby and the lottery are
  // asked for by name, because they are screens the audit would otherwise
  // never see and they are the two with the most on them.
  const draftState = over.draftState ?? process.env.AUDIT_DRAFT_STATE ?? "running";
  // How far into the pick the clock is, so the three states it can be in —
  // calm, amber, and the last five seconds — can each be looked at. A clock
  // only ever seen at ninety seconds is a clock whose urgent state is
  // never measured.
  const secondsGone = Number(over.secondsGone ?? process.env.AUDIT_SECONDS_GONE ?? 0);
  const lotteryAt =
    over.lotteryAt ?? process.env.AUDIT_LOTTERY_AT ?? new Date().toISOString();

  page.route("**/api/draft", (r) =>
    r.fulfill({ json: {
      me: { ...ME, is_commissioner: true, ready: true, autodraft },
      league: { state: draftState, currentPick: 3,
        pickStartedAt: new Date(Date.now() - secondsGone * 1000).toISOString(),
        pickSeconds: 90, pickClock: PICK_CLOCK, serverNow: new Date().toISOString(),
        // The hour, and the film. over.draftAt puts the countdown in the past
        // and over.introVideo gives the room something to play — together they
        // are the case that used to start itself: the clock crossing zero on a
        // pending draft nobody had opened.
        draftAt: over.draftAt ?? null,
        cinematicRounds: 3, introVideo: over.introVideo ?? null,
        starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
        lotteryOrder: MANAGERS.map((m) => m.slot), lotteryAt },
      onTheClock: over.myTurn ? { ...PICKS[2], manager_id: ME.id } : PICKS[2],
      myTurn: Boolean(over.myTurn),
      picks: PICKS,
      // The route sends a name only for a franchise somebody has claimed, so
      // the fixture does too — otherwise the lottery reads "Open Team · Open"
      // here and nowhere else.
      managers: MANAGERS.map((m) => ({
        ...m,
        name: m.name === "Open" ? null : m.name,
        // over.everyoneReady is the second trigger that used to start the film
        // without the commissioner: eleven people saying "I am here".
        ready: over.everyoneReady === true ? true : m.ready,
      })),
      available: [
        { name: "Ashton Jeanty", position: "RB", team: "LV", adp: 10, posRank: "RB6", bye: 10 },
        { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", adp: 22, posRank: "WR9", bye: 8 },
      ],
      queue,
    } }),
  );

  page.route("**/api/draft/queue", async (r) => {
    if (r.request().method() === "GET") return r.fulfill({ json: { queue } });
    const body = JSON.parse(r.request().postData() ?? "{}");
    queue = Array.isArray(body.players) ? body.players : queue;
    return r.fulfill({ json: { ok: true, count: queue.length, queue } });
  });

  page.route("**/api/draft/autodraft", async (r) => {
    const body = JSON.parse(r.request().postData() ?? "{}");
    autodraft = body.on === true;
    return r.fulfill({ json: { ok: true, autodraft } });
  });

  page.route("**/api/pickem**", json({
    week: 5, me: ME,
    games: [{ id: "e1", week: 5, starts_at: "2026-10-04T17:00:00Z", home_team: "CAR",
      away_team: "BUF", home_score: 24, away_score: 17, state: "post", winner: "CAR",
      completed: true }],
    picks: {},
    // managerId, because that is the field the route sends and the field the
    // board keys its rows on. Spreading the manager gave every row an `id` and
    // no `managerId`, so React drew twelve standings rows with no key at all
    // and said so in the console on every load.
    standings: MANAGERS.map((m, i) => ({
      ...m, managerId: m.id, correct: 40 - i, played: 60,
      pct: Math.round(((40 - i) / 60) * 1000) / 10, mine: i === 0,
    })),
  }));

  page.route("**/api/admin/league**", json({
    isCommissioner: true,
    league: { id: "l1", name: "Pylon Fantasy", season: 2026, settings: SETTINGS,
      draft_state: "pending", current_pick: 1, draft_at: null, lottery_order: null },
    managers: MANAGERS.map((m, i) => ({ ...m, claimed: m.name !== "Open",
      isCommissioner: i === 0,
      // Mid-collection: two still owing, so the office shows both states of
      // the row and the "everybody has paid" button is live.
      duesPaid: i > 1 })),
    board: { picks: 288, made: 0 }, canResize: true,
  }));
  page.route("**/api/admin/roster", json({
    managers: MANAGERS,
    players: ROSTER.map(([n]) => ({ name: n, managerId: "m0",
      franchise: "Steel Cartel", slot: "BENCH" })),
  }));
  page.route("**/api/admin/season", json({
    season: 2026, champion: "Iron Rail", isCommissioner: true,
  }));
}
