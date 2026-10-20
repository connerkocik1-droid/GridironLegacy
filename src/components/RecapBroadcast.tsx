"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { headshot, logo as clubLogo } from "@/data/league-data";
import { recapFacts, type RecapData } from "@/lib/recap";
import {
  BROADCAST_BEATS as DUR,
  BROADCAST_END as END,
  BROADCAST_FADE as FADE,
  BROADCAST_STARTS as S,
  STING_MS,
  broadcastBeat,
  formOf,
  highScore,
  mvpLine,
  nextLine,
  playoffPicture,
  tapTarget,
  verdictLine,
  verdictNote,
} from "@/lib/recap-broadcast";
import { recordOf } from "@/lib/recap";
import { useLogos } from "@/lib/use-logos";
import TeamCrest from "./TeamCrest";

/**
 * Week Recap v2, the broadcast cut: a full-screen takeover over the app on the
 * first open after a week is graded, 12.4s in four beats — the result, your
 * MVP, the playoff picture, and a share card — each cut behind a branded
 * stinger wipe. From the "Pylon Week Recap v2" design handoff.
 *
 * The handoff's animation rules, kept:
 *  - Keyframes are literal on their elements and start when their beat mounts.
 *    The clock only drives text and transition-driven properties; a keyframe
 *    in a per-tick style would restart every tick and never leave frame 0.
 *  - List staggers (the MVP's supporting players, the seed rail) are
 *    transitions toggled by the clock against a per-item delay.
 *  - The clock is setInterval at 60ms, not requestAnimationFrame, which stops
 *    in a hidden document — and this plays on app open.
 *  - Hidden mid-play, the clock pauses and resumes where it was.
 *  - Win and loss are separate branches with separate motion.
 *  - The stinger covers the screen from 46% to 54% of its 700ms, and the beat
 *    swaps at its midpoint, so a cut is never seen.
 *
 * The design is drawn on a 402×874 phone; the stage keeps exactly that layout
 * and scales to fit whatever screen it is on.
 */

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const cl = (x: number) => Math.max(0, Math.min(1, x));
const initials = (n: string) =>
  n
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

function Pylon({ w, h, band = true }: { w: number; h: number; band?: boolean }) {
  return (
    <svg width={w} height={h} viewBox="28 6 44 108" style={{ flex: "0 0 auto", overflow: "visible", filter: "drop-shadow(0 0 3px rgba(245,138,68,.7))" }}>
      <polygon points="32,20 50,30 50,110 32,100" style={{ fill: "rgba(255,180,106,.42)" }} />
      <polygon points="50,30 68,20 68,100 50,110" style={{ fill: "rgba(245,138,68,.72)" }} />
      <polygon points="50,8 70,19 50,30 30,19" style={{ fill: "#ffe2c4" }} />
      {band ? <polygon points="32,62 50,72 68,62 68,72 50,82 32,72" style={{ fill: "#161826", opacity: 0.75 }} /> : null}
      <line x1="50" y1="30" x2="50" y2="110" style={{ stroke: "#ffe2c4", strokeWidth: 4 }} />
    </svg>
  );
}

/** A face, over its initials, which show if there is no picture. */
function Face({ name, size, radius, font }: { name: string; size: number; radius: string | number; font: number }) {
  const src = headshot(name);
  return (
    <span style={{ position: "relative", flex: "0 0 auto", width: size, height: size, borderRadius: radius, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: font, fontWeight: 600, fontStyle: "italic", color: "var(--ap-a100)", background: "color-mix(in oklch, var(--ap-accent) 22%, transparent)" }}>
      {initials(name)}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
      ) : null}
    </span>
  );
}

