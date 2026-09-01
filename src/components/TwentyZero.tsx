"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ERA_LABELS, POOLS } from "@/data/twenty-zero-data";
import { NFL, logo } from "@/data/league-data";
import {
  DEFENSE,
  MULT,
  OFFENSE,
  SLOTS,
  type Candidate,
  type Roster,
  type Spin,
  drawSpin,
  isDefence,
  playable,
  reelValues,
  slotIndexFor,
  total,
} from "@/lib/twenty-zero";

/**
 * 20-0 mode.
 *
 * Twelve rounds. Each one spins a franchise and an era, and offers that
 * franchise's best seasons inside it; you take one, and it lands in whichever
 * slot fits. Rounds one to six build the offence, seven to twelve the defence.
 * Do all twelve and the roster scores. A perfect run is 20-0.
 *
 * Nothing here touches the dynasty league — it is a game about football
 * history played on 2002 to 2025, and it lives entirely in this tab.
 */

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Phase = "ready" | "spinning" | "board" | "locked" | "done";

/** The reel: 26 ticks, the era settling at 17 so the two locks land apart. */
const TICKS = 26;
const ERA_LOCK = 17;

/** Names to beat. Not real players — a run has to be measured against something. */
const SEED_BOARD = [
  { who: "hexline", score: 1284 },
  { who: "Vantablack", score: 1251 },
  { who: "cold_open", score: 1206 },
  { who: "Marrow", score: 1188 },
  { who: "nine_lives", score: 1140 },
  { who: "Torchbearer", score: 1097 },
];

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
};

