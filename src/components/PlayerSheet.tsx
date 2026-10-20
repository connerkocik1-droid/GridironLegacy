"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { closePlayer, useOpenPlayer } from "@/lib/player-sheet";
import { toggleWatch, useWatchlist } from "@/lib/use-watchlist";
import { refreshAll } from "@/lib/use-refresh";
import { usePositionRanks } from "@/lib/use-position-ranks";
import { ageOf } from "@/data/league-data";
import { playerHref, HealthBadge } from "./PlayerName";
import Headshot from "./Headshot";
import TeamMark from "./TeamMark";
import { GroupLabel, Spark, ink, optStyle, tagStyle, tint } from "./RowList";

interface Payload {
  profile: { name: string; position: string; team: string; posRank: string | null; bye: number | null };
  season: { weeks: { week: number; points: number; statLine: string }[]; total: number } | null;
  owner: { id?: string; franchise: string; mine: boolean; lineupSlot: string } | null;
  actions: {
    where: "mine" | "theirs" | "free";
    locked: boolean;
    irEligible: boolean;
    onIr: boolean;
    irRoom: boolean;
    rosterRoom: boolean;
    claim: boolean;
    clearsAt: string | null;
    tradeWith: string | null;
  } | null;
}

type Move = "add" | "drop" | "stash" | "recall" | "reserve";

/**
 * The slide-up card a player's name opens, anywhere in the app: who he is and
 * who holds him, four numbers, his game log, and the moves this manager can
 * actually make with him. From the player sheet in prototype/Pylon App.dc.html.
 *
 * The buttons follow where he is, and the server decides what is allowed (see
 * /api/player): your player — Trade, Drop (until his game kicks off) and IR
 * (only on an Out, Suspended or IR designation); a free agent — Add or Claim,
 * and Watch; somebody else's — Propose trade, and Watch. A move that is not
 * on offer says why underneath rather than simply being missing.
 */
