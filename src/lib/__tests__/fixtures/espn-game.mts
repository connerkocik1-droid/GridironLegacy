/**
 * One NFL game, in the shape ESPN's site API returns it.
 *
 * Hand-built rather than recorded, because a recorded summary is four hundred
 * kilobytes of which about thirty lines matter, and because a fixture you
 * wrote is a fixture whose right answer you know. The field names, the
 * "labels"/"stats" pairing, the compound "3/4" values and the scoring-play
 * shape are all copied from live responses — run `npm run verify-espn` against
 * a real game week to check they have not moved.
 *
 * Kansas City 24, Buffalo 15. Chosen so that every rule the scorer has an
 * opinion about actually fires once:
 *
 *   - two field goals of fifty-plus, which the box score cannot tell apart
 *     from one (it carries a single LONG)
 *   - a two-point conversion, which the box score has no column for at all
 *   - a safety, likewise
 *   - a missed extra point and a missed field goal
 *   - a fumble recovered by the team that fumbled it, which is not a takeaway
 *     and must not score for a defence
 *   - a quarterback ESPN spells with a suffix the league's own pool does not
 */

const boxScore = {
  players: [
    {
      team: { abbreviation: "KC" },
      statistics: [
        {
          name: "passing",
          labels: ["C/ATT", "YDS", "AVG", "TD", "INT"],
          athletes: [
            // ESPN's own spelling carries the suffix; the pool's does not.
            {
              athlete: { displayName: "Patrick Mahomes II" },
              stats: ["25/38", "300", "7.9", "1", "1"],
            },
          ],
        },
        {
          name: "rushing",
          labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
          athletes: [
            { athlete: { displayName: "Isiah Pacheco" }, stats: ["15", "80", "5.3", "1", "18"] },
          ],
        },
        {
          name: "receiving",
          labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
          athletes: [
            { athlete: { displayName: "Travis Kelce" }, stats: ["7", "90", "12.9", "1", "24", "9"] },
          ],
        },
        {
          name: "kicking",
          labels: ["FG", "PCT", "LONG", "XP", "PTS"],
          athletes: [
            { athlete: { displayName: "Harrison Butker" }, stats: ["3/4", "75.0", "54", "1/1", "10"] },
          ],
        },
        {
          name: "fumbles",
          labels: ["FUM", "LOST", "REC"],
          athletes: [
            // Fumbled and fell on it himself. Not a takeaway, and the old
            // scorer counted it as one.
            { athlete: { displayName: "Isiah Pacheco" }, stats: ["1", "0", "1"] },
            // A genuine recovery of Buffalo's fumble.
            { athlete: { displayName: "Chris Jones" }, stats: ["0", "0", "1"] },
          ],
        },
        {
          name: "defensive",
          labels: ["TOT", "SOLO", "SACKS", "TFL", "PD", "QB HTS", "TD"],
          athletes: [
            { athlete: { displayName: "Chris Jones" }, stats: ["4", "3", "2.0", "3", "1", "4", "0"] },
            { athlete: { displayName: "Nick Bolton" }, stats: ["9", "6", "1.0", "1", "0", "1", "0"] },
          ],
        },
        {
          name: "interceptions",
          labels: ["INT", "YDS", "TD"],
          athletes: [
            { athlete: { displayName: "Trent McDuffie" }, stats: ["1", "12", "0"] },
            { athlete: { displayName: "Jaylen Watson" }, stats: ["1", "0", "0"] },
          ],
        },
      ],
    },
    {
      team: { abbreviation: "BUF" },
      statistics: [
        {
          name: "passing",
          labels: ["C/ATT", "YDS", "AVG", "TD", "INT"],
          athletes: [
            { athlete: { displayName: "Josh Allen" }, stats: ["22/35", "250", "7.1", "1", "2"] },
          ],
        },
        {
          name: "rushing",
          labels: ["CAR", "YDS", "AVG", "TD", "LONG"],
          athletes: [
            { athlete: { displayName: "Josh Allen" }, stats: ["8", "40", "5.0", "1", "12"] },
            { athlete: { displayName: "James Cook" }, stats: ["18", "100", "5.6", "0", "22"] },
          ],
        },
        {
          name: "receiving",
          labels: ["REC", "YDS", "AVG", "TD", "LONG", "TGTS"],
          athletes: [
            { athlete: { displayName: "James Cook" }, stats: ["3", "20", "6.7", "1", "9", "3"] },
          ],
        },
        {
          name: "kicking",
          labels: ["FG", "PCT", "LONG", "XP", "PTS"],
          athletes: [
            { athlete: { displayName: "Tyler Bass" }, stats: ["0/0", "0.0", "0", "1/2", "1"] },
          ],
        },
        {
          name: "fumbles",
          labels: ["FUM", "LOST", "REC"],
          athletes: [
            { athlete: { displayName: "James Cook" }, stats: ["1", "1", "0"] },
          ],
        },
        {
          name: "defensive",
          labels: ["TOT", "SOLO", "SACKS", "TFL", "PD", "QB HTS", "TD"],
          athletes: [
            { athlete: { displayName: "Ed Oliver" }, stats: ["3", "2", "1.0", "2", "0", "2", "0"] },
          ],
        },
        {
          name: "interceptions",
          labels: ["INT", "YDS", "TD"],
          athletes: [
            { athlete: { displayName: "Terrel Bernard" }, stats: ["1", "5", "0"] },
          ],
        },
      ],
    },
  ],
};

