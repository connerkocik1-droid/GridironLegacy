"use client";

import { useEffect, useState } from "react";
import TeamCrest from "./TeamCrest";
import { firstName } from "@/lib/first-name";
import { useLogos } from "@/lib/use-logos";

/**
 * The order, drawn in front of everybody.
 *
 * A horizontal reel of franchises that spins and slows into one name, then
 * does it again — from the last pick up to the first, because the first
 * overall is the only one worth saving until the end. It is the one moment of
 * a dynasty season where nothing has happened yet and everything is still
 * possible, and it deserves more than a list appearing.
 *
 * Nothing here decides anything. The order was drawn on the server before a
 * pixel moved and is already written down; this is the envelope being opened.
 * That matters for more than tidiness — twelve browsers each shuffling for
 * themselves would show twelve different answers, and a manager who refreshed
 * would watch a different draft from everybody else.
 *
 * Which is also why the whole animation is a function of one number: how long
 * ago the commissioner pressed the button. Every screen computes its position
 * from that instant, so they are all at the same point in the ceremony, and a
 * phone that locks and wakes rejoins the others rather than starting again.
 */

/** How long one franchise takes to spin up, land, and be read. */
const REVEAL_MS = 3_200;

/** A beat before the first spin, so nobody misses the start of it. */
const LEAD_IN_MS = 1_200;

interface Manager {
  id: string;
  slot: string;
  franchise: string;
  /** Whoever holds it. Null for a franchise nobody has claimed. */
  name?: string | null;
}

/**
 * Ease-out, so the reel arrives rather than stops.
 *
 * A quintic curve: fast enough at the start to blur, and slow enough at the
 * end that the last three names go past one at a time. A linear reel that
 * simply halted would read as a bug.
 */
const settle = (t: number) => 1 - Math.pow(1 - t, 5);

