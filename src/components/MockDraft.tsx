"use client";

import { useEffect, useMemo, useState } from "react";
import { POOL, type Player, type Position } from "@/data/league-data";
import { chooseFor, rngFrom, snakeOrder } from "@/lib/mock-draft";
import { startingSlots } from "@/lib/lineup";
import DraftBoard from "./DraftBoard";

/**
 * A draft against the machine, so the first draft you do is not the real one.
 *
 * Nothing here touches the league. It runs on the same player pool the real
 * room draws from and the same snake, but the rosters live in this tab and go
 * when it closes — which is the point: you can take Bijan first overall four
 * times in a row and find out what comes back to you in the third round.
 */

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE", "K", "D/ST"];

const TINT: Record<string, string> = {
  QB: "#e5a3a3",
  RB: "#8fd3b0",
  WR: "#a8b8e8",
  TE: "#e0bb84",
  K: "#b0a8cc",
  "D/ST": "#a8a8bb",
};

const PACE = { instant: 0, brisk: 320, watchable: 900 };
type Pace = keyof typeof PACE;

interface Made {
  overall: number;
  round: number;
  seat: number;
  player: Player;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
};

const button = (enabled = true): React.CSSProperties => ({
  padding: "8px 14px",
  fontSize: 11,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

const chip = (on: boolean): React.CSSProperties => ({
  padding: "5px 10px",
  fontSize: 10,
  letterSpacing: ".1em",
  border: `1px solid ${on ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: on ? "rgba(145,132,217,.26)" : "transparent",
  color: on ? "#e9e9ed" : "#9397ab",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: "pointer",
});

export default function MockDraft() {
  const [teams, setTeams] = useState(12);
  const [rounds, setRounds] = useState(15);
  const [seat, setSeat] = useState(0);
  const [pace, setPace] = useState<Pace>("brisk");
  const [running, setRunning] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1e9));

  const [picks, setPicks] = useState<Made[]>([]);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  const league = useMemo(
    () => ({ starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 }, bench: rounds - 9 }),
    [rounds],
  );

  const order = useMemo(() => snakeOrder(teams, rounds), [teams, rounds]);

  // One generator for the whole draft, so the same seed replays the same room.
  const rng = useMemo(() => rngFrom(seed), [seed]);

  const taken = useMemo(() => new Set(picks.map((p) => p.player.n)), [picks]);
  const available = useMemo(
    () => POOL.filter((p) => p.adp > 0 && !taken.has(p.n)).sort((a, b) => a.adp - b.adp),
    [taken],
  );

  const onTheClock = order[picks.length];
  const finished = picks.length >= order.length;
  const myTurn = running && !finished && onTheClock === seat;
  const round = Math.floor(picks.length / teams) + 1;

  const rosterOf = (which: number) => picks.filter((p) => p.seat === which).map((p) => p.player);
  const myRoster = rosterOf(seat);

  function take(player: Player, forSeat: number) {
    setPicks((was) => [
      ...was,
      {
        overall: was.length + 1,
        round: Math.floor(was.length / teams) + 1,
        seat: forSeat,
        player,
      },
    ]);
  }

  // The machine's turn. Driven by a timer rather than an effect body so the
  // pace is a real pause you can watch, and so a change of mind between picks
  // cancels cleanly.
  useEffect(() => {
    if (!running || finished || onTheClock === seat) return;

    const timer = setTimeout(() => {
      const roster = picks.filter((p) => p.seat === onTheClock).map((p) => p.player);
      const pick = chooseFor(available, { roster, round, rounds, league }, rng);
      if (pick) take(pick, onTheClock);
    }, PACE[pace]);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, finished, onTheClock, picks.length, pace]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return available
      .filter((p) => (filter === "ALL" || p.p === filter) && (!q || p.n.toLowerCase().includes(q)))
      .slice(0, 60);
  }, [available, filter, search]);

  /**
   * Hand your own pick to the machine.
   *
   * Not a shortcut so much as a second opinion: it drafts for you exactly as
   * it drafts for the other eleven, so you can see what it would have done
   * with your roster and disagree with it.
   */
  function autoPick() {
    if (!myTurn) return;
    const pick = chooseFor(available, { roster: myRoster, round, rounds, league }, rng);
    if (pick) take(pick, seat);
  }

  function restart() {
    setPicks([]);
    setSeed(Math.floor(Math.random() * 1e9));
    setRunning(false);
  }

  // ------------------------------------------------------------- the board ---
  const boardManagers = useMemo(
    () =>
      Array.from({ length: teams }, (_, i) => ({
        id: String(i),
        slot: i === seat ? "YOU" : `CPU${i + 1}`,
        franchise: i === seat ? "Your team" : `Team ${i + 1}`,
      })),
    [teams, seat],
  );

  const boardPicks = useMemo(
    () =>
      order.map((s, i) => {
        const made = picks[i];
        return {
          overall: i + 1,
          round: Math.floor(i / teams) + 1,
          manager_id: String(s),
          player_name: made ? made.player.n : null,
          picked_at: made ? new Date().toISOString() : null,
        };
      }),
    [order, picks, teams],
  );

  if (!running && !picks.length) {
    return (
      <div style={{ padding: "24px 26px 40px", maxWidth: 760 }}>
        <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>PRACTICE</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.035em",
            margin: "8px 0 12px",
            fontWeight: 500,
          }}
        >
          Mock draft
        </h1>
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.7, margin: "0 0 22px", maxWidth: "62ch" }}>
          Eleven opponents who draft off ADP and then argue with it — for the
          starters they still need, the depth they are allowed to carry, and the
          bye weeks they have already collected. Nothing here touches the
          league; close the tab and it never happened.
        </p>

        <div style={{ ...card, padding: "16px 18px", marginBottom: 16 }}>
          <Row label="FRANCHISES">
            {[8, 10, 12, 14].map((n) => (
              <button
                key={n}
                onClick={() => {
                  setTeams(n);
                  if (seat >= n) setSeat(n - 1);
                }}
                style={chip(teams === n)}
              >
                {n}
              </button>
            ))}
          </Row>

          <Row label="ROUNDS">
            {[10, 13, 15, 18].map((n) => (
              <button key={n} onClick={() => setRounds(n)} style={chip(rounds === n)}>
                {n}
              </button>
            ))}
          </Row>

          <Row label="YOUR PICK">
            {Array.from({ length: teams }, (_, i) => (
              <button key={i} onClick={() => setSeat(i)} style={chip(seat === i)}>
                {i + 1}
              </button>
            ))}
          </Row>

          <Row label="PACE">
            {(Object.keys(PACE) as Pace[]).map((p) => (
              <button key={p} onClick={() => setPace(p)} style={chip(pace === p)}>
                {p}
              </button>
            ))}
          </Row>

          <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "14px 0 0" }}>
            Picking {seat + 1} of {teams} means your next two are {seat + 1} and{" "}
            {teams * 2 - seat}, then {teams * 2 + seat + 1} — the turn is what
            makes an early slot cost you later.
          </p>
        </div>

        <button onClick={() => setRunning(true)} style={{ ...button(), padding: "13px 30px", fontSize: 13 }}>
          Start the mock
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "18px 26px 40px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: ".28em", color: "#75798c" }}>
            {finished ? "MOCK COMPLETE" : "ON THE CLOCK"}
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 30, marginTop: 4 }}>
            {finished
              ? "That's the draft"
              : myTurn
                ? "You're up"
                : `Team ${(onTheClock ?? 0) + 1} is thinking`}
          </div>
          <div style={{ fontSize: 11, color: "#75798c", marginTop: 2 }}>
            {finished
              ? `${picks.length} picks over ${rounds} rounds`
              : `Round ${round} · pick ${picks.length + 1} of ${order.length}`}
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, marginLeft: "auto", flexWrap: "wrap" }}>
          {!finished && !running ? (
            <button onClick={() => setRunning(true)} style={button()}>
              Resume
            </button>
          ) : null}
          {!finished && running ? (
            <button onClick={() => setRunning(false)} style={button()}>
              Pause
            </button>
          ) : null}
          <button onClick={restart} style={button()}>
            Start over
          </button>
        </div>
      </div>

      {finished ? <Summary roster={myRoster} league={league} /> : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: finished ? "1fr" : "minmax(0,1fr) minmax(280px,340px)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ ...card, overflow: "hidden" }}>
          <DraftBoard
            picks={boardPicks}
            managers={boardManagers}
            meId={String(seat)}
            currentPick={picks.length + 1}
          />
        </div>

        {!finished ? (
          <div style={{ ...card, overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "11px 14px",
                borderBottom: "1px solid rgba(145,132,217,.18)",
                flexWrap: "wrap",
              }}
            >
              <h6 style={{ margin: 0, color: myTurn ? "#d2cefd" : "#75798c" }}>
                {myTurn ? "Your pick" : "Best available"}
              </h6>
              {myTurn ? (
                <button onClick={autoPick} style={{ ...button(), padding: "5px 10px", fontSize: 9.5 }}>
                  Let it pick
                </button>
              ) : null}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                aria-label="Search players"
                style={{
                  marginLeft: "auto",
                  width: 110,
                  padding: "5px 8px",
                  background: "rgba(20,22,35,.8)",
                  border: "1px solid rgba(145,132,217,.28)",
                  borderRadius: "var(--radius-sm)",
                  color: "#e9e9ed",
                  font: "inherit",
                  fontSize: 12,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 3, padding: "9px 14px", flexWrap: "wrap" }}>
              {POSITIONS.map((p) => (
                <button key={p} onClick={() => setFilter(p)} style={chip(filter === p)}>
                  {p === "D/ST" ? "DST" : p}
                </button>
              ))}
            </div>

            <div style={{ maxHeight: 460, overflowY: "auto" }}>
              {visible.map((p) => (
                <div
                  key={p.n}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "7px 14px",
                    borderTop: "1px solid rgba(145,132,217,.1)",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, color: "#e9e9ed" }}>{p.n}</div>
                    <div style={{ fontSize: 9.5, color: "#75798c", letterSpacing: ".06em" }}>
                      <span style={{ color: TINT[p.p] }}>{p.posRank || p.p}</span> · {p.t} · ADP{" "}
                      {p.adp}
                      {p.bye ? ` · BYE ${p.bye}` : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => take(p, seat)}
                    disabled={!myTurn}
                    style={{ ...button(myTurn), padding: "5px 11px", fontSize: 10 }}
                  >
                    Draft
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One setting and its choices.
 *
 * A labelled group rather than a row of loose buttons: three of these offer a
 * chip reading "10", and without the grouping neither a screen reader nor
 * anything else driving the page can tell which ten is which.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 11 }}
    >
      <span style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c", width: 90 }}>{label}</span>
      {children}
    </div>
  );
}

/**
 * What you came out with, judged the way the machine judged its own picks:
 * did you fill the lineup, and are half your starters off in the same week?
 */
function Summary({ roster, league }: { roster: Player[]; league: { starters: Record<string, number>; bench: number } }) {
  const slots = startingSlots(league);
  const counts: Record<string, number> = {};
  for (const p of roster) counts[p.p] = (counts[p.p] ?? 0) + 1;

  const need: Record<string, number> = {};
  for (const s of slots) need[s] = (need[s] ?? 0) + 1;

  const missing = (["QB", "RB", "WR", "TE", "K", "D/ST"] as Position[])
    .filter((p) => (counts[p] ?? 0) < (need[p] ?? 0))
    .map((p) => `${(need[p] ?? 0) - (counts[p] ?? 0)} ${p}`);

  const byes: Record<number, string[]> = {};
  for (const p of roster) {
    if (!p.bye || p.p === "K" || p.p === "D/ST") continue;
    (byes[p.bye] ??= []).push(p.n);
  }
  const crowded = Object.entries(byes)
    .filter(([, who]) => who.length >= 4)
    .sort((a, b) => b[1].length - a[1].length);

  return (
    <div style={{ ...card, padding: "16px 18px", marginBottom: 16 }}>
      <h6 style={{ margin: "0 0 10px", color: "#d2cefd" }}>How you came out</h6>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        {(["QB", "RB", "WR", "TE", "K", "D/ST"] as Position[]).map((p) => (
          <span key={p} style={{ fontSize: 11, color: "#9397ab" }}>
            <span style={{ color: TINT[p], letterSpacing: ".08em", fontSize: 9.5 }}>
              {p === "D/ST" ? "DST" : p}
            </span>{" "}
            {counts[p] ?? 0}
          </span>
        ))}
      </div>

      <p style={{ fontSize: 12, lineHeight: 1.7, color: missing.length ? "#e0b573" : "#7fd1a8", margin: "0 0 6px" }}>
        {missing.length
          ? `You cannot field a legal lineup — short ${missing.join(", ")}.`
          : "Every starting place is filled."}
      </p>

      <p style={{ fontSize: 12, lineHeight: 1.7, color: crowded.length ? "#e0b573" : "#9397ab", margin: 0 }}>
        {crowded.length
          ? `Week ${crowded[0][0]} takes ${crowded[0][1].length} of your players out at once: ${crowded[0][1].slice(0, 4).join(", ")}${crowded[0][1].length > 4 ? "…" : ""}.`
          : "No single bye week guts the roster."}
      </p>
    </div>
  );
}
