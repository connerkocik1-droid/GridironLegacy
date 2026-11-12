"use client";

import Link from "next/link";
import type { BracketBox, BracketLayout, BracketLine } from "@/lib/bracket-layout";
import { useLogos } from "@/lib/use-logos";
import TeamCrest from "./TeamCrest";
import { ink, listPanel, tint } from "./RowList";

const BOX_W = 104;
const GAP = 12;
const LINE_H = 22;
const SLOT = 60;
const HEAD = 30;

/**
 * The bracket, drawn: a column per round, a box per game, and the lines that
 * carry each winner on to the next round. Byes are boxes of one. A round not
 * drawn yet still has its boxes, holding whoever is certain to be there and
 * TBD for the rest, so the shape of the whole postseason is visible from the
 * first week. The champion sits above it once there is one.
 *
 * Three rounds fit a phone exactly; anything wider, or a narrower phone,
 * scrolls sideways inside its own panel rather than pushing the page.
 */
export default function BracketGraphic({ layout, note }: { layout: BracketLayout; note?: string }) {
  const logos = useLogos();
  const cols = layout.columns.length;
  const first = layout.columns[0]?.boxes.length ?? 1;
  const height = first * SLOT;
  const width = cols * BOX_W + (cols - 1) * GAP;
  const x = (c: number) => c * (BOX_W + GAP);
  const y = (c: number, i: number) => {
    const slot = height / layout.columns[c].boxes.length;
    return HEAD + slot * i + slot / 2;
  };

  const crest = (id: string, franchise: string) => (
    <TeamCrest franchise={franchise} logo={logos[id] ?? null} size={14} shape="box" />
  );

  const line = (l: BracketLine, i: number, box: BracketBox) => {
    const t = l.team;
    return (
      <div
        key={i}
        style={{
          height: LINE_H,
          display: "flex",
          alignItems: "center",
          gap: 3,
          padding: "0 4px",
          background: t?.mine ? tint(18) : undefined,
          color: l.lost ? "var(--ap-n500)" : "var(--text)",
          ...(i > 0 ? { borderTop: `1px solid ${ink(8)}` } : {}),
        }}
      >
        {t ? (
          <>
            <span style={{ fontSize: 10, fontStyle: "italic", color: "var(--ap-a300)", width: 8, textAlign: "right", flex: "0 0 auto" }}>
              {t.seed}
            </span>
            {crest(t.id, t.franchise)}
            <span
              style={{
                fontSize: 11,
                fontWeight: l.won ? 700 : 500,
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {t.abbr}
            </span>
            {box.bye ? null : (
              <span
                style={{
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: l.won ? 700 : 400,
                  color: l.won ? "var(--good)" : l.lost ? "var(--ap-n500)" : "var(--ap-n300)",
                  flex: "0 0 auto",
                }}
              >
                {box.gameId && (box.final || (l.points ?? 0) > 0) ? (l.points ?? 0).toFixed(1) : ""}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--ap-n500)", letterSpacing: ".08em" }}>TBD</span>
        )}
      </div>
    );
  };

  return (
    <div style={{ ...listPanel, padding: "12px 12px 14px", marginBottom: 12 }}>
      {layout.champion ? (
        <div
          aria-label={`Champion: ${layout.champion.franchise}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            marginBottom: 12,
            borderRadius: 6,
            background: `linear-gradient(120deg,${tint(30)},${tint(8)})`,
            border: `1px solid ${tint(40)}`,
          }}
        >
          <span aria-hidden style={{ fontSize: 18 }}>🏆</span>
          <TeamCrest franchise={layout.champion.franchise} logo={logos[layout.champion.id] ?? null} size={24} shape="box" />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--ap-a200)" }}>CHAMPION</div>
            <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {layout.champion.franchise}
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ overflowX: "auto", scrollbarWidth: "none" }} data-bracket>
        <div style={{ position: "relative", width, height: HEAD + height, margin: "0 auto" }}>
          {/* The lines, under the boxes. */}
          <svg width={width} height={HEAD + height} style={{ position: "absolute", inset: 0 }} aria-hidden>
            {layout.columns.slice(0, -1).map((col, c) =>
              Array.from({ length: Math.floor(col.boxes.length / 2) }, (_, p) => {
                const x0 = x(c) + BOX_W;
                const xm = x0 + GAP / 2;
                const x1 = x(c + 1);
                const y1 = y(c, 2 * p);
                const y2 = y(c, 2 * p + 1);
                const ym = y(c + 1, p);
                return (
                  <path
                    key={`${c}:${p}`}
                    d={`M${x0},${y1}H${xm}V${y2}H${x0}M${xm},${ym}H${x1}`}
                    fill="none"
                    stroke={ink(22)}
                    strokeWidth={1}
                  />
                );
              }),
            )}
          </svg>

          {layout.columns.map((col, c) => (
            <div key={col.round}>
              <div
                style={{
                  position: "absolute",
                  left: x(c),
                  top: 0,
                  width: BOX_W,
                  fontSize: 10,
                  lineHeight: 1.35,
                  letterSpacing: ".12em",
                  color: "var(--ap-a200)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <div>{col.title.toUpperCase()}</div>
                {col.week ? <div style={{ color: "var(--ap-n500)" }}>WEEK {col.week}</div> : null}
              </div>
              {col.boxes.map((box, i) => {
                const h = box.bye ? LINE_H : LINE_H * 2 + 1;
                const style: React.CSSProperties = {
                  position: "absolute",
                  left: x(c),
                  top: y(c, i) - h / 2,
                  width: BOX_W,
                  borderRadius: 4,
                  overflow: "hidden",
                  background: "rgb(var(--surface-rgb))",
                  border: `1px solid ${box.gameId && !box.final ? tint(45) : ink(14)}`,
                  boxShadow: `0 2px 8px rgb(var(--shadow-rgb) / .25)`,
                  color: "inherit",
                  textDecoration: "none",
                  display: "block",
                };
                const inner = box.bye ? (
                  <>
                    {line(box.lines[0], 0, box)}
                    <div style={{ position: "absolute", right: 6, top: 0, height: LINE_H, display: "flex", alignItems: "center", fontSize: 10, letterSpacing: ".1em", color: "var(--ap-n500)" }}>
                      BYE
                    </div>
                  </>
                ) : (
                  box.lines.map((l, j) => line(l, j, box))
                );
                const home = box.lines[0]?.team?.id;
                return box.gameId && home ? (
                  <Link
                    key={box.key}
                    href={`/matchup?week=${box.week}&home=${home}`}
                    style={style}
                    data-bracket-box={box.key}
                    aria-label={`${col.title}: ${box.lines.map((l) => l.team?.franchise ?? "TBD").join(" v ")}`}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={box.key} style={style} data-bracket-box={box.key}>
                    {inner}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {note ? <div style={{ fontSize: 10.5, color: "var(--ap-n500)", marginTop: 8, textAlign: "center" }}>{note}</div> : null}
    </div>
  );
}
