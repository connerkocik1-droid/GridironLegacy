"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { headshot, logo, statLine } from "@/data/league-data";
import { player } from "@/lib/roster";

/**
 * The cinematic pick reveal, ported from the prototype.
 *
 * Five beats over ten seconds, each replacing the last rather than flipping:
 * the franchise resolves, then the position, then last season's finish, then a
 * silhouette, then the whole card. Every pick in the cinematic rounds gets it,
 * not only your own — the room watches the draft together.
 */
const REVEAL_MS = 10_000;

// Fractions of REVEAL_MS, as in the prototype: a beat lands, holds, gives way.
const BEATS: { at: number; stage: number }[] = [
  { at: 260 / REVEAL_MS, stage: 1 },
  { at: 0.22, stage: 2 },
  { at: 0.42, stage: 3 },
  { at: 0.64, stage: 4 },
  { at: 0.84, stage: 5 },
];

const STAGE_LABEL: Record<number, string> = {
  1: "RESOLVING FRANCHISE",
  2: "DECODING POSITION",
  3: "READING 2025 FINISH",
  4: "DECRYPTING IDENTITY",
  5: "IDENTITY CONFIRMED",
};

export interface RevealPick {
  playerName: string;
  franchise: string;
  slot: string;
  overall: number;
  round: number;
  /** Yours waits to be dismissed; everyone else's closes itself. */
  mine: boolean;
}

export default function DraftReveal({
  pick,
  onClose,
}: {
  pick: RevealPick | null;
  onClose: () => void;
}) {
  const [stage, setStage] = useState(0);

  // onClose is rebuilt on every parent render, and the draft room re-renders
  // four times a second to run its clock. Depending on it directly would tear
  // the sequence down and restart it before the first beat ever landed, so it
  // is held in a ref and the effect depends only on the pick.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!pick) return;

    // Stage 0 is the resting state, so the sequence starts from a timer at
    // zero rather than a synchronous reset — the effect only schedules.
    const timers = [
      setTimeout(() => setStage(0), 0),
      ...BEATS.map((b) => setTimeout(() => setStage(b.stage), b.at * REVEAL_MS)),
    ];

    // A pick that is not yours clears itself; yours stays until dismissed, so
    // you get to look at it.
    if (!pick.mine) {
      timers.push(setTimeout(() => close.current(), REVEAL_MS * 1.25));
    }

    return () => timers.forEach(clearTimeout);
  }, [pick]);

  const p = useMemo(() => (pick ? player(pick.playerName) : null), [pick]);

  if (!pick) return null;

  const face = headshot(pick.playerName);
  const mark = p?.t ? logo(p.t) : null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={`Pick ${pick.overall}: ${stage >= 5 ? pick.playerName : "revealing"}`}
      onClick={pick.mine ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(900px 520px at 50% 38%,rgba(46,40,78,.96),rgba(10,11,19,.985))",
        backdropFilter: "blur(6px)",
        cursor: pick.mine ? "pointer" : "default",
        animation: "gl-fade 240ms ease",
      }}
    >
      {/* The scanline wash the prototype ran over the whole room. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "repeating-linear-gradient(0deg,rgba(181,171,252,.055) 0 1px,transparent 1px 3px)",
          opacity: 0.5,
        }}
      />

      <div style={{ textAlign: "center", padding: 26, position: "relative" }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".42em",
            color: "#75798c",
            marginBottom: 6,
          }}
        >
          ROUND {pick.round} · PICK {pick.overall}
        </div>

        {/* Beat one: whose pick it is. */}
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 30,
            letterSpacing: "-.02em",
            color: "#d2cefd",
            minHeight: 40,
            opacity: stage >= 1 ? 1 : 0,
            transform: stage >= 1 ? "translateY(0)" : "translateY(8px)",
            transition: "opacity .5s ease, transform .5s ease",
          }}
        >
          {stage >= 1 ? pick.franchise : ""}
        </div>

        {/* Beat two: the position, big. */}
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: stage >= 4 ? 44 : 96,
            lineHeight: 1,
            letterSpacing: "-.04em",
            margin: "14px 0",
            color: "#e9e9ed",
            minHeight: 100,
            display: "grid",
            placeItems: "center",
            opacity: stage >= 2 ? 1 : 0,
            transform: stage >= 2 ? "scale(1)" : "scale(.82)",
            transition: "opacity .45s ease, transform .55s cubic-bezier(.2,.9,.25,1), font-size .55s ease",
            textShadow: "0 0 46px rgba(145,132,217,.5)",
          }}
        >
          {stage >= 2 ? (p?.p === "D/ST" ? "DST" : (p?.p ?? "—")) : ""}
        </div>

        {/* Beat three: what he did last year. */}
        <div
          style={{
            fontSize: 13,
            color: "#9397ab",
            minHeight: 22,
            maxWidth: "60ch",
            margin: "0 auto",
            opacity: stage >= 3 && stage < 5 ? 1 : 0,
            transition: "opacity .45s ease",
          }}
        >
          {stage >= 3 && p ? statLine(p) : ""}
        </div>

        {/* Beat four: a silhouette, then beat five: the man himself. */}
        <div
          style={{
            width: 168,
            height: 168,
            margin: "18px auto 0",
            borderRadius: "50%",
            display: "grid",
            placeItems: "center",
            border: "1px solid rgba(145,132,217,.4)",
            background: "rgba(28,30,46,.85)",
            boxShadow: stage >= 5 ? "0 0 70px rgba(145,132,217,.42)" : "none",
            overflow: "hidden",
            opacity: stage >= 4 ? 1 : 0,
            transform: stage >= 4 ? "scale(1)" : "scale(.9)",
            transition: "opacity .5s ease, transform .6s cubic-bezier(.2,.9,.25,1), box-shadow .6s ease",
          }}
        >
          {face ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={face}
              alt=""
              width={168}
              height={168}
              style={{
                objectFit: "contain",
                // Stage four is the silhouette: the same portrait, blacked out
                // and blurred, so the shape arrives before the face does.
                filter: stage >= 5 ? "none" : "brightness(0) blur(3px)",
                transition: "filter .7s ease",
              }}
            />
          ) : (
            <span style={{ fontSize: 44, color: "#5a5d6e" }}>?</span>
          )}
        </div>

        {/* Beat five: the name. */}
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 40,
            letterSpacing: "-.03em",
            marginTop: 18,
            minHeight: 50,
            opacity: stage >= 5 ? 1 : 0,
            transform: stage >= 5 ? "translateY(0)" : "translateY(10px)",
            transition: "opacity .5s ease, transform .5s ease",
          }}
        >
          {stage >= 5 ? pick.playerName : ""}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            marginTop: 8,
            minHeight: 22,
            opacity: stage >= 5 ? 1 : 0,
            transition: "opacity .5s ease .1s",
          }}
        >
          {stage >= 5 && mark ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mark} alt="" width={20} height={20} style={{ objectFit: "contain" }} />
          ) : null}
          <span style={{ fontSize: 11, letterSpacing: ".2em", color: "#9397ab" }}>
            {stage >= 5 && p ? `${p.p} · ${p.t} · BYE ${p.bye}` : ""}
          </span>
        </div>

        <div
          style={{
            fontSize: 10,
            letterSpacing: ".34em",
            color: "#75798c",
            marginTop: 26,
            minHeight: 14,
          }}
        >
          {STAGE_LABEL[stage] ?? ""}
        </div>

        {pick.mine && stage >= 5 ? (
          <div style={{ fontSize: 11, color: "#75798c", marginTop: 12 }}>
            Tap anywhere to close
          </div>
        ) : null}
      </div>
    </div>
  );
}