const button = (enabled = true): React.CSSProperties => ({
  padding: "11px 24px",
  fontSize: 12,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  border: "1px solid rgba(181,171,252,.6)",
  background: "rgba(145,132,217,.14)",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

const quiet: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#75798c",
  font: "inherit",
  fontSize: 11.5,
  padding: 0,
  cursor: "pointer",
  textDecoration: "underline",
};

export default function TwentyZero() {
  const [round, setRound] = useState(0);
  const [roster, setRoster] = useState<Roster>(() => Array(SLOTS.length).fill(null));
  const [phase, setPhase] = useState<Phase>("ready");
  const [spun, setSpun] = useState<Spin | null>(null);

  const [reelTeam, setReelTeam] = useState<string | null>(null);
  const [reelEra, setReelEra] = useState<number | null>(null);
  const [eraLocked, setEraLocked] = useState(false);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const filled = roster.filter(Boolean).length;
  const score = total(roster);
  const complete = phase === "done" && filled === SLOTS.length;

  const spin = useCallback(() => {
    // The draw is settled before anything moves, so the reel comes to rest on
    // the real franchise rather than on a value the board then contradicts.
    const landed = drawSpin(POOLS, round, roster, Math.random);
    if (!landed) {
      setPhase("locked");
      setSpun(null);
      return;
    }

    const { teams, eras } = reelValues(round, POOLS);
    timers.current.forEach(clearTimeout);
    timers.current = [];

    setPhase("spinning");
    setEraLocked(false);
    setReelTeam(null);
    setReelEra(null);

    let tick = 0;
    const step = () => {
      tick++;
      const eraDone = tick >= ERA_LOCK;
      setReelTeam(tick >= TICKS ? landed.team : teams[Math.floor(Math.random() * teams.length)]);
      setReelEra(eraDone ? landed.era : eras[Math.floor(Math.random() * eras.length)]);
      setEraLocked(eraDone);

      if (tick < TICKS) {
        // Ease out: each tick sits a little longer than the last.
        const t = tick / TICKS;
        timers.current.push(setTimeout(step, 38 + Math.pow(t, 2.6) * 240));
      } else {
        // A beat on the settled pair before the board arrives.
        timers.current.push(
          setTimeout(() => {
            setSpun(landed);
            setPhase("board");
          }, 480),
        );
      }
    };

    timers.current.push(setTimeout(step, 0));
  }, [round, roster]);

  function take(candidate: Candidate) {
    const idx = slotIndexFor(candidate.season.pos, round, roster);
    if (idx < 0) return;

    const next = [...roster];
    next[idx] = candidate.season;
    const nextRound = round + 1;

    setRoster(next);
    setRound(nextRound);
    setSpun(null);
    // Measured against the roster this pick just made, not the one in state,
    // which has not committed yet.
    setPhase(
      nextRound >= SLOTS.length ? "done" : playable(nextRound, next, POOLS) ? "ready" : "locked",
    );
  }

  function skip() {
    const next = Math.min(round + 1, SLOTS.length);
    setRound(next);
    setSpun(null);
    setPhase(next >= SLOTS.length ? "done" : playable(next, roster, POOLS) ? "ready" : "locked");
  }

  function restart() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setRoster(Array(SLOTS.length).fill(null));
    setRound(0);
    setSpun(null);
    setPhase("ready");
  }

  const groups = useMemo(
    () => [
      { label: "OFFENCE · ROUNDS 1–6", from: 0, list: OFFENSE as readonly string[] },
      { label: "DEFENCE · ROUNDS 7–12", from: 6, list: DEFENSE as readonly string[] },
    ],
    [],
  );

  const leaderboard = complete
    ? [...SEED_BOARD, { who: "you · final", score: Math.round(score), me: true }]
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
    : [];

  const shownTeam = phase === "spinning" ? reelTeam : (spun?.team ?? null);
  const shownEra = phase === "spinning" ? reelEra : (spun?.era ?? null);
  const spinning = phase === "spinning";

  return (
    <div style={{ padding: "20px 26px 44px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>20-0 MODE</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 38,
          letterSpacing: "-.035em",
          margin: "8px 0 8px",
          fontWeight: 500,
        }}
      >
        Perfect draft
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.7, margin: "0 0 20px", maxWidth: "68ch" }}>
        Twelve rounds, twelve slots. Every round spins a franchise and an era,
        and you draft from what it lands on — each player&rsquo;s best season
        inside that window, from 2002 to 2025. Rounds 1–6 build the offence,
        7–12 the defence. QB, EDGE and CB score 1.5×. Nothing here touches your
        dynasty team.
      </p>

      <div className="gl-cols"
        style={{
          display: "grid",
          gridTemplateColumns: complete
            ? "minmax(230px,270px) minmax(0,1fr) minmax(210px,250px)"
            : "minmax(230px,270px) minmax(0,1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* ------------------------------------------------------ the roster --- */}
        <div style={{ ...card, padding: "14px 16px" }}>
          <div style={{ display: "flex", gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
            <Stat label="ROUND" value={round >= SLOTS.length ? "COMPLETE" : `${round + 1} / 12`} />
            <Stat
              label="SIDE"
              value={round >= SLOTS.length ? "—" : isDefence(round) ? "DEFENCE" : "OFFENCE"}
            />
            <Stat label="SCORE" value={complete ? String(Math.round(score)) : "—"} big />
          </div>

          {groups.map((g) => (
            <div key={g.label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, letterSpacing: ".18em", color: "#75798c", marginBottom: 6 }}>
                {g.label}
              </div>
              {g.list.map((pos, k) => {
                const i = g.from + k;
                const p = roster[i];
                const activeSide = round < SLOTS.length && (i >= OFFENSE.length) === isDefence(round);
                const live = !p && activeSide && phase !== "done";
                return (
                  <div
                    key={`${pos}-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 9px",
                      marginBottom: 3,
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${live ? "rgba(181,171,252,.55)" : "rgba(145,132,217,.16)"}`,
                      background: live
                        ? "rgba(145,132,217,.14)"
                        : p
                          ? "rgba(26,28,43,.7)"
                          : "transparent",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 10,
                        letterSpacing: ".1em",
                        color: "#9397ab",
                        width: 54,
                        flex: "0 0 auto",
                      }}
                    >
                      {pos}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 10,
                        color: "#e0b573",
                        width: 22,
                        flex: "0 0 auto",
                      }}
                    >
                      {MULT[pos] ? `${MULT[pos]}×` : ""}
                    </span>
                    <span
                      style={{
                        fontSize: 11.5,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                        color: p ? "#e9e9ed" : live ? "#b5abfc" : "#595d6c",
                      }}
                    >
                      {p ? `${p.n} · ${p.yr}` : live ? "open" : "empty"}
                    </span>
                    {/* A filled slot reads as locked in, never as a number: the
                        score is a result, and revealing it early would turn each
                        round into arithmetic. */}
                    <span style={{ color: "#7fd1a8", fontSize: 11 }}>{p ? "✓" : ""}</span>
                  </div>
                );
              })}
            </div>
          ))}

          <button onClick={restart} style={quiet}>
            {phase === "done" ? "New run" : "Restart run"}
          </button>
        </div>

        {/* ------------------------------------------------------ the middle --- */}
        <div style={{ ...card, overflow: "hidden", minHeight: 420 }}>
          {phase === "ready" || phase === "spinning" ? (
            <div style={{ padding: "26px 22px 30px", textAlign: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>
                {spinning
                  ? "SPINNING"
                  : `ROUND ${round + 1} · ${isDefence(round) ? "DEFENCE" : "OFFENCE"}`}
              </div>

              <div style={{ margin: "18px 0 4px", minHeight: 140, display: "grid", placeItems: "center" }}>
                {shownTeam ? (
                  // A plain <img>: these are local team marks, and next/image
                  // has nothing to optimise about a 72px PNG already on disk.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo(shownTeam) || BLANK}
                    alt=""
                    style={{
                      width: 132,
                      height: 132,
                      objectFit: "contain",
                      transition: "filter .12s ease, opacity .12s ease",
                      filter: spinning
                        ? "grayscale(1) brightness(1.5) blur(1.4px)"
                        : "drop-shadow(0 0 30px rgba(181,171,252,.55))",
                      opacity: spinning ? 0.6 : 1,
                    }}
                  />
                ) : (
                  <div style={{ width: 132, height: 132 }} />
                )}
              </div>

              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 64,
                  lineHeight: 1,
                  letterSpacing: "-.04em",
                  transition: "color .12s ease, filter .12s ease",
                  color: spinning ? "#8a8fa6" : "#d2cefd",
                  filter: spinning ? "blur(1.1px)" : "none",
                  textShadow: spinning ? "none" : "0 0 46px rgba(181,171,252,.55)",
                }}
              >
                {shownTeam ?? "···"}
              </div>
              <div style={{ fontSize: 10, letterSpacing: ".26em", color: "#75798c", marginTop: 4 }}>
                FRANCHISE
              </div>

              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 40,
                  lineHeight: 1.4,
                  letterSpacing: "-.03em",
                  marginTop: 14,
                  transition: "color .12s ease, filter .12s ease",
                  color: spinning && !eraLocked ? "#8a8fa6" : "#e9e9ed",
                  filter: spinning && !eraLocked ? "blur(1.1px)" : "none",
                }}
              >
                {shownEra == null ? "····" : (ERA_LABELS[shownEra] ?? "—")}
              </div>
              <div style={{ fontSize: 10, letterSpacing: ".26em", color: "#75798c", marginTop: 4 }}>
                ERA
              </div>

              <p
                style={{
                  fontSize: 12,
                  color: "#9397ab",
                  lineHeight: 1.7,
                  maxWidth: "52ch",
                  margin: "20px auto 18px",
                }}
              >
                {spinning
                  ? eraLocked
                    ? "Era locked. Drawing the franchise."
                    : "Drawing a franchise and an era."
                  : "Every round is a spin. You draft from the franchise and era it lands on, taking each player's best season inside that window."}
              </p>

              <button onClick={spin} disabled={spinning} style={button(!spinning)}>
                {spinning ? "Spinning…" : `Spin round ${round + 1}`}
              </button>
            </div>
          ) : null}

          {phase === "board" && spun ? (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "13px 16px",
                  borderBottom: "1px solid rgba(145,132,217,.18)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={logo(spun.team) || BLANK}
                  alt=""
                  style={{ width: 34, height: 34, objectFit: "contain" }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "#e9e9ed" }}>
                    {NFL[spun.team] ?? spun.team}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c", marginTop: 2 }}>
                    {ERA_LABELS[spun.era]} ·{" "}
                    {spun.candidates.filter((c) => c.own).length} FROM THIS FRANCHISE ·{" "}
                    {spun.candidates.filter((c) => !c.own).length} ERA WILDCARDS
                  </div>
                </div>
              </div>

              {spun.candidates.map((c, i) => {
                const idx = slotIndexFor(c.season.pos, round, roster);
                const target = idx > -1 ? SLOTS[idx] : null;
                const onPosition = Boolean(target) && target !== "FLEX";
                return (
                  <button
                    key={c.season.n + c.season.yr}
                    onClick={() => take(c)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 16px",
                      border: 0,
                      borderTop: i ? "1px solid rgba(145,132,217,.14)" : "0",
                      background: c.own ? "rgba(30,33,54,.72)" : "rgba(20,22,36,.6)",
                      color: "inherit",
                      font: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
                      <span
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontSize: 11,
                          letterSpacing: ".1em",
                          color: c.own ? "#b5abfc" : "#75798c",
                        }}
                      >
                        {c.season.pos}
                      </span>
                      <span style={{ fontSize: 13.5, color: "#e9e9ed" }}>{c.season.n}</span>
                      <span style={{ fontSize: 10.5, color: "#75798c" }}>
                        {c.season.yr} {c.season.t}
                      </span>
                      {!c.own ? (
                        <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#e0b573" }}>
                          WILDCARD
                        </span>
                      ) : null}
                      <span
                        style={{
                          marginLeft: "auto",
                          fontFamily: "var(--font-heading)",
                          fontSize: 10,
                          letterSpacing: ".14em",
                          color: onPosition ? "#b5abfc" : "#e0b573",
                        }}
                      >
                        {target ? (onPosition ? target : `${target} ←`) : "—"}
                        {target && MULT[target] ? ` ${MULT[target]}×` : ""}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "#9397ab", marginTop: 3 }}>{c.season.line}</div>
                    <div style={{ fontSize: 10.5, color: "#75798c" }}>{c.season.line2}</div>
                  </button>
                );
              })}

              <div style={{ padding: "12px 16px" }}>
                <button onClick={spin} style={quiet}>
                  spin again — forfeits this round&rsquo;s board
                </button>
              </div>
            </div>
          ) : null}

          {phase === "locked" ? (
            <div style={{ padding: "40px 26px", textAlign: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#e0b573" }}>
                NOTHING LEFT TO PLACE
              </div>
              <p
                style={{
                  fontSize: 12.5,
                  color: "#9397ab",
                  lineHeight: 1.7,
                  maxWidth: "52ch",
                  margin: "12px auto 20px",
                }}
              >
                Every slot this round could fill is already taken, so there is
                nothing to draft into. Skipping leaves the slot empty — and a
                run only scores on a full twelve.
              </p>
              <button onClick={skip} style={button()}>
                Skip round {round + 1}
              </button>
            </div>
          ) : null}

          {phase === "done" ? (
            <div style={{ padding: "44px 26px", textAlign: "center" }}>
              <div style={{ fontSize: 10, letterSpacing: ".3em", color: "#75798c" }}>
                {complete ? "RUN COMPLETE" : "RUN ENDED"}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: complete ? 68 : 34,
                  lineHeight: 1.1,
                  color: complete ? "#d2cefd" : "#e0b573",
                  margin: "12px 0 6px",
                  textShadow: complete ? "0 0 40px rgba(181,171,252,.5)" : "none",
                }}
              >
                {complete ? Math.round(score) : "INCOMPLETE"}
              </div>
              <div style={{ fontSize: 11, color: "#75798c" }}>{filled} of 12 slots filled</div>
              {!complete ? (
                <p
                  style={{
                    fontSize: 12,
                    color: "#9397ab",
                    lineHeight: 1.7,
                    maxWidth: "50ch",
                    margin: "14px auto 0",
                  }}
                >
                  A run only scores on a full twelve-slot roster, so this one
                  earns nothing and does not reach the leaderboard.
                </p>
              ) : null}
              <div style={{ marginTop: 24 }}>
                <button onClick={restart} style={button()}>
                  New run
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ------------------------------------------------- the leaderboard --- */}
        {complete ? (
          <div style={{ ...card, padding: "16px 14px" }}>
            <div style={{ fontSize: 10, letterSpacing: ".22em", color: "#75798c", marginBottom: 10 }}>
              LEADERBOARD
            </div>
            {leaderboard.map((l, i) => (
              <div
                key={l.who}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 9px",
                  marginBottom: 2,
                  borderRadius: "var(--radius-sm)",
                  background: "me" in l && l.me ? "rgba(145,132,217,.18)" : "#141625",
                }}
              >
                <span style={{ fontSize: 10, color: "#75798c", width: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 12, flex: 1, minWidth: 0, color: "#e9e9ed" }}>{l.who}</span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 13, color: "#d2cefd" }}>
                  {l.score}
                </span>
              </div>
            ))}
            <p style={{ fontSize: 10.5, color: "#75798c", lineHeight: 1.6, margin: "12px 0 0" }}>
              Perfect run is 20-0. Every slot scores its season, multiplied
              where the position carries one.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c" }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: big ? 22 : 15,
          lineHeight: 1.2,
          marginTop: 3,
          color: big ? "#b5abfc" : "#e9e9ed",
          textShadow: big ? "0 0 22px rgba(181,171,252,.5)" : "none",
        }}
      >
        {value}
      </div>
    </div>
  );
}