export default function DraftLottery({
  order,
  managers,
  at,
  skew,
  onDone,
}: {
  /** The drawn order, first pick first. */
  order: string[];
  managers: Manager[];
  /** When the commissioner started it, from the server. */
  at: string;
  /** This browser's clock minus the server's, so the two agree. */
  skew: number;
  /** Called once the last name is out. */
  onDone?: () => void;
}) {
  const logos = useLogos();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60);
    return () => clearInterval(timer);
  }, []);

  const bySlot = new Map(managers.map((m) => [m.slot, m]));
  const picks = order.filter((slot) => bySlot.has(slot));
  const total = picks.length;

  const elapsed = now + skew - new Date(at).getTime() - LEAD_IN_MS;

  // How many are already out, and how far through the one being drawn.
  const done = Math.max(0, Math.min(total, Math.floor(elapsed / REVEAL_MS)));
  const within = total === 0 ? 1 : Math.max(0, Math.min(1, (elapsed % REVEAL_MS) / REVEAL_MS));
  const finished = elapsed >= total * REVEAL_MS;

  useEffect(() => {
    if (finished) onDone?.();
  }, [finished, onDone]);

  // Backwards: the last pick is revealed first. `done` counts reveals, so the
  // one being drawn now is that many up from the bottom of the order.
  const drawingAt = total - 1 - done;
  const drawing = drawingAt >= 0 ? picks[drawingAt] : null;

  // Everything already out, in the order it came out — last pick first.
  const revealed = picks
    .map((slot, i) => ({ slot, pick: i + 1 }))
    .filter((row) => row.pick > total - done)
    .reverse();

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c", marginTop: 26 }}>
        DRAFT NIGHT
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 34,
          letterSpacing: "-.03em",
          margin: "7px 0 8px",
          fontWeight: 500,
          color: "#e9e9ed",
        }}
      >
        {finished ? "The order is set" : "Drawing the order"}
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.65, margin: "0 0 20px" }}>
        {finished
          ? "Every pick is spoken for. The commissioner starts round one."
          : "From the last pick up to the first."}
      </p>

      {drawing ? (
        <>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".24em",
              color: "#b5abfc",
              marginBottom: 8,
            }}
          >
            PICK {drawingAt + 1} OF {total}
          </div>
          <Reel
            picks={picks}
            landOn={drawingAt}
            progress={settle(within)}
            managers={bySlot}
            logos={logos}
          />
        </>
      ) : null}

      {revealed.length ? (
        <div
          style={{
            marginTop: drawing ? 22 : 0,
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
          {revealed.map((row) => {
            const m = bySlot.get(row.slot)!;
            const first = row.pick === 1;
            return (
              <div
                key={row.slot}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "11px 14px",
                  borderTop: "1px solid rgba(145,132,217,.12)",
                  background: first ? "rgba(145,132,217,.16)" : undefined,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 13,
                    width: 30,
                    flex: "0 0 auto",
                    color: first ? "#d2cefd" : "#75798c",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.pick}
                </span>
                <TeamCrest
                  franchise={m.franchise}
                  logo={logos[m.id] ?? null}
                  size={28}
                  shape="box"
                  fallback="initials"
                />
                {/* The franchise, and whoever holds it. A draft order is read
                    out loud on the night — "pick four, Gold Coast, Pat" — and
                    a list of twelve franchise names alone leaves everybody
                    working out whose is whose.
                    
                    Two elements rather than one string, so the name is not the
                    first thing an ellipsis eats: a franchise called "Kim's Very
                    Long Franchise Name" would otherwise clip away the one word
                    that says whose pick it is. The franchise gives instead. */}
                <span
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    minWidth: 0,
                    flex: 1,
                    fontFamily: "var(--font-heading)",
                    fontSize: 15,
                    color: first ? "#e9e9ed" : "#c8ccdc",
                  }}
                >
                  <span
                    style={{
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.franchise}
                  </span>
                  {firstName(m.name) ? (
                    <span
                      style={{
                        flex: "0 0 auto",
                        // A margin, not a leading space: each of these is a
                        // flex item and flexbox eats whitespace at the edge of
                        // one, which ran the dot straight into the franchise.
                        marginLeft: 6,
                        color: "#75798c",
                        fontWeight: 400,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {`· ${firstName(m.name)}`}
                    </span>
                  ) : null}
                </span>
                {first ? (
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      letterSpacing: ".16em",
                      color: "#b5abfc",
                      flex: "0 0 auto",
                    }}
                  >
                    FIRST OVERALL
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** How wide one franchise is on the reel, and the gap between two. */
const CARD = 132;
const GAP = 10;

/**
 * The spinning strip.
 *
 * The list is repeated so there is always something either side of the window
 * — a reel that ran out of names would show empty space at both ends of every
 * spin. It travels several whole lengths before landing, which is what makes
 * it read as a wheel rather than a list scrolling to a position.
 */
function Reel({
  picks,
  landOn,
  progress,
  managers,
  logos,
}: {
  picks: string[];
  landOn: number;
  progress: number;
  managers: Map<string, Manager>;
  logos: Record<string, string | null>;
}) {
  const step = CARD + GAP;
  const loops = 4;
  const strip = [...picks, ...picks, ...picks, ...picks, ...picks, ...picks];

  // From a whole number of laps away, easing in to rest on the winner.
  const from = picks.length * loops;
  const to = picks.length * (loops + 1) + landOn;
  const offset = (from + (to - from) * progress) * step;

  return (
    <div
      className="gl-lottery-window"
      style={{
        position: "relative",
        overflow: "hidden",
        border: "1px solid rgba(145,132,217,.3)",
        borderRadius: "var(--radius-lg)",
        background: "rgba(20,22,35,.7)",
        padding: "14px 0",
        // Faded at both edges, so names arrive out of nowhere rather than
        // sliding in from a hard border.
        WebkitMaskImage:
          "linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent)",
        maskImage: "linear-gradient(90deg,transparent,#000 14%,#000 86%,transparent)",
      }}
    >
      {/* The marker the reel lands under. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: "50%",
          top: 0,
          bottom: 0,
          width: CARD + 8,
          transform: "translateX(-50%)",
          border: "1px solid rgba(181,171,252,.55)",
          borderRadius: "var(--radius-md)",
          background: "rgba(145,132,217,.1)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          display: "flex",
          gap: GAP,
          // The centre of the window, less however far the reel has travelled.
          transform: `translateX(calc(50% - ${CARD / 2}px - ${offset}px))`,
          willChange: "transform",
        }}
      >
        {strip.map((slot, i) => {
          const m = managers.get(slot)!;
          return (
            <div
              key={`${slot}-${i}`}
              style={{
                width: CARD,
                flex: "0 0 auto",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                padding: "6px 4px",
              }}
            >
              <TeamCrest
                franchise={m.franchise}
                logo={logos[m.id] ?? null}
                size={40}
                shape="box"
                fallback="initials"
              />
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 12,
                  color: "#c8ccdc",
                  textAlign: "center",
                  lineHeight: 1.35,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {m.franchise}
              </span>
              {/* Under the franchise on the reel rather than beside it: these
                  cards are 132px wide and a name on the same line would push
                  the franchise to a third clamped row. */}
              {firstName(m.name) ? (
                <span
                  style={{
                    fontSize: 10.5,
                    color: "#75798c",
                    textAlign: "center",
                    marginTop: -2,
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {firstName(m.name)}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