export default function PlayerSheet() {
  const name = useOpenPlayer();
  const watching = useWatchlist();
  const ranks = usePositionRanks();
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (who: string) => {
    try {
      const res = await fetch(`/api/player/${encodeURIComponent(who)}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } catch {
      // The sheet shows what it has; the full profile page says the rest.
    }
  }, []);

  useEffect(() => {
    if (!name) return;
    // Reset for the new player before his numbers arrive, so nobody sees one
    // man's buttons under another man's name.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setSaid(null);
    void load(name);
  }, [name, load]);

  useEffect(() => {
    if (!name) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePlayer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [name]);

  if (!name) return null;

  const act = async (what: Move, ok: string) => {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    const body =
      what === "add" ? { add: name } : what === "reserve" ? { add: name, ir: true } : what === "drop" ? { drop: name } : { player: name, ir: what === "stash" };
    try {
      const res = await fetch(what === "add" || what === "drop" || what === "reserve" ? "/api/waivers" : "/api/lineup", {
        method: what === "drop" ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) setSaid({ ok: false, text: typeof answer.error === "string" ? answer.error : "That did not work." });
      else {
        setSaid({ ok: true, text: what === "add" && answer.mode && answer.mode !== "now" ? `Claim placed for ${name}. It settles on the next waiver run.` : ok });
        // Every board on screen re-reads, so the roster behind the sheet moves.
        void refreshAll(0);
      }
      await load(name);
    } catch {
      setSaid({ ok: false, text: "That did not work." });
    } finally {
      setBusy(false);
    }
  };

  const p = data?.profile;
  const a = data?.actions;
  const weeks = (data?.season?.weeks ?? []).filter((w) => w.points !== 0 || w.statLine);
  const total = data?.season?.total ?? weeks.reduce((s, w) => s + w.points, 0);
  const latest = weeks[weeks.length - 1];
  const log = weeks.slice(-7);
  const max = Math.max(1, ...log.map((w) => w.points));
  const watched = watching.has(name);

  const opts: { label: string; tone?: "danger" | "warn" | "quiet"; onClick?: () => void; href?: string }[] = [];
  const why: string[] = [];
  if (a?.where === "mine") {
    opts.push({ label: "TRADE", href: `/trade-builder?give=${encodeURIComponent(name)}` });
    if (!a.locked) opts.push({ label: "DROP", tone: "danger", onClick: () => void act("drop", `${name} was dropped.`) });
    else why.push("Drop locks once his game kicks off.");
    if (a.onIr) {
      if (a.rosterRoom) opts.push({ label: "ACTIVATE", onClick: () => void act("recall", `${name} is back on your roster.`) });
      else why.push("Activating him needs a roster spot — drop somebody first.");
    } else if (a.irEligible) {
      if (a.irRoom && !a.locked) opts.push({ label: "SEND TO IR", tone: "warn", onClick: () => void act("stash", `${name} is on your injured reserve.`) });
      else why.push(!a.irRoom ? "Your injured reserve is full." : "IR locks once his game kicks off.");
    } else why.push("IR needs an Out, Suspended or IR designation.");
  } else if (a?.where === "free") {
    if (!a.locked && a.rosterRoom) opts.push({ label: a.claim ? "CLAIM" : "ADD", onClick: () => void act("add", `${name} is on your roster.`) });
    else why.push(a.locked ? "His game has started — adds reopen after it." : "Your roster is full — drop somebody first.");
    if (a.irEligible && a.irRoom) opts.push({ label: "ADD TO IR", tone: "warn", onClick: () => void act("reserve", `${name} is on your injured reserve.`) });
    opts.push({ label: watched ? "★ WATCHING" : "☆ WATCH", tone: "quiet", onClick: () => void toggleWatch(name) });
    if (a.claim && a.clearsAt) why.push(`On waivers — claims settle on the next run, and he clears ${clearsIn(a.clearsAt)}.`);
  } else if (a?.where === "theirs") {
    opts.push({
      label: "PROPOSE TRADE",
      href: `/trade-builder?${new URLSearchParams({ ...(a.tradeWith ? { with: a.tradeWith } : {}), want: name })}`,
    });
    opts.push({ label: watched ? "★ WATCHING" : "☆ WATCH", tone: "quiet", onClick: () => void toggleWatch(name) });
  }

  const age = p?.position === "D/ST" ? null : ageOf({ n: name });
  const stats = [
    { k: "SEASON", v: total ? total.toFixed(1) : "—" },
    { k: "PER GAME", v: weeks.length ? (total / weeks.length).toFixed(1) : "—" },
    { k: latest ? `WEEK ${latest.week}` : "THIS WEEK", v: latest ? latest.points.toFixed(1) : "—" },
    // Where he stands at his position now, beside where he was drafted.
    { k: "POS RANK", v: ranks.get(name) ?? "—" },
    { k: "DRAFTED", v: p?.posRank ?? "—" },
    { k: "AGE", v: age != null ? String(age) : "—" },
  ];

  return (
    <>
      <div
        onClick={closePlayer}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 70,
          background: "color-mix(in oklch, var(--bg) 55%, transparent)",
          backdropFilter: "blur(3px)",
          WebkitBackdropFilter: "blur(3px)",
          animation: "ap-fade .2s ease both",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={name}
        data-panel="1"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 71,
          maxWidth: 560,
          margin: "0 auto",
          maxHeight: "80vh",
          overflowY: "auto",
          borderRadius: "10px 10px 0 0",
          padding: "8px 16px calc(30px + env(safe-area-inset-bottom))",
          background:
            "linear-gradient(180deg,color-mix(in oklch, var(--ap-surface) 90%, transparent),color-mix(in oklch, var(--bg) 97%, transparent))",
          backdropFilter: "blur(30px) saturate(170%)",
          WebkitBackdropFilter: "blur(30px) saturate(170%)",
          borderTop: `1px solid ${ink(12)}`,
          boxShadow: `inset 0 1px 0 ${ink(14)}, 0 -16px 40px rgb(var(--shadow-rgb) / .5)`,
          animation: "ap-sheet .32s cubic-bezier(.2,.9,.2,1) both",
          color: "var(--text)",
        }}
      >
        <button
          type="button"
          onClick={closePlayer}
          aria-label="Close"
          style={{ display: "block", width: 60, height: 22, margin: "0 auto 4px", padding: 0, border: 0, background: "transparent", cursor: "pointer" }}
        >
          <span style={{ display: "block", width: 36, height: 4, borderRadius: 2, margin: "0 auto", background: ink(22) }} />
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ position: "relative", flex: "0 0 auto", width: 56, height: 56 }}>
            <span
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 5,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--ap-a100)",
                background: tint(20),
                border: `1px solid ${tint(35)}`,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, fontStyle: "italic" }}>{p?.position === "D/ST" ? "DEF" : (p?.position ?? "")}</span>
              <span style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--ap-a300)" }}>{p?.team ?? ""}</span>
            </span>
            {/* The headshot over the tile; a man with no picture shows the tile. */}
            <Headshot name={name} width={56} height={56} style={{ position: "absolute", inset: 0, width: 56, height: 56, borderRadius: 5, objectFit: "cover" }} />
            {p?.team ? (
              <span style={{ position: "absolute", right: -6, bottom: -6, zIndex: 2, width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: 3, background: "var(--bg)", border: "1px solid var(--ap-a600)" }}>
                <TeamMark team={p.team} size={16} opacity={1} />
              </span>
            ) : null}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.025em", lineHeight: 1.1 }}>{name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, color: "var(--ap-n400)" }}>
                {data ? (data.owner ? data.owner.franchise : "Free agent") : "…"}
              </span>
              <HealthBadge name={name} />
              {data?.owner?.lineupSlot === "IR" ? <span style={tagStyle("warn")}>IR</span> : null}
              {p?.bye ? <span style={tagStyle("flat")}>BYE {p.bye}</span> : null}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, rowGap: 12, marginTop: 16 }}>
          {stats.map((x) => (
            <div key={x.k}>
              <div style={{ fontSize: 18, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.04em", color: "var(--ap-a100)" }}>{x.v}</div>
              <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--ap-n500)", marginTop: 3 }}>{x.k}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <GroupLabel
            label="GAME LOG"
            note={
              log.length > 1 ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  POINTS <Spark values={log.map((w) => w.points)} width={46} />
                </span>
              ) : undefined
            }
          />
        </div>
        {log.length ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 86, marginTop: 4 }}>
            {log.map((w, i) => {
              const last = i === log.length - 1;
              return (
                <div key={w.week} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }}>
                  <span style={{ fontSize: 10, color: "var(--ap-n300)" }}>{w.points.toFixed(1)}</span>
                  <div
                    style={{
                      width: "100%",
                      borderRadius: "2px 2px 0 0",
                      height: Math.max(3, Math.round((Math.max(0, w.points) / max) * 52)),
                      background: last
                        ? "linear-gradient(180deg,var(--ap-a200),var(--ap-a600))"
                        : tint(30 + Math.round((Math.max(0, w.points) / max) * 30)),
                      boxShadow: last ? "0 0 8px var(--ap-accent)" : undefined,
                    }}
                  />
                  <span style={{ fontSize: 10, letterSpacing: ".08em", color: "var(--ap-n500)" }}>WK{w.week}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "var(--ap-n500)", padding: "4px 2px" }}>{data ? "No games scored this season yet." : "Reading his season…"}</div>
        )}

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 18 }}>
          {opts.map((o) =>
            o.href ? (
              <Link key={o.label} href={o.href} onClick={closePlayer} className="gl-press" style={{ ...optStyle(o.tone), flex: "1 1 auto", padding: "11px 12px", textAlign: "center", textDecoration: "none" }}>
                {o.label}
              </Link>
            ) : (
              <button key={o.label} type="button" disabled={busy} onClick={o.onClick} className="gl-press" style={{ ...optStyle(o.tone), flex: "1 1 auto", padding: "11px 12px", opacity: busy ? 0.6 : 1 }}>
                {o.label}
              </button>
            ),
          )}
          <Link href={playerHref(name)} onClick={closePlayer} className="gl-press" style={{ ...optStyle("quiet"), flex: "1 1 auto", padding: "11px 12px", textAlign: "center", textDecoration: "none" }}>
            PROFILE →
          </Link>
        </div>
        {said ? (
          <div role="status" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 10, color: said.ok ? "var(--good)" : "var(--warn)" }}>
            {said.text}
          </div>
        ) : null}
        {why.length ? <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ap-n500)", marginTop: 9 }}>{why.join(" ")}</div> : null}
      </div>
    </>
  );
}

/** "in 4 hours", or "on Tuesday" once it is further off than a day. */
function clearsIn(at: string): string {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "soon";
  const mins = Math.round((when.getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "any moment";
  if (mins < 60) return `in ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `on ${when.toLocaleDateString(undefined, { weekday: "long" })}`;
}
