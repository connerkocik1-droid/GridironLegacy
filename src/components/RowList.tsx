"use client";

import { useState } from "react";

/**
 * The one list row the redesign is built from. Almost every list in the
 * new three-tab app — standings, free agency, trades, transactions,
 * rankings, the Pylon Report — goes through this and `RowGroup`, carrying
 * what's different as props rather than becoming its own component.
 *
 * Ported from `row(o)` / `group(label, note, rows, limit, key)` in
 * `prototype/Pylon App.dc.html`. Kept as one generic row with props, not
 * twenty bespoke lists, per that handoff's own instruction.
 */

export type Movement =
  | { tone: "up" | "down" | "flat"; label: string }
  | { tone: "new"; label: "NEW" };

export interface RowAction {
  label: string;
  onClick: () => void;
  on?: boolean;
  tone?: "quiet" | "danger" | "warn";
}

export interface RowTag {
  label: string;
  tone?: "slot" | "warn" | "live" | "flat";
}

export interface RowSpec {
  /** Stable key for React and for the expand-in-place toggle. */
  key?: string;
  /** Big italic rank number. `lit` gradients the top handful. */
  num?: number;
  lit?: boolean;
  chg?: Movement;
  /** A tile glyph (abbreviation text) or a rendered logo node. */
  tile?: React.ReactNode;
  tileTone?: "me";
  title: React.ReactNode;
  titleColor?: string;
  tags?: RowTag[];
  sub?: React.ReactNode;
  /** A pre-rendered sparkline (see `Sparkline` usage in callers). */
  spark?: React.ReactNode;
  val?: React.ReactNode;
  valSub?: React.ReactNode;
  bigVal?: boolean;
  valColor?: string;
  actions?: RowAction[];
  /** Accent highlight — "this one's mine." */
  hi?: boolean;
  tight?: boolean;
  onClick?: () => void;
  /** Rows shown inline when this row is expanded (see `key`). */
  detail?: [string, React.ReactNode][];
}

const tagTone: Record<NonNullable<RowTag["tone"]>, React.CSSProperties> = {
  slot: { color: "var(--accent-text)", background: "rgb(var(--accent-rgb) / .3)" },
  warn: { color: "var(--warn)", background: "rgb(var(--warn-rgb) / .18)" },
  live: { color: "var(--accent-link)", border: "1px solid var(--accent-link)" },
  flat: { color: "var(--text-quiet)", background: "rgb(var(--accent-rgb) / .07)" },
};

function numColor(lit?: boolean) {
  return lit
    ? {
        background: "linear-gradient(170deg,var(--accent-bright-rgb),var(--accent-solid) 70%)",
        WebkitBackgroundClip: "text" as const,
        backgroundClip: "text" as const,
        color: "transparent",
      }
    : { color: "var(--accent-link)", opacity: 0.75 };
}

function movementColor(tone: Movement["tone"]) {
  if (tone === "up") return "var(--accent-link)";
  if (tone === "down") return "var(--bad-text)";
  if (tone === "new") return "var(--accent-text)";
  return "var(--text-off)";
}

