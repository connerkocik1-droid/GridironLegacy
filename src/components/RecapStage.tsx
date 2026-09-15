"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { headshot } from "@/data/league-data";
import {
  BEAT_MS,
  FADE_MS,
  beatAt,
  beatPlan,
  marginLine,
  mvpNote,
  nextOpponentLine,
  recapFacts,
  standingsNote,
  streakLine,
  topScoreLine,
  type RecapData,
} from "@/lib/recap";

/**
 * The recap itself: four beats that replace each other, on one clock.
 *
 * They replace rather than stack, which is what keeps the whole thing inside
 * one phone screen. The result, then the league's highest score, then the man
 * who carried your week, then where it leaves you — and then it fades away and
 * gives the app back without being asked.
 *
 * Two things about the machinery are load-bearing and neither is obvious:
 *
 * The clock is an interval, not requestAnimationFrame. rAF is throttled to
 * zero frames in a hidden document, and this feature fires on app open — an
 * rAF clock can freeze the recap at t=0 and never play it at all. The interval
 * quantises to a 60ms boundary so unrelated re-renders do not touch animated
 * nodes.
 *
 * One departure from the handoff, on purpose: its micro-labels were drawn at
 * 9px and every one of them here is 10, which is the floor the mobile audit
 * holds the rest of the app to. A kicker is a sentence, and a sentence a
 * reader has to lean in for is one the recap did not say. The 7px LEAD chip
 * and the 8px RECORD caption stay as drawn — both sit against a large number
 * that already says what they say.
 *
 * And every keyframe lives in globals.css as a class rather than in any style
 * object here. Not because React would restart it — it writes only the style
 * properties that changed, so an unchanged animation string is left alone —
 * but because the reduced-motion override switches the whole recap off from
 * one rule, and an inline animation outranks it. The rule the file keeps is
 * the one its own check can catch being broken.
 */