/**
 * The scoring summary. `homeScore`/`awayScore` are the board *after* the play,
 * which is what lets the scorer tell a touchdown with a kick (seven) from one
 * with a two-point conversion (eight) without reading a word of the text.
 */
const scoringPlays = [
  {
    type: { abbreviation: "FG" },
    team: { abbreviation: "KC" },
    text: "Harrison Butker 54 Yd Field Goal",
    scoreValue: 3,
    homeScore: 3,
    awayScore: 0,
  },
  {
    type: { abbreviation: "TD" },
    team: { abbreviation: "BUF" },
    text: "Josh Allen 3 Yd Run (Tyler Bass Kick)",
    scoreValue: 6,
    homeScore: 3,
    awayScore: 7,
  },
  {
    type: { abbreviation: "TD" },
    team: { abbreviation: "KC" },
    text: "Patrick Mahomes 12 Yd pass to Travis Kelce (Harrison Butker Kick)",
    scoreValue: 6,
    homeScore: 10,
    awayScore: 7,
  },
  {
    type: { abbreviation: "TD" },
    team: { abbreviation: "KC" },
    text:
      "Isiah Pacheco 2 Yd Run (Patrick Mahomes Pass to Travis Kelce for Two-Point Conversion)",
    scoreValue: 6,
    homeScore: 18,
    awayScore: 7,
  },
  {
    type: { abbreviation: "SF" },
    team: { abbreviation: "BUF" },
    text: "Team Safety",
    scoreValue: 2,
    homeScore: 18,
    awayScore: 9,
  },
  {
    type: { abbreviation: "FG" },
    team: { abbreviation: "KC" },
    text: "Harrison Butker 52 Yd Field Goal",
    scoreValue: 3,
    homeScore: 21,
    awayScore: 9,
  },
  {
    type: { abbreviation: "TD" },
    team: { abbreviation: "BUF" },
    text: "Josh Allen 5 Yd pass to James Cook (Tyler Bass Kick Failed)",
    scoreValue: 6,
    homeScore: 21,
    awayScore: 15,
  },
  {
    type: { abbreviation: "FG" },
    team: { abbreviation: "KC" },
    text: "Harrison Butker 22 Yd Field Goal",
    scoreValue: 3,
    homeScore: 24,
    awayScore: 15,
  },
];

export const SUMMARY = {
  boxscore: boxScore,
  scoringPlays,
  header: {
    competitions: [
      {
        competitors: [
          { homeAway: "home", team: { abbreviation: "KC" } },
          { homeAway: "away", team: { abbreviation: "BUF" } },
        ],
      },
    ],
  },
};

export const SCOREBOARD = {
  events: [
    {
      id: "401671800",
      date: "2025-10-05T17:00Z",
      season: { type: 2 },
      week: { number: 5 },
      competitions: [
        {
          status: { type: { state: "post", completed: true, shortDetail: "Final" } },
          competitors: [
            {
              homeAway: "home",
              score: "24",
              winner: true,
              team: {
                abbreviation: "KC",
                displayName: "Kansas City Chiefs",
                logo: "https://example.invalid/kc.png",
              },
            },
            {
              homeAway: "away",
              score: "15",
              winner: false,
              team: {
                abbreviation: "BUF",
                displayName: "Buffalo Bills",
                logo: "https://example.invalid/buf.png",
              },
            },
          ],
        },
      ],
    },
  ],
};