export function Row({ row, hairline }: { row: RowSpec; hairline?: boolean }) {
  const [open, setOpen] = useState(false);
  const clickable = !!(row.onClick || row.key);
  const toggle = row.onClick ?? (row.key ? () => setOpen((v) => !v) : undefined);

  return (
    <div
      style={{
        backgroundImage: hairline
          ? "linear-gradient(90deg,transparent,rgb(var(--accent-rgb) / .14) 40px,rgb(var(--accent-rgb) / .14) calc(100% - 40px),transparent)"
          : undefined,
        backgroundSize: "100% 1px",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "top",
        backgroundColor: row.hi ? "rgb(var(--accent-rgb) / .1)" : undefined,
        boxShadow: row.hi ? "inset 2px 0 0 var(--accent-link)" : undefined,
      }}
    >
      <div
        onClick={toggle}
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
          boxSizing: "border-box",
          padding: row.tight ? "5px 10px" : "6px 10px",
          cursor: clickable ? "pointer" : undefined,
        }}
      >
        {row.num != null ? (
          <span style={{ flex: "0 0 auto", width: 24, fontSize: 19, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.06em", lineHeight: 1, ...numColor(row.lit) }}>
            {row.num}
          </span>
        ) : null}

        {row.chg ? (
          <span style={{ flex: "0 0 auto", width: 26, fontSize: 10, fontWeight: 500, color: movementColor(row.chg.tone) }}>
            {row.chg.label}
          </span>
        ) : null}

        {row.tile ? (
          <span
            style={{
              flex: "0 0 auto",
              width: 24,
              height: 24,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 8,
              fontWeight: 600,
              color: row.tileTone === "me" ? "var(--bg)" : "var(--accent-text)",
              background: row.tileTone === "me" ? "var(--accent-link)" : "rgb(var(--accent-rgb) / .14)",
              border: row.tileTone === "me" ? undefined : "1px solid rgb(var(--accent-rgb) / .22)",
              overflow: "hidden",
            }}
          >
            {row.tile}
          </span>
        ) : null}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
                color: row.titleColor,
              }}
            >
              {row.title}
            </span>
            {(row.tags ?? []).map((t, i) => (
              <span
                key={i}
                style={{
                  fontSize: 8,
                  letterSpacing: ".1em",
                  padding: "2px 5px",
                  borderRadius: "var(--radius-sm)",
                  flex: "0 0 auto",
                  ...tagTone[t.tone ?? "flat"],
                }}
              >
                {t.label}
              </span>
            ))}
          </div>
          {row.sub ? (
            <div style={{ fontSize: 9.5, color: "var(--text-dim)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.sub}
            </div>
          ) : null}
        </div>

        {row.spark}

        {row.val != null ? (
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div
              style={{
                fontSize: row.bigVal ? 15 : 13,
                fontWeight: row.bigVal ? 300 : 500,
                fontStyle: row.bigVal ? "italic" : undefined,
                letterSpacing: row.bigVal ? "-.03em" : undefined,
                color: row.valColor ?? "var(--text)",
              }}
            >
              {row.val}
            </div>
            {row.valSub ? (
              <div style={{ fontSize: 9, letterSpacing: ".06em", color: "var(--text-dim)", marginTop: 2 }}>{row.valSub}</div>
            ) : null}
          </div>
        ) : null}

        {(row.actions ?? []).map((a, i) => (
          <button
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              a.onClick();
            }}
            style={{
              cursor: "pointer",
              flex: "0 0 auto",
              font: "inherit",
              fontSize: 9,
              letterSpacing: ".12em",
              padding: "6px 8px",
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${a.on ? "var(--accent-link)" : a.tone === "danger" ? "var(--bad-text)" : "rgb(var(--accent-rgb) / .3)"}`,
              background: a.on
                ? "rgb(var(--accent-rgb) / .22)"
                : a.tone === "danger"
                  ? "rgb(var(--bad-rgb) / .1)"
                  : "transparent",
              color: a.on ? "var(--accent-text)" : a.tone === "danger" ? "var(--bad-text)" : "var(--accent-link)",
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {open && row.detail?.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "0 12px 10px 46px" }}>
          {row.detail.map(([k, v], i) => (
            <div key={i} style={{ display: "flex", gap: 10, fontSize: 10.5, lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-dim)", flex: "0 0 auto", width: 46 }}>{k}</span>
              <span style={{ color: "var(--text-2)", minWidth: 0 }}>{v}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RowGroup({
  label,
  note,
  rows,
  limit,
}: {
  label?: React.ReactNode;
  note?: React.ReactNode;
  rows: RowSpec[];
  /** Shows only the first `limit` rows behind a "Show all N" row. */
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const overflowing = !!limit && rows.length > limit;
  const shown = overflowing && !expanded ? rows.slice(0, limit) : rows;

  return (
    <div style={{ marginBottom: 10 }}>
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 6px" }}>
          <span style={{ fontSize: 9.5, fontWeight: 500, fontStyle: "italic", letterSpacing: ".18em", color: "var(--accent-text)", flex: "0 0 auto" }}>
            {label}
          </span>
          <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,var(--accent-deep),transparent)" }} />
          {note ? <span style={{ fontSize: 10, color: "var(--text-dim)", flex: "0 0 auto" }}>{note}</span> : null}
        </div>
      ) : null}
      <div
        style={{
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          // Liquid glass: an accent-tinted gradient over a blur, rather than
          // the flat translucent fill this used before porting the DC's look.
          background:
            "linear-gradient(160deg,rgb(var(--accent-rgb) / .07),rgb(var(--surface-rgb) / .3))",
          backdropFilter: "blur(18px) saturate(150%)",
          WebkitBackdropFilter: "blur(18px) saturate(150%)",
          border: "1px solid rgb(var(--accent-rgb) / .14)",
          boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .12)",
        }}
      >
        {shown.map((row, i) => (
          <Row key={row.key ?? i} row={row} hairline={i > 0} />
        ))}
        {overflowing ? (
          <Row
            hairline
            row={{
              title: expanded ? "Show less" : `Show all ${rows.length}`,
              titleColor: "var(--accent-link)",
              sub: expanded ? undefined : `${rows.length - limit!} more`,
              onClick: () => setExpanded((v) => !v),
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