export default function RecapBroadcast({ data, onDismiss }: { data: RecapData; onDismiss: () => void }) {
  const f = useMemo(() => recapFacts(data), [data]);
  const pic = useMemo(() => (f ? playoffPicture(data, f) : null), [data, f]);
  const logos = useLogos();

  const [t, setT] = useState(0);
  const [shared, setShared] = useState<string | null>(null);
  // Read before the first paint, so the stage never shows at the wrong size.
  // This only ever mounts in the browser: WeekRecap fetches before it renders.
  const [scale, setScale] = useState(() =>
    typeof window === "undefined" ? 1 : Math.min(window.innerWidth / 402, window.innerHeight / 874),
  );
  const [reduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const t0 = useRef(0);
  const hidAt = useRef(0);
  const gone = useRef(false);

  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 402, window.innerHeight / 874));
    window.addEventListener("resize", fit);

    t0.current = Date.now();
    // setInterval, not rAF: rAF stops in a hidden document, and this fires on app open.
    const iv = setInterval(() => {
      if (document.hidden) return;
      const at = Math.floor((Date.now() - t0.current) / 60) * 60;
      setT(Math.min(at, END + FADE + 60));
    }, 60);
    // Hidden mid-play: hold the clock, so a notification does not skip the recap.
    const onVis = () => {
      if (document.hidden) hidAt.current = Date.now();
      else if (hidAt.current) {
        t0.current += Date.now() - hidAt.current;
        hidAt.current = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      window.removeEventListener("resize", fit);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (t >= END + FADE && !gone.current) {
      gone.current = true;
      onDismiss();
    }
  }, [t, onDismiss]);

  const jump = useCallback((to: number) => {
    t0.current = Date.now() - to;
    setT(to);
  }, []);

  if (!f || !pic) return null;

  const teamById = new Map(data.teams.map((x) => [x.id, x]));
  const crest = (id: string, size: number, glow = false) => {
    const team = teamById.get(id);
    return (
      <span style={{ display: "inline-flex", flex: "0 0 auto", filter: `drop-shadow(0 3px 8px rgba(0,0,0,.4))${glow ? " drop-shadow(0 0 8px var(--ap-accent))" : ""}` }}>
        <TeamCrest franchise={team?.franchise ?? "?"} logo={logos[id] ?? (team?.slot ? logos[team.slot] : null) ?? null} size={size} shape="box" />
      </span>
    );
  };

  const won = f.won;
  const lost = !f.won;
  const opp = f.opponent;
  const top = highScore(f);
  const mvp = f.mvp;
  const support = f.byPoints.slice(1, 4);
  const next = f.next;
  const verdictWord = f.tied ? "TIE" : won ? "WIN" : "LOSS";

  // ------------------------------------------------- what the clock drives ---
  const beat = broadcastBeat(t);
  const ended = t >= END;
  const p = reduced || t >= S[1] ? 1 : ease(cl((t - 350) / 1100));
  const settled = reduced || t >= 1450;
  const mv = reduced || t >= S[2] ? 1 : ease(cl((t - S[1] - 450) / 900));
  const lt2 = t - S[1];
  const lt3 = t - S[2];
  const scoreColour = (mine: boolean) => (!settled ? "var(--text)" : mine && won ? "#c9f5dc" : !mine && !won ? "var(--text)" : "var(--ap-n500)");
  const scoreStyle = (mine: boolean): React.CSSProperties => ({
    fontSize: 50,
    marginTop: 6,
    fontWeight: 300,
    fontStyle: "italic",
    letterSpacing: "-.05em",
    lineHeight: 1,
    transition: "color .4s ease",
    color: scoreColour(mine),
  });
  const shown = (on: boolean): React.CSSProperties => (on || reduced ? { opacity: 1, transform: "none" } : { opacity: 0, transform: "translateY(12px)" });
  // Which cut the stinger is covering, if any; keyed by it so a tap that lands
  // mid-wipe still gets a whole wipe over the next cut.
  const sting = reduced ? -1 : S.slice(1).findIndex((b) => t >= b - STING_MS && t < b + STING_MS);
  const segs = [0, 1, 2, 3].map((i) => cl((t - S[i]) / DUR[i]) * 100);
  const countdown = beat === 3 ? cl((END - t) / (END - S[3])) * 100 : 100;

  const onTap = () => jump(tapTarget(t));
  const close = (e: React.MouseEvent) => {
    e.stopPropagation();
    jump(END);
  };
  const share = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const text =
      `Week ${f.week}: ${verdictWord} ${f.myScore.toFixed(1)}–${f.theirScore.toFixed(1)}` +
      (opp ? ` vs ${opp.franchise}` : "") +
      (mvp ? `. MVP ${mvp.name}, ${mvp.points.toFixed(1)}.` : ".") +
      ` Seed ${pic.seedAfter}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Week ${f.week} recap · Pylon Fantasy`, text, url: window.location.origin });
        setShared("SHARED");
      } else {
        await navigator.clipboard.writeText(`${text} ${window.location.origin}`);
        setShared("COPIED");
      }
    } catch {
      // Dismissing the share sheet is not an error worth showing.
    }
  };

  const seedTagStyle: React.CSSProperties = {
    display: "inline-block",
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: ".08em",
    padding: "3px 7px",
    borderRadius: 2,
    whiteSpace: "nowrap",
    ...(pic.tone === "up"
      ? { color: "#c9f5dc", background: "rgba(127,216,168,.16)" }
      : pic.tone === "down"
        ? { color: "#ffc9c9", background: "rgba(224,122,122,.16)" }
        : { color: "var(--ap-n300)", background: "color-mix(in oklch, var(--text) 8%, transparent)" }),
  };
  const teams = pic.rail.length;
  const cut = (pic.field / teams) * 100;

  // Into <body>: the page's entrance animation transforms its wrapper, which
  // would trap a fixed overlay under the tab bar.
  return createPortal(
    <div
      className={reduced ? "r2-reduced" : undefined}
      role="dialog"
      aria-label={`Week ${f.week} recap`}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        overflow: "hidden",
        background: "var(--bg)",
        transition: "opacity .6s ease",
        opacity: ended ? 0 : 1,
        pointerEvents: ended ? "none" : "auto",
      }}
    >
      <div
        onClick={onTap}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 402,
          height: 874,
          marginLeft: -201,
          marginTop: -437,
          transform: `scale(${scale})${ended ? " scale(1.04)" : ""}`,
          // Only the exit moves: a resize or the first fit snaps.
          transition: ended ? "transform .6s ease" : "none",
          overflow: "hidden",
          cursor: "pointer",
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          background:
            "radial-gradient(520px 420px at 50% 20%, var(--ap-section-glow), transparent 70%), radial-gradient(480px 380px at 85% 105%, var(--ap-section), transparent 70%), var(--bg)",
        }}
      >
        {/* The header: the mark, the week, SKIP, and four progress segments. */}
        <div style={{ position: "absolute", top: 56, left: 16, right: 16, zIndex: 20, display: "flex", alignItems: "center", gap: 8 }}>
          <Pylon w={10} h={20} />
          <span style={{ fontSize: 11, fontWeight: 600, fontStyle: "italic", letterSpacing: ".16em" }}>WEEK {f.week}</span>
          <span style={{ fontSize: 11, fontStyle: "italic", letterSpacing: ".16em", color: "var(--ap-a300)" }}>RECAP</span>
          <button type="button" onClick={close} style={{ marginLeft: "auto", cursor: "pointer", fontFamily: "inherit", fontSize: 10, letterSpacing: ".18em", padding: "5px 10px", minHeight: 32, borderRadius: 3, border: "1px solid color-mix(in oklch, var(--text) 14%, transparent)", background: "transparent", color: "var(--ap-n300)" }}>
            SKIP
          </button>
        </div>
        <div style={{ position: "absolute", top: 96, left: 16, right: 16, zIndex: 20, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
          {segs.map((w, i) => (
            <div key={i} style={{ height: 2, borderRadius: 1, overflow: "hidden", background: "color-mix(in oklch, var(--text) 14%, transparent)" }}>
              <div style={{ height: "100%", background: "var(--ap-a200)", boxShadow: "0 0 6px var(--ap-accent)", transition: "width .08s linear", width: `${w.toFixed(1)}%` }} />
            </div>
          ))}
        </div>

        {/* ------------------------------------------------- 1 · the result */}
        {beat === 0 && !ended ? (
          <div className="r2-fade" data-beat="1" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", top: 124, left: 18, right: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6, minWidth: 0, animation: "r2-inL .55s cubic-bezier(.2,.8,.2,1) .05s both" }}>
                {crest(data.meId, 84)}
                <div style={{ fontSize: 12, fontWeight: 500, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4 }}>{f.me.franchise}</div>
                <div style={{ fontSize: 10, color: "var(--ap-n500)" }}>
                  {f.me.owner} · {f.record}
                </div>
                <div style={scoreStyle(true)}>{(f.myScore * p).toFixed(1)}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 0, textAlign: "right", animation: "r2-inR .55s cubic-bezier(.2,.8,.2,1) .12s both" }}>
                {opp ? crest(opp.id, 84) : null}
                <div style={{ fontSize: 12, fontWeight: 500, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 4 }}>{opp?.franchise ?? "Bye"}</div>
                <div style={{ fontSize: 10, color: "var(--ap-n500)" }}>
                  {opp ? `${opp.owner} · ${recordOf(data.games, opp.id, f.week)}` : ""}
                </div>
                <div style={scoreStyle(false)}>{(f.theirScore * p).toFixed(1)}</div>
              </div>
            </div>

            {won ? (
              <>
                <div style={{ position: "absolute", top: 350, left: -30, right: -30, height: 124, transformOrigin: "left center", overflow: "hidden", background: "linear-gradient(90deg, rgba(127,216,168,.05), rgba(127,216,168,.22) 45%, rgba(127,216,168,.07))", borderTop: "1px solid rgba(127,216,168,.6)", borderBottom: "1px solid rgba(127,216,168,.25)", transform: "skewY(-5deg)", animation: "r2-slab .35s cubic-bezier(.7,0,.2,1) .7s both" }}>
                  <div className="r2-motion-only" data-streak style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "36%", background: "linear-gradient(90deg,transparent,rgba(232,255,242,.35),transparent)", animation: "r2-streak .9s ease 1.05s both" }} />
                  <div className="r2-motion-only" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "20%", background: "linear-gradient(90deg,transparent,rgba(232,255,242,.22),transparent)", animation: "r2-streak 1.1s ease 1.3s both" }} />
                </div>
                <div data-verdict="win" style={{ position: "absolute", top: 350, left: 0, right: 0, height: 124, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 112, lineHeight: 1, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.06em", color: "#e6fff0", textShadow: "0 0 28px rgba(127,216,168,.55)", animation: "r2-slam .6s cubic-bezier(.2,.8,.2,1) .85s both" }}>
                  WIN
                </div>
              </>
            ) : null}
            {lost ? (
              <>
                <div style={{ position: "absolute", top: 350, left: -30, right: -30, height: 124, transformOrigin: "left center", overflow: "hidden", background: "linear-gradient(90deg, rgba(224,181,115,.05), rgba(224,181,115,.18) 45%, rgba(224,181,115,.06))", borderTop: "1px solid rgba(224,181,115,.55)", borderBottom: "1px solid rgba(224,181,115,.2)", transform: "skewY(-5deg)", animation: "r2-slab .45s cubic-bezier(.7,0,.2,1) .7s both" }}>
                  <div data-shade style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(8,6,2,.45), transparent)", animation: "r2-shade .9s ease 1.1s both" }} />
                </div>
                <div data-verdict="loss" style={{ position: "absolute", top: 350, left: 0, right: 0, height: 124, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 112, lineHeight: 1, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.06em", color: "#ffe9c9", textShadow: "0 0 22px rgba(224,181,115,.45)", animation: "r2-drop .7s cubic-bezier(.3,1.2,.5,1) .9s both" }}>
                  {verdictWord}
                </div>
              </>
            ) : null}

            <div style={{ position: "absolute", top: 494, left: 18, right: 18, textAlign: "center", animation: "r2-up .4s ease 1.3s both" }}>
              <div style={{ fontSize: 13, color: "var(--ap-n200)" }}>{verdictLine(f)}</div>
              <div style={{ fontSize: 11, color: "var(--ap-n500)", marginTop: 5 }}>{verdictNote(f)}</div>
            </div>

            {top ? (
              <div style={{ position: "absolute", left: 16, right: 16, bottom: 150, animation: "r2-wipe .5s cubic-bezier(.7,0,.2,1) 1.8s both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 6, background: "linear-gradient(90deg, rgba(232,197,106,.16), color-mix(in oklch, var(--text) 4%, transparent))", border: "1px solid rgba(232,197,106,.45)", boxShadow: "inset 0 1px 0 color-mix(in oklch, var(--text) 10%, transparent)" }}>
                  <svg width="22" height="18" viewBox="0 0 22 18" style={{ flex: "0 0 auto" }} aria-hidden>
                    <path d="M1 5 L6 10 L11 2 L16 10 L21 5 L19 16 L3 16 Z" style={{ fill: "#e8c56a" }} />
                  </svg>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#e8c56a" }}>{top.kicker}</div>
                    <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{top.line}</div>
                    <div style={{ fontSize: 10, color: "var(--ap-n400)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{top.sub}</div>
                  </div>
                  {f.top ? crest(f.top.id, 34) : null}
                  <span style={{ fontSize: 24, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", color: "#f3dc9c" }}>{f.top?.points.toFixed(1)}</span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ------------------------------------------------- 2 · your MVP */}
        {beat === 1 && !ended && mvp ? (
          <div className="r2-fade" data-beat="2" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", top: 96, left: 0, right: 0, height: 410, overflow: "hidden", animation: "r2-push .9s cubic-bezier(.2,.8,.2,1) both" }}>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "radial-gradient(260px 300px at 50% 40%, color-mix(in oklch, var(--ap-accent) 32%, transparent), transparent 70%)", fontSize: 130, fontWeight: 300, fontStyle: "italic", color: "color-mix(in oklch, var(--text) 10%, transparent)" }}>
                {initials(mvp.name)}
              </div>
              {headshot(mvp.name) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={headshot(mvp.name)} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} onError={(e) => (e.currentTarget.style.visibility = "hidden")} />
              ) : null}
              <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 190, background: "linear-gradient(180deg,transparent,var(--bg))", pointerEvents: "none" }} />
            </div>
            <div style={{ position: "absolute", left: 20, right: 20, top: 392 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, animation: "r2-in .3s ease .35s both" }}>
                <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".22em", padding: "3px 7px", borderRadius: 2, color: "var(--bg)", background: "var(--ap-a200)" }}>YOUR MVP</span>
                {clubLogo(mvp.team) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={clubLogo(mvp.team)} alt="" width={24} height={24} style={{ objectFit: "contain" }} />
                ) : null}
                <span style={{ fontSize: 11, color: "var(--ap-n400)" }}>
                  {mvp.position === "DST" ? "D/ST" : mvp.position} · {mvp.team}
                </span>
              </div>
              <div style={{ fontSize: 20, fontStyle: "italic", marginTop: 10, animation: "r2-wipe .45s cubic-bezier(.7,0,.2,1) .45s both" }}>{mvp.name.split(" ")[0]}</div>
              <div style={{ fontSize: 48, lineHeight: 0.95, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.045em", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "r2-wipe .5s cubic-bezier(.7,0,.2,1) .55s both" }}>
                {mvp.name.split(" ").slice(1).join(" ") || mvp.name}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 12, animation: "r2-in .3s ease .5s both" }}>
                <span style={{ fontSize: 58, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.05em", lineHeight: 1, background: "linear-gradient(170deg,var(--ap-a100),var(--ap-accent) 70%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
                  {(mvp.points * mv).toFixed(1)}
                </span>
                <span style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--ap-n400)" }}>PTS · {Math.round(f.share)}% OF YOUR WEEK</span>
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--ap-n300)", marginTop: 8, textWrap: "pretty", animation: "r2-up .4s ease 1.2s both" }}>{mvpLine(f)}</div>
            </div>
            <div style={{ position: "absolute", left: 20, right: 20, bottom: 116, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
              {support.map((c, i) => (
                <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, borderRadius: 6, background: "color-mix(in oklch, var(--text) 4%, transparent)", border: "1px solid color-mix(in oklch, var(--text) 8%, transparent)", transition: "opacity .35s ease, transform .4s cubic-bezier(.2,.8,.2,1)", ...shown(lt2 >= 1250 + i * 120) }}>
                  <Face name={c.name} size={30} radius="50%" font={10} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name.split(" ").slice(-1)[0]}</div>
                    <div style={{ fontSize: 10, color: "var(--ap-n400)" }}>{c.points.toFixed(1)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* --------------------------------------------- 3 · playoff picture */}
        {beat === 2 && !ended ? (
          <div className="r2-fade" data-beat="3" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", top: 120, left: 20, right: 20 }}>
              <div style={{ fontSize: 10, letterSpacing: ".24em", color: "var(--ap-a300)", animation: "r2-wipe .4s ease .05s both" }}>PLAYOFF PICTURE</div>
              <div style={{ fontSize: 13, color: "var(--ap-n400)", marginTop: 6, animation: "r2-in .3s ease .2s both" }}>If the season ended today</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginTop: 18 }}>
                <div style={{ position: "relative", width: 150, height: 150, overflow: "hidden", flex: "0 0 auto" }}>
                  <div className="r2-motion-only" style={{ position: "absolute", inset: 0, fontSize: 150, lineHeight: 1, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.07em", color: "var(--ap-n600)", animation: "r2-out .4s cubic-bezier(.7,0,.2,1) .9s both" }}>
                    {pic.seedBefore}
                  </div>
                  <div style={{ position: "absolute", inset: 0, fontSize: 150, lineHeight: 1, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.07em", background: "linear-gradient(170deg,var(--ap-a100),var(--ap-accent) 70%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", animation: "r2-new .5s cubic-bezier(.2,.8,.2,1) 1.05s both" }}>
                    {pic.seedAfter}
                  </div>
                </div>
                <div style={{ paddingBottom: 18, minWidth: 0, animation: "r2-up .4s ease 1.3s both" }}>
                  <div style={{ fontSize: 10, letterSpacing: ".22em", color: "var(--ap-n500)" }}>SEED</div>
                  <div style={{ display: "flex", marginTop: 6 }}>
                    <span style={seedTagStyle}>{pic.tag}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ap-n300)", marginTop: 8 }}>{pic.note}</div>
                </div>
              </div>
            </div>

            <div style={{ position: "absolute", top: 372, left: 20, right: 20 }}>
              <div style={{ position: "relative", display: "grid", gridTemplateColumns: `repeat(${teams},minmax(0,1fr))`, padding: "22px 0 10px" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${cut}%`, borderRadius: 4, background: "color-mix(in oklch, var(--ap-accent) 9%, transparent)", animation: "r2-in .4s ease .4s both" }} />
                <div style={{ position: "absolute", top: -4, bottom: 0, left: `${cut}%`, width: 2, marginLeft: -1, background: "linear-gradient(180deg,var(--ap-a200),transparent)", boxShadow: "0 0 10px var(--ap-accent)", animation: "r2-in .4s ease .5s both" }} />
                <div style={{ position: "absolute", top: 4, left: 0, width: `${cut}%`, textAlign: "center", fontSize: 10, letterSpacing: ".2em", color: "var(--ap-a200)", animation: "r2-in .4s ease .55s both" }}>IN</div>
                <div style={{ position: "absolute", top: 4, left: `${cut}%`, right: 0, textAlign: "center", fontSize: 10, letterSpacing: ".2em", color: "var(--ap-n500)", animation: "r2-in .4s ease .55s both" }}>OUT</div>
                {pic.rail.map((id, i) => {
                  const me = id === data.meId;
                  const style: React.CSSProperties = me
                    ? { position: "relative", zIndex: 2, transition: "transform .8s cubic-bezier(.7,0,.2,1)", transform: lt3 >= 900 || reduced ? "none" : `translateX(${pic.moved * 100}%)` }
                    : { transition: "opacity .35s ease, transform .4s ease", ...shown(lt3 >= 250 + i * 60) };
                  return (
                    <div key={id} style={style}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                        {crest(id, me ? 30 : 24, me)}
                        <span style={me ? { fontSize: 13, fontWeight: 500, fontStyle: "italic", color: "var(--ap-a100)" } : { fontSize: 11, fontStyle: "italic", color: "var(--ap-n500)" }}>{i + 1}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{ position: "absolute", left: 20, right: 20, top: 500, animation: "r2-up .45s ease 1.6s both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderRadius: 6, background: "linear-gradient(160deg,color-mix(in oklch, var(--ap-accent) 16%, transparent),color-mix(in oklch, var(--text) 3%, transparent))", border: "1px solid color-mix(in oklch, var(--text) 10%, transparent)", boxShadow: "inset 0 1px 0 color-mix(in oklch, var(--text) 10%, transparent)" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 10, letterSpacing: ".22em", color: "var(--ap-a300)" }}>{pic.kicker}</div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--ap-n300)", marginTop: 6, textWrap: "pretty" }}>{pic.clinchNote}</div>
                </div>
                <div style={{ fontSize: 52, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.05em", lineHeight: 1, color: "var(--ap-a100)" }}>{pic.number}</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* ----------------------------------------------- 4 · the share card */}
        {t >= S[3] && t < END + FADE ? (
          <div className="r2-fade" data-beat="4" style={{ position: "absolute", inset: 0 }}>
            <div style={{ position: "absolute", top: 108, left: 18, right: 18, animation: "r2-card .7s cubic-bezier(.2,.8,.2,1) both" }}>
              <div data-share-card style={{ borderRadius: 8, overflow: "hidden", background: "linear-gradient(170deg, color-mix(in oklch, var(--ap-accent) 22%, var(--bg)), var(--bg) 72%)", border: "1px solid color-mix(in oklch, var(--text) 12%, transparent)", boxShadow: "inset 0 1px 0 color-mix(in oklch, var(--text) 14%, transparent), 0 24px 60px rgba(0,0,0,.45)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "14px 16px" }}>
                  <Pylon w={9} h={18} band={false} />
                  <span style={{ fontSize: 10, fontWeight: 600, fontStyle: "italic", letterSpacing: ".18em" }}>PYLON</span>
                  <span style={{ fontSize: 10, fontStyle: "italic", letterSpacing: ".18em", color: "var(--ap-a300)" }}>FANTASY</span>
                  <span style={{ marginLeft: "auto", fontSize: 10, letterSpacing: ".18em", color: "var(--ap-n400)" }}>WEEK {f.week} · FINAL</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 16px 16px", animation: "r2-up .4s ease .3s both" }}>
                  {crest(data.meId, 40)}
                  <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
                    <span style={{ display: "inline-block", fontSize: 10, fontWeight: 500, letterSpacing: ".2em", padding: "3px 8px", borderRadius: 2, ...(won ? { color: "#0f2a1c", background: "#7fd8a8" } : { color: "#2a1d08", background: "#e0b573" }) }}>{verdictWord}</span>
                    <div style={{ fontSize: 28, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", marginTop: 6, whiteSpace: "nowrap" }}>
                      {f.myScore.toFixed(1)} – {f.theirScore.toFixed(1)}
                    </div>
                  </div>
                  {opp ? crest(opp.id, 40) : null}
                </div>
                {mvp ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: "1px solid color-mix(in oklch, var(--text) 8%, transparent)", animation: "r2-up .4s ease .42s both" }}>
                    <Face name={mvp.name} size={44} radius={5} font={12} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ap-a300)" }}>MVP</div>
                      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mvp.name}</div>
                    </div>
                    <span style={{ fontSize: 24, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", color: "var(--ap-a100)" }}>{mvp.points.toFixed(1)}</span>
                  </div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid color-mix(in oklch, var(--text) 8%, transparent)", animation: "r2-up .4s ease .54s both" }}>
                  <div style={{ padding: "12px 16px", borderRight: "1px solid color-mix(in oklch, var(--text) 8%, transparent)" }}>
                    <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ap-n500)" }}>SEED</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 28, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.05em", lineHeight: 1 }}>{pic.seedAfter}</span>
                      <span style={seedTagStyle}>{pic.tag}</span>
                    </div>
                  </div>
                  <div style={{ padding: "12px 16px" }}>
                    <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ap-n500)" }}>{pic.kicker}</div>
                    <div style={{ fontSize: 28, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.05em", lineHeight: 1, marginTop: 4 }}>{pic.number}</div>
                  </div>
                </div>
                {next ? (
                  <div style={{ padding: "14px 16px 16px", borderTop: "1px solid color-mix(in oklch, var(--text) 8%, transparent)", background: "color-mix(in oklch, var(--text) 3%, transparent)", animation: "r2-up .4s ease .66s both" }}>
                    <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--ap-a300)" }}>NEXT · WEEK {next.week}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
                      {crest(next.team.id, 40)}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 15, fontWeight: 500, fontStyle: "italic", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{next.team.franchise}</div>
                        <div style={{ fontSize: 11, color: "var(--ap-n400)", marginTop: 3 }}>
                          {next.team.owner} · {next.record} · {formOf(next.streak.runs, next.streak.kind)}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, lineHeight: 1.45, color: "var(--ap-n300)", marginTop: 10, textWrap: "pretty" }}>{nextLine(data, f)}</div>
                  </div>
                ) : null}
              </div>
            </div>
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 110, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, animation: "r2-up .4s ease .8s both" }}>
              <button type="button" onClick={(e) => void share(e)} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: ".16em", padding: "13px 0", borderRadius: 4, border: "1px solid var(--ap-a500)", background: "color-mix(in oklch, var(--ap-accent) 16%, transparent)", color: "var(--ap-a100)" }}>
                {shared ?? "SHARE"}
              </button>
              <button type="button" onClick={close} style={{ cursor: "pointer", fontFamily: "inherit", fontSize: 11, letterSpacing: ".16em", padding: "13px 0", borderRadius: 4, border: "1px solid color-mix(in oklch, var(--text) 14%, transparent)", background: "transparent", color: "var(--ap-n200)" }}>
                DONE
              </button>
            </div>
            <div style={{ position: "absolute", left: 18, right: 18, bottom: 98, height: 2, borderRadius: 1, overflow: "hidden", background: "color-mix(in oklch, var(--text) 10%, transparent)" }}>
              <div style={{ height: "100%", background: "var(--ap-a300)", transition: "width .08s linear", width: `${countdown.toFixed(1)}%` }} />
            </div>
          </div>
        ) : null}

        {/* The stinger: a skewed branded slab across the cut. */}
        {sting >= 0 ? (
          <div key={`sting-${sting}`} data-sting style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "none", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: "-25%", bottom: "-25%", left: "-50%", width: "200%", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(90deg, var(--ap-section) 0%, color-mix(in oklch, var(--ap-accent) 42%, var(--ap-section)) 50%, var(--ap-section-glow) 100%)", boxShadow: "inset 6px 0 0 var(--ap-a200), inset 14px 0 30px color-mix(in oklch, var(--ap-accent) 50%, transparent)", animation: "r2-sting .7s cubic-bezier(.75,0,.25,1) both" }}>
              <div style={{ transform: "skewX(14deg)", display: "flex", alignItems: "center", gap: 12 }}>
                <Pylon w={22} h={44} />
                <span style={{ fontSize: 24, fontWeight: 600, fontStyle: "italic", letterSpacing: ".22em" }}>PYLON</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