export default function RecapStage({
  data,
  onDismiss,
}: {
  data: RecapData;
  onDismiss: () => void;
}) {
  const facts = useMemo(() => recapFacts(data), [data]);
  const { starts, end } = useMemo(() => beatPlan(BEAT_MS), []);

  const [t, setT] = useState(0);
  const [done, setDone] = useState(false);
  const [reduced, setReduced] = useState(false);

  // Set when the clock starts, in an effect. Reading the wall clock during
  // render would make the first frame depend on when React happened to run.
  const t0 = useRef(0);
  const held = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const closed = useRef(false);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const run = useCallback(() => {
    stop();
    timer.current = setInterval(() => {
      const at = Date.now() - t0.current;
      if (at > end) {
        stop();
        setT(end);
        setDone(true);
        return;
      }
      setT(Math.round(at / 60) * 60);
    }, 60);
  }, [end, stop]);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(query.matches);
    const listen = () => setReduced(query.matches);
    query.addEventListener("change", listen);
    return () => query.removeEventListener("change", listen);
  }, []);

  useEffect(() => {
    t0.current = Date.now();
    run();

    // Date.now() keeps running while the app is backgrounded. Without this, a
    // notification arriving mid-play hands the manager back a recap that has
    // already finished — the one thing they opened the app to see, missed.
    const onVisibility = () => {
      if (document.hidden) {
        if (timer.current) {
          held.current = Date.now() - t0.current;
          stop();
        }
      } else if (held.current != null && !closed.current) {
        t0.current = Date.now() - held.current;
        held.current = null;
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [run, stop]);

  // The overlay owns the screen while it plays, so the page behind it must not
  // scroll under the thumb.
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = was;
    };
  }, []);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    stop();
    setDone(true);
    // Let the fade finish before Home comes back, so it is a dissolve rather
    // than a cut.
    window.setTimeout(onDismiss, FADE_MS);
  }, [onDismiss, stop]);

  const jump = useCallback(
    (beat: number) => {
      t0.current = Date.now() - starts[beat];
      held.current = null;
      setT(starts[beat]);
      run();
    },
    [run, starts],
  );

  const beat = beatAt(t, starts);
  const last = starts.length - 1;

  const advance = useCallback(() => {
    if (closed.current) return;
    if (beat < last) jump(beat + 1);
    else close();
  }, [beat, close, jump, last]);

  // Escape closes it. Tap-to-advance is the whole interaction on a phone, and
  // on a keyboard it is no interaction at all.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!facts) return null;
  const f = facts;

  const inBeat = t - starts[beat];
  /** Whether a staged reveal has arrived. Asked for less motion, all of them have. */
  const shown = (at: number) => reduced || inBeat > at;
  /** A number counting up, or simply the number when motion is not wanted. */
  const ease = (to: number, at: number, dur: number) => {
    if (reduced) return to;
    if (inBeat <= at) return 0;
    const k = Math.min(1, (inBeat - at) / dur);
    return to * (1 - Math.pow(1 - k, 3));
  };

  const won = f.won;
  const accent = f.tied ? "var(--rc-accent)" : won ? "var(--rc-win)" : "var(--rc-loss)";
  const topAccent = f.topIsMe ? "var(--rc-win)" : "var(--rc-gold)";

  const meNow = ease(f.myScore, 900, 1400);
  const oppNow = ease(f.theirScore, 900, 1400);
  const topNow = ease(f.top?.points ?? 0, 700, 1300);

  return (
    <div
      className="gl-recap"
      role="dialog"
      aria-modal="true"
      aria-label={`Week ${f.week} recap`}
    >
      <div
        onClick={advance}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: done ? "none" : "auto",
          cursor: "pointer",
          transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease`,
          opacity: done ? 0 : 1,
          transform: done ? "scale(1.04)" : "scale(1)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
            width: 440,
            maxWidth: "130%",
            height: 360,
            pointerEvents: "none",
            borderRadius: "50%",
            filter: "blur(20px)",
            // A win lights from below; a loss weighs from above.
            top: won ? -70 : -130,
            background: won
              ? "radial-gradient(circle,rgba(127,216,168,.26),transparent 68%)"
              : "radial-gradient(circle,rgba(224,181,115,.15),transparent 62%)",
            opacity: t > 200 || reduced ? 1 : 0,
            transition: "opacity .9s ease",
          }}
        />

        {/* Win and loss are two literal branches, not one element with a
            swapped colour. The rays and the embers below exist only on a win,
            and their absence is what a loss feels like. */}
        {won && beat === 0 && inBeat < 2200 ? (
          <div
            className="rc-rays"
            style={{
              position: "absolute",
              top: 96,
              left: "50%",
              width: 340,
              height: 340,
              marginLeft: -170,
              pointerEvents: "none",
              background:
                "repeating-conic-gradient(from 0deg,rgba(127,216,168,.17) 0deg 5deg, transparent 5deg 22deg)",
              WebkitMaskImage: "radial-gradient(circle,transparent 26%,#000 46%,transparent 74%)",
              maskImage: "radial-gradient(circle,transparent 26%,#000 46%,transparent 74%)",
              willChange: "transform,opacity",
            }}
          />
        ) : null}

        {won && beat === 0 && inBeat < 3400 ? (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            {SPARKS.map((s, n) => (
              <span
                key={n}
                className="rc-spark"
                style={{
                  position: "absolute",
                  top: s.top,
                  left: s.left,
                  width: s.size,
                  height: s.size,
                  borderRadius: "50%",
                  background: s.green ? "#7fd8a8" : "rgba(181,171,252,.85)",
                  boxShadow: `0 0 8px ${s.green ? "#7fd8a8" : "rgba(181,171,252,.85)"}`,
                }}
              />
            ))}
          </div>
        ) : null}

        {!won && beat === 0 && inBeat < 2400 ? (
          <div
            className="rc-shade"
            style={{
              position: "absolute",
              top: 120,
              left: 0,
              right: 0,
              height: 230,
              pointerEvents: "none",
              background:
                "linear-gradient(180deg,transparent,rgba(224,181,115,.13) 45%,rgba(11,13,22,.4) 92%,transparent)",
              willChange: "transform,opacity",
            }}
          />
        ) : null}

        <div
          style={{
            position: "relative",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            padding: "0 22px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 62 }}>
            <span style={{ fontSize: 10, letterSpacing: ".3em", color: "var(--rc-faint)" }}>
              {`WEEK ${f.week} · FINAL`}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
              {starts.map((_, n) => (
                <button
                  key={n}
                  aria-label={`Beat ${n + 1} of ${starts.length}`}
                  aria-current={beat === n}
                  onClick={(e) => {
                    // The scrim behind these advances on tap, so without this a
                    // dot would jump and then immediately advance again.
                    e.stopPropagation();
                    jump(n);
                  }}
                  style={{
                    cursor: "pointer",
                    padding: 0,
                    border: 0,
                    borderRadius: 99,
                    height: 4,
                    transition: "width .3s ease, background .3s ease",
                    width: beat === n ? 18 : 4,
                    background: beat === n ? "var(--rc-accent)" : "rgba(145,132,217,.34)",
                  }}
                />
              ))}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  close();
                }}
                aria-label="Close the recap"
                style={{
                  marginLeft: 8,
                  cursor: "pointer",
                  border: 0,
                  background: "none",
                  color: "var(--rc-faint)",
                  fontSize: 10,
                  letterSpacing: ".18em",
                  padding: "10px 0 10px 8px",
                }}
              >
                SKIP
              </button>
            </div>
          </div>

          {beat === 0 ? (
            <Beat>
              <div style={{ textAlign: "center", marginTop: 24 }}>
                {won ? (
                  <>
                    <div
                      className="rc-stamp"
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 54,
                        lineHeight: 1,
                        letterSpacing: ".06em",
                        color: "var(--rc-win)",
                        textShadow: "0 0 44px rgba(127,216,168,.6)",
                      }}
                    >
                      WON
                    </div>
                    <div className="rc-fade" style={SUB}>{`Week ${f.week} is yours`}</div>
                  </>
                ) : (
                  <>
                    <div
                      className="rc-drop"
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 54,
                        lineHeight: 1,
                        letterSpacing: ".06em",
                        color: f.tied ? "var(--rc-accent)" : "var(--rc-loss)",
                        textShadow: f.tied
                          ? "0 0 26px rgba(181,171,252,.35)"
                          : "0 0 26px rgba(224,181,115,.3)",
                      }}
                    >
                      {f.tied ? "TIED" : "LOST"}
                    </div>
                    <div className="rc-sink" style={SUB}>
                      {f.tied ? `Week ${f.week} went nowhere` : `Week ${f.week} got away`}
                    </div>
                  </>
                )}
              </div>

              <div style={{ marginTop: 34 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto 1fr",
                    alignItems: "end",
                    gap: 12,
                  }}
                >
                  <div className="rc-in-l">
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={SIDE_NAME}>{f.me.franchise.toUpperCase()}</span>
                      <span style={leadChip(accent, meNow > 0 && meNow >= oppNow)}>LEAD</span>
                    </div>
                    <div style={sideScore(meNow >= oppNow)}>{meNow.toFixed(1)}</div>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 10,
                      letterSpacing: ".16em",
                      color: "var(--rc-ghost)",
                      paddingBottom: 9,
                    }}
                  >
                    VS
                  </div>
                  <div className="rc-in-r" style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        justifyContent: "flex-end",
                      }}
                    >
                      <span style={leadChip(accent, oppNow > meNow)}>LEAD</span>
                      <span style={SIDE_NAME}>
                        {(f.opponent?.franchise ?? "BYE").toUpperCase()}
                      </span>
                    </div>
                    <div style={sideScore(oppNow > meNow)}>{oppNow.toFixed(1)}</div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 14,
                    height: 5,
                    borderRadius: 99,
                    background: "rgba(145,132,217,.16)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 99,
                      background: "linear-gradient(90deg,var(--rc-deep),var(--rc-accent))",
                      boxShadow: "0 0 12px rgba(181,171,252,.55)",
                      transition: "width 1.4s cubic-bezier(.2,.8,.2,1)",
                      width: shown(900)
                        ? `${((f.myScore / Math.max(0.1, f.myScore + f.theirScore)) * 100).toFixed(1)}%`
                        : 0,
                    }}
                  />
                </div>

                <div
                  style={{
                    fontSize: 11,
                    letterSpacing: ".1em",
                    color: accent,
                    marginTop: 12,
                    textAlign: "center",
                    opacity: shown(2000) ? 1 : 0,
                    transition: "opacity .6s ease",
                  }}
                >
                  {marginLine(f)}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  marginTop: 26,
                  padding: "11px 13px",
                  borderRadius: 11,
                  border: "1px solid var(--rc-line)",
                  background: "rgba(20,22,36,.6)",
                  opacity: shown(2600) ? 1 : 0,
                  transform: shown(2600) ? "none" : "translateY(10px)",
                  transition: "all .5s ease",
                }}
              >
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {f.results.map((r, n) => (
                    <span
                      key={n}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background:
                          r === "W"
                            ? "var(--rc-win)"
                            : r === "L"
                              ? "rgba(224,122,122,.65)"
                              : "var(--rc-ghost)",
                      }}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 10, letterSpacing: ".1em", color: "var(--rc-dim)" }}>
                  {streakLine(f)}
                </span>
              </div>
            </Beat>
          ) : null}

          {beat === 1 && f.top && f.topTeam ? (
            <Beat>
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <div style={{ fontSize: 10, letterSpacing: ".26em", color: topAccent }}>
                  {f.topIsMe
                    ? "HIGHEST SCORE OF THE WEEK — THAT WAS YOU"
                    : "HIGHEST SCORE OF THE WEEK"}
                </div>
              </div>

              <div
                style={{
                  position: "relative",
                  marginTop: 20,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  color: topAccent,
                }}
              >
                {inBeat < 2600 && !reduced ? (
                  <>
                    <div className="rc-ring" style={RING} />
                    <div className="rc-ring-late" style={RING} />
                  </>
                ) : null}
                <div
                  className="rc-crown"
                  style={{
                    position: "relative",
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${f.topIsMe ? "rgba(127,216,168,.4)" : "rgba(232,197,106,.4)"}`,
                    background: `radial-gradient(circle at 50% 30%,${
                      f.topIsMe ? "rgba(127,216,168,.15)" : "rgba(232,197,106,.15)"
                    },rgba(20,22,36,.8))`,
                  }}
                >
                  <Crown />
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 46,
                    lineHeight: 1,
                    marginTop: 16,
                    color: topAccent,
                    textShadow: `0 0 34px ${f.topIsMe ? "rgba(127,216,168,.35)" : "rgba(232,197,106,.35)"}`,
                  }}
                >
                  {topNow.toFixed(1)}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 18,
                    lineHeight: 1.2,
                    letterSpacing: "-.02em",
                    marginTop: 12,
                    textAlign: "center",
                    color: "var(--rc-text)",
                  }}
                >
                  {f.topTeam.franchise}
                </div>
                <div
                  style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--rc-dim)", marginTop: 6 }}
                >
                  {`${f.topTeam.owner.toUpperCase()} · ${f.topRecord}`}
                </div>
              </div>

              <div
                style={{
                  fontSize: 11,
                  lineHeight: 1.55,
                  color: "var(--rc-mute)",
                  marginTop: 16,
                  textAlign: "center",
                  opacity: shown(1300) ? 1 : 0,
                  transition: "opacity .6s ease",
                }}
              >
                {topScoreLine(f)}
              </div>

              <div style={{ marginTop: 20 }}>
                <div style={BOARD_LABEL}>{`WEEK ${f.week} SCOREBOARD`}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.board.slice(0, 4).map((row, n) => {
                    const team = data.teams.find((x) => x.id === row.id);
                    const at = 1500 + n * 140;
                    return (
                      <div key={row.id} style={cascade(shown(at))}>
                        <span
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontSize: 10,
                            color: "var(--rc-ghost)",
                            width: 14,
                            flex: "0 0 auto",
                          }}
                        >
                          {n + 1}
                        </span>
                        <span style={ROW_NAME}>{team?.franchise ?? "—"}</span>
                        <div style={TRACK}>
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 99,
                              transition: "width .7s cubic-bezier(.2,.8,.2,1)",
                              width: shown(at)
                                ? `${((row.points / Math.max(0.1, f.top!.points)) * 100).toFixed(0)}%`
                                : 0,
                              background:
                                n === 0
                                  ? `linear-gradient(90deg,${topAccent},${topAccent})`
                                  : row.id === f.me.id
                                    ? "linear-gradient(90deg,var(--rc-deep),var(--rc-accent))"
                                    : "rgba(181,171,252,.34)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            ...ROW_PTS,
                            color:
                              n === 0
                                ? topAccent
                                : row.id === f.me.id
                                  ? "var(--rc-accent)"
                                  : "var(--rc-dim)",
                          }}
                        >
                          {row.points.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Beat>
          ) : null}

          {beat === 2 && f.mvp ? (
            <Beat>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <div style={{ fontSize: 10, letterSpacing: ".3em", color: "var(--rc-accent)" }}>
                  {`YOUR WEEK ${f.week} MVP`}
                </div>
              </div>

              <div
                className="rc-pop"
                style={{
                  marginTop: 22,
                  border: "1px solid rgba(145,132,217,.34)",
                  borderRadius: 16,
                  overflow: "hidden",
                  background: "linear-gradient(160deg,rgba(38,32,64,.92),rgba(20,22,36,.88))",
                  position: "relative",
                  boxShadow: "0 18px 40px rgba(0,0,0,.45)",
                }}
              >
                <div
                  className="rc-sweep"
                  style={{
                    position: "absolute",
                    inset: 0,
                    pointerEvents: "none",
                    background:
                      "linear-gradient(115deg,transparent 44%,rgba(181,171,252,.15) 50%,transparent 56%)",
                    backgroundSize: "220% 100%",
                  }}
                />
                <div
                  style={{
                    padding: 16,
                    position: "relative",
                    display: "flex",
                    gap: 14,
                    alignItems: "center",
                  }}
                >
                  <div style={{ position: "relative", flex: "0 0 auto" }}>
                    <div
                      className="rc-halo"
                      style={{
                        position: "absolute",
                        inset: -6,
                        borderRadius: 15,
                        background: "radial-gradient(circle,rgba(181,171,252,.55),transparent 70%)",
                      }}
                    />
                    <Face name={f.mvp.name} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 20,
                        lineHeight: 1.15,
                        letterSpacing: "-.02em",
                      }}
                    >
                      {f.mvp.name}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: ".1em",
                        color: "var(--rc-faint)",
                        marginTop: 5,
                      }}
                    >
                      {[f.mvp.position, f.mvp.team].filter(Boolean).join(" · ")}
                    </div>
                    <div
                      style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 10 }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontSize: 28,
                          lineHeight: 1,
                          color: "var(--rc-accent)",
                        }}
                      >
                        {f.mvp.points.toFixed(1)}
                      </span>
                      <span
                        style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--rc-faint)" }}
                      >
                        {`${Math.round(f.share)}% OF YOUR POINTS`}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={{ padding: "0 16px 14px", position: "relative" }}>
                  <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--rc-mute)" }}>
                    {mvpNote(f)}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 18 }}>
                <div style={BOARD_LABEL}>WHO CARRIED IT</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {f.byPoints.slice(0, 5).map((p, n) => {
                    const at = 700 + n * 130;
                    return (
                      <div key={p.name} style={cascade(shown(at))}>
                        <span style={{ ...ROW_NAME, flex: "0 0 96px" }}>{p.name}</span>
                        <div style={TRACK}>
                          <div
                            style={{
                              height: "100%",
                              borderRadius: 99,
                              transition: "width .7s cubic-bezier(.2,.8,.2,1)",
                              width: shown(at)
                                ? `${((p.points / Math.max(0.1, f.mvp!.points)) * 100).toFixed(0)}%`
                                : 0,
                              background:
                                n === 0
                                  ? "linear-gradient(90deg,var(--rc-deep),var(--rc-accent))"
                                  : "rgba(181,171,252,.4)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            ...ROW_PTS,
                            width: 38,
                            color: n === 0 ? "var(--rc-accent)" : "var(--rc-dim)",
                          }}
                        >
                          {p.points.toFixed(1)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Beat>
          ) : null}

          {beat === 3 ? (
            <Beat>
              <div style={{ textAlign: "center", marginTop: 20 }}>
                <div style={{ fontSize: 10, letterSpacing: ".3em", color: "var(--rc-faint)" }}>
                  WHERE IT LEAVES YOU
                </div>
              </div>

              <div
                className="rc-slide"
                style={{
                  marginTop: 22,
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  padding: 15,
                  borderRadius: 14,
                  border: "1px solid rgba(145,132,217,.24)",
                  background: "var(--rc-panel)",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flex: "0 0 auto" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 15,
                      color: "var(--rc-ghost)",
                      textDecoration: "line-through",
                    }}
                  >
                    {`#${f.rankBefore}`}
                  </span>
                  <span style={{ color: "var(--rc-ghost)", fontSize: 11 }}>→</span>
                  <span
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 28,
                      lineHeight: 1,
                      color: "var(--rc-accent)",
                    }}
                  >
                    {`#${f.rankAfter}`}
                  </span>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-heading)",
                      fontSize: 11,
                      letterSpacing: ".14em",
                      color:
                        f.moved > 0
                          ? "var(--rc-win)"
                          : f.moved < 0
                            ? "var(--rc-down)"
                            : "var(--rc-dim)",
                    }}
                  >
                    {f.moved > 0 ? `UP ${f.moved}` : f.moved < 0 ? `DOWN ${Math.abs(f.moved)}` : "HELD"}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--rc-dim)",
                      marginTop: 5,
                      lineHeight: 1.45,
                    }}
                  >
                    {standingsNote(f)}
                  </div>
                </div>
              </div>

              {f.next ? (
                <div
                  className="rc-slide-late"
                  style={{
                    marginTop: 20,
                    border: "1px solid rgba(145,132,217,.3)",
                    borderRadius: 16,
                    overflow: "hidden",
                    background: "linear-gradient(160deg,rgba(34,30,56,.9),rgba(20,22,36,.86))",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "11px 14px",
                      borderBottom: "1px solid var(--rc-line)",
                    }}
                  >
                    <span
                      style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--rc-accent)" }}
                    >
                      {`WEEK ${f.next.week} · NEXT UP`}
                    </span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        letterSpacing: ".12em",
                        color: "var(--rc-faint)",
                      }}
                    >
                      {kickoffLabel(f.next.kickoff)}
                    </span>
                  </div>
                  <div style={{ padding: 14 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontSize: 17,
                            lineHeight: 1.2,
                          }}
                        >
                          {f.next.team.franchise}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--rc-dim)", marginTop: 5 }}>
                          {`${f.next.team.owner} · ${f.next.pointsFor.toFixed(1)} points for`}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                        <div
                          style={{
                            fontFamily: "var(--font-heading)",
                            fontSize: 16,
                            color: "var(--rc-accent)",
                          }}
                        >
                          {f.next.record}
                        </div>
                        <div
                          style={{
                            fontSize: 8,
                            letterSpacing: ".14em",
                            color: "var(--rc-ghost)",
                            marginTop: 3,
                          }}
                        >
                          RECORD
                        </div>
                      </div>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        lineHeight: 1.5,
                        color: "#d2cefd",
                        marginTop: 12,
                        padding: "9px 11px",
                        borderRadius: 9,
                        background: "rgba(145,132,217,.12)",
                      }}
                    >
                      {nextOpponentLine(f)}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="rc-slide-late"
                  style={{
                    marginTop: 20,
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid rgba(145,132,217,.24)",
                    background: "var(--rc-panel)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    color: "var(--rc-mute)",
                  }}
                >
                  Nothing on the schedule after this one yet.
                </div>
              )}

              <div style={{ marginTop: "auto", paddingBottom: 26 }}>
                <div
                  style={{
                    height: 2,
                    borderRadius: 99,
                    background: "rgba(145,132,217,.16)",
                    overflow: "hidden",
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      borderRadius: 99,
                      background: "linear-gradient(90deg,var(--rc-deep),var(--rc-accent))",
                      width: `${Math.max(0, Math.min(100, ((end - t) / Math.max(1, end - starts[3])) * 100)).toFixed(1)}%`,
                    }}
                  />
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                  }}
                  style={{
                    cursor: "pointer",
                    width: "100%",
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
                    letterSpacing: ".18em",
                    padding: "14px 0",
                    borderRadius: 10,
                    border: "1px solid rgba(181,171,252,.6)",
                    background: "rgba(145,132,217,.14)",
                    color: "var(--rc-accent)",
                  }}
                >
                  TAKE ME HOME
                </button>
              </div>
            </Beat>
          ) : null}

          {!done && beat !== last ? (
            <div style={{ marginTop: "auto", paddingBottom: 30, textAlign: "center" }}>
              <span style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--rc-ghost)" }}>
                TAP FOR NEXT
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One beat, filling the space under the header. They replace, never stack. */
function Beat({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 22,
        right: 22,
        top: 112,
        bottom: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {children}
    </div>
  );
}

function Face({ name }: { name: string }) {
  const src = headshot(name);
  if (!src) {
    return (
      <div
        style={{
          width: 82,
          height: 82,
          borderRadius: 12,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          border: "1px solid rgba(145,132,217,.35)",
          background: "rgba(20,22,36,.8)",
          fontFamily: "var(--font-heading)",
          fontSize: 22,
          color: "var(--rc-accent)",
        }}
      >
        {name.split(" ")[0]?.[0] ?? "?"}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={82}
      height={82}
      style={{
        width: 82,
        height: 82,
        borderRadius: 12,
        position: "relative",
        objectFit: "contain",
        border: "1px solid rgba(145,132,217,.35)",
        background: "rgba(20,22,36,.8)",
      }}
    />
  );
}

function Crown() {
  return (
    <svg width="30" height="30" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
      <path d="M248 96a15.8 15.8 0 0 0-9.4 3.1l-.2.2-40.9 30.7-33.5-71.8a16 16 0 0 0-28.9 0L101.6 130 60.7 99.3l-.2-.2A16 16 0 0 0 35.4 115l19.5 97.7A16 16 0 0 0 70.6 224h114.8a16 16 0 0 0 15.7-11.3L220.6 115A16 16 0 0 0 248 96Z" />
    </svg>
  );
}

/** "THU 8:20 PM", in the reader's own timezone. */
function kickoffLabel(at: string | null): string {
  if (!at) return "";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return `${when
    .toLocaleDateString(undefined, { weekday: "short" })
    .toUpperCase()} ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

const SPARKS = [
  { top: 196, left: "7%", size: 5, green: true },
  { top: 210, left: "18%", size: 3, green: false },
  { top: 224, left: "30%", size: 3, green: false },
  { top: 196, left: "42%", size: 5, green: true },
  { top: 210, left: "54%", size: 3, green: false },
  { top: 224, left: "66%", size: 3, green: true },
  { top: 196, left: "78%", size: 5, green: false },
  { top: 210, left: "90%", size: 3, green: false },
];

const SUB: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".16em",
  color: "var(--rc-dim)",
  marginTop: 12,
};

const SIDE_NAME: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".12em",
  color: "var(--rc-dim)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const RING: React.CSSProperties = {
  position: "absolute",
  top: -6,
  left: "50%",
  width: 120,
  height: 120,
  marginLeft: -60,
  pointerEvents: "none",
  borderRadius: "50%",
  border: "1px solid currentColor",
};

const BOARD_LABEL: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".22em",
  color: "var(--rc-faint)",
  paddingBottom: 10,
};

const ROW_NAME: React.CSSProperties = {
  fontSize: 11,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  minWidth: 0,
  flex: "0 0 92px",
};

const ROW_PTS: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 12,
  flex: "0 0 auto",
  width: 40,
  textAlign: "right",
};

const TRACK: React.CSSProperties = {
  flex: 1,
  height: 5,
  borderRadius: 99,
  background: "rgba(145,132,217,.13)",
  overflow: "hidden",
};

function sideScore(leading: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-heading)",
    fontSize: 34,
    lineHeight: 1,
    marginTop: 7,
    color: leading ? "var(--rc-text)" : "var(--rc-dim)",
  };
}

/** The chip that flips sides live as the counters pass each other. */
function leadChip(accent: string, on: boolean): React.CSSProperties {
  return {
    fontSize: 7,
    letterSpacing: ".14em",
    padding: "2px 5px",
    borderRadius: 3,
    flex: "0 0 auto",
    transition: "opacity .25s ease",
    border: `1px solid ${accent}`,
    color: accent,
    opacity: on ? 1 : 0,
  };
}

/** A list row sliding in on its own delay. */
function cascade(on: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 9,
    opacity: on ? 1 : 0,
    transform: on ? "none" : "translateX(-12px)",
    transition: "all .45s cubic-bezier(.2,.8,.2,1)",
  };
}
