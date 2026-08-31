"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { headshot, logo, statLine } from "@/data/league-data";
import { BENCH, slotAccepts, startingSlots, validateLineup, type Assignment } from "@/lib/lineup";
import { flagColor, flagsFor, player, proj } from "@/lib/roster";
import type { LeagueShape } from "@/lib/roster";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

interface Feed {
  week: number;
  me: { id: string; slot: string; franchise: string };
  settings: LeagueShape | null;
  assignments: Assignment[];
  lockedPlayers: string[];
}

interface Score {
  points: number;
  statLine: string;
}

export default function LineupEditor({ scores }: { scores: Map<string, Score> }) {
  const logos = useLogos();
  const [feed, setFeed] = useState<Feed | null>(null);
  const [draft, setDraft] = useState<Assignment[] | null>(null);
  const [armed, setArmed] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lineup", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to set your lineup.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      const data: Feed = await res.json();
      setFeed(data);
      setDraft(data.assignments);
      setError(null);
    } catch {
      setError("Could not load your lineup.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const locked = useMemo(() => new Set(feed?.lockedPlayers ?? []), [feed]);

  // The starting slots, in league order, with whoever currently fills each.
  const rows = useMemo(() => {
    if (!feed || !draft) return [];
    const remaining = [...draft];
    return startingSlots(feed.settings).map((slot) => {
      const at = remaining.findIndex((a) => a.slot === slot);
      const filled = at > -1 ? remaining.splice(at, 1)[0] : null;
      return { slot, name: filled?.playerName ?? null };
    });
  }, [feed, draft]);

  const bench = useMemo(
    () => (draft ?? []).filter((a) => a.slot === BENCH).map((a) => a.playerName),
    [draft],
  );

  const total = rows.reduce(
    (sum, r) => sum + (r.name ? (scores.get(r.name)?.points ?? proj(r.name)) : 0),
    0,
  );

  async function save(assignments: Assignment[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/lineup", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assignments, week: feed?.week ?? 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Your lineup was not saved.");
        await load();
      }
    } catch {
      setError("Your lineup was not saved.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  function move(playerName: string, toSlot: string) {
    if (!feed || !draft) return;

    const next = draft.map((a) => ({ ...a }));
    const moving = next.find((a) => a.playerName === playerName);
    if (!moving) return;

    const from = moving.slot;

    // If the target slot is full, the man there takes the mover's old slot —
    // a swap, so the lineup never ends up with two players in one seat.
    if (toSlot !== BENCH) {
      const seats = startingSlots(feed.settings).filter((s) => s === toSlot).length;
      const inSlot = next.filter((a) => a.slot === toSlot && a.playerName !== playerName);
      if (inSlot.length >= seats) {
        inSlot[inSlot.length - 1].slot = from;
      }
    }
    moving.slot = toSlot;

    const check = validateLineup(
      next,
      next.map((a) => a.playerName),
      feed.settings,
    );
    if (!check.ok) {
      setError(check.error ?? "That move is not legal.");
      return;
    }

    setError(null);
    setDraft(next);
    setArmed(null);
    void save(next);
  }

  if (error && !feed) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!feed || !draft) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading your lineup…</div>;
  }

  const armedRow = armed != null ? rows[armed] : null;

  return (
    <>
      <div
        style={{
          padding: "24px 26px 12px",
          display: "flex",
          alignItems: "flex-end",
          gap: 26,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>
            DYNASTY · SUPERFLEX
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "var(--font-heading)",
              fontSize: 44,
              lineHeight: 1.04,
              letterSpacing: "-.035em",
              margin: "8px 0 0",
            }}
          >
            <TeamCrest
              franchise={feed.me.franchise}
              logo={logos[feed.me.id] ?? null}
              size={40}
              shape="box"
              fallback="empty"
            />
            {feed.me.franchise}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, color: "#d2cefd" }}>
            {total.toFixed(1)}
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c" }}>
            {saving ? "SAVING…" : "STARTING LINEUP"}
          </div>
        </div>
      </div>

      <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#9397ab", maxWidth: "70ch", lineHeight: 1.6 }}>
        {armedRow
          ? `Tap a bench player to move them into ${armedRow.slot}. Only eligible players are lit; tap the slot again to cancel.`
          : "Tap a starting slot, then tap who should fill it. A player whose game has kicked off is locked."}
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      <div style={{ padding: "12px 26px 40px" }}>
        <div
          style={{
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
          <SectionHeader title="Starting lineup" note={`WEEK ${feed.week}`} />

          {rows.map((row, i) => (
            <PlayerRow
              key={`${row.slot}-${i}`}
              slot={row.slot}
              name={row.name}
              score={row.name ? scores.get(row.name) : undefined}
              armed={armed === i}
              locked={row.name ? locked.has(row.name) : false}
              onClick={() => {
                if (row.name && locked.has(row.name)) {
                  setError(`${row.name}'s game has started — his slot is locked.`);
                  return;
                }
                setError(null);
                setArmed(armed === i ? null : i);
              }}
              starter
            />
          ))}

          <SectionHeader title="Bench" note={`${bench.length} PLAYERS`} muted />

          {bench.map((name) => {
            const p = player(name);
            const eligible =
              armedRow != null && p != null && slotAccepts(armedRow.slot, p.p, feed.settings);
            const isLocked = locked.has(name);

            return (
              <PlayerRow
                key={name}
                slot={p?.p === "D/ST" ? "DST" : (p?.p ?? "—")}
                name={name}
                score={scores.get(name)}
                dimmed={armedRow != null && !eligible}
                highlighted={eligible && !isLocked}
                locked={isLocked}
                onClick={() => {
                  if (!armedRow || !eligible) return;
                  if (isLocked) {
                    setError(`${name}'s game has started — he cannot be moved in.`);
                    return;
                  }
                  move(name, armedRow.slot);
                }}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}

function SectionHeader({ title, note, muted }: { title: string; note: string; muted?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "14px 18px",
        borderTop: muted ? "1px solid rgba(145,132,217,.18)" : undefined,
        background: muted ? "rgba(20,22,35,.5)" : undefined,
      }}
    >
      <h6 style={{ margin: 0, color: muted ? "#9397ab" : "#d2cefd" }}>{title}</h6>
      <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>{note}</span>
    </div>
  );
}

function PlayerRow({
  slot,
  name,
  score,
  armed,
  dimmed,
  highlighted,
  locked,
  starter,
  onClick,
}: {
  slot: string;
  name: string | null;
  score?: Score;
  armed?: boolean;
  dimmed?: boolean;
  highlighted?: boolean;
  locked?: boolean;
  starter?: boolean;
  onClick?: () => void;
}) {
  const p = name ? player(name) : null;
  const flags = name ? flagsFor(name) : [];
  const live = score != null;
  const clickable = onClick != null && !dimmed;

  return (
    <div
      onClick={clickable ? onClick : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: starter ? "12px 18px" : "11px 18px",
        borderTop: "1px solid rgba(145,132,217,.12)",
        cursor: clickable ? "pointer" : "default",
        opacity: dimmed ? 0.32 : 1,
        transition: "background .18s ease",
        background: armed
          ? "linear-gradient(90deg,rgba(145,132,217,.34),transparent)"
          : highlighted
            ? "rgba(66,58,106,.28)"
            : "transparent",
        boxShadow: armed
          ? "inset 2px 0 0 #b5abfc"
          : highlighted
            ? "inset 2px 0 0 rgba(181,171,252,.55)"
            : undefined,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 10,
          letterSpacing: ".14em",
          width: 38,
          flex: "0 0 auto",
          color: armed ? "#e9e9ed" : starter ? "#b5abfc" : "#75798c",
        }}
      >
        {slot === "D/ST" ? "DST" : slot}
      </span>

      {name ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={headshot(name) || BLANK}
            alt=""
            width={starter ? 34 : 30}
            height={starter ? 34 : 30}
            style={{
              borderRadius: "50%",
              objectFit: "contain",
              border: "1px solid rgba(145,132,217,.3)",
              background: "rgba(35,37,50,.7)",
              flex: "0 0 auto",
            }}
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: starter ? 15 : 14,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  minWidth: 0,
                }}
              >
                {name}
              </span>
              {p?.t ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo(p.t)}
                  alt=""
                  width={15}
                  height={15}
                  style={{ objectFit: "contain", opacity: 0.85, flex: "0 0 auto" }}
                />
              ) : null}
              {locked ? (
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: ".12em",
                    padding: "2px 5px",
                    borderRadius: 2,
                    border: "1px solid rgba(117,121,140,.6)",
                    color: "#75798c",
                    flex: "0 0 auto",
                  }}
                >
                  LOCKED
                </span>
              ) : null}
              {flags.map((f) => (
                <span
                  key={f.label}
                  style={{
                    fontSize: 10,
                    letterSpacing: ".12em",
                    padding: "2px 5px",
                    borderRadius: 2,
                    flex: "0 0 auto",
                    border: `1px solid ${flagColor(f.kind)}66`,
                    color: flagColor(f.kind),
                  }}
                >
                  {f.label}
                </span>
              ))}
            </div>
            <div
              style={{
                fontSize: 11,
                color: live ? "#9397ab" : "#75798c",
                marginTop: 3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {live ? score.statLine : p ? statLine(p) : ""}
            </div>
          </div>

          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: starter ? 17 : 15,
                color: live ? "#d2cefd" : "#b2b6ca",
              }}
            >
              {(live ? score.points : proj(name)).toFixed(1)}
            </div>
            <div style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
              {live ? "LIVE" : "PROJ"}
            </div>
          </div>
        </>
      ) : (
        <div style={{ flex: 1, fontSize: 13, color: "#5a5d6e" }}>Empty — tap to fill</div>
      )}
    </div>
  );
}
