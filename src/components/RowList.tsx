"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { panelMark } from "@/lib/liquid-glass";

/**
 * The one list row the redesign is built from, and the handful of pieces that
 * sit around it. Almost every list in the three-tab app — standings, free
 * agency, trades, transactions, every ranking — is a `RowGroup` of `RowSpec`s,
 * carrying what is different as props rather than becoming its own component.
 *
 * Ported value for value from `row(o)`, `group()`, `chipsOf()` and `note()` in
 * prototype/Pylon App.dc.html, against the --ap-* ramp in theme.css so light
 * and sixteen-bit follow it. Keep it one generic row with props, not twenty
 * bespoke lists — that is the handoff's own instruction.
 */

/** color-mix of the text colour at a percentage: the design's glass and hairlines. */
export const ink = (pct: number) => `color-mix(in oklch, var(--text) ${pct}%, transparent)`;
/** The same, of the accent. */
export const tint = (pct: number) => `color-mix(in oklch, var(--ap-accent) ${pct}%, transparent)`;

/** A hairline that fades out at both ends, as a background so hover can still set a colour. */
export const hairline: CSSProperties = {
  backgroundImage: `linear-gradient(90deg,transparent,${ink(7)} 40px,${ink(7)} calc(100% - 40px),transparent)`,
  backgroundSize: "100% 1px",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "top",
};

/** The quiet panel every group of rows sits in. */
export const listPanel: CSSProperties = {
  borderRadius: 6,
  overflow: "hidden",
  background: ink(3),
  backdropFilter: "blur(18px)",
  WebkitBackdropFilter: "blur(18px)",
  border: `1px solid ${ink(7)}`,
  ...panelMark,
};

/** The lit panel: a matchup hero, the trade balance. */
export const heroPanel: CSSProperties = {
  borderRadius: 6,
  overflow: "hidden",
  background: `linear-gradient(160deg,${tint(16)},${ink(2)})`,
  backdropFilter: "blur(22px) saturate(160%)",
  WebkitBackdropFilter: "blur(22px) saturate(160%)",
  border: `1px solid ${ink(10)}`,
  boxShadow: `inset 0 1px 0 ${ink(12)}, 0 16px 40px rgb(var(--shadow-rgb) / .45)`,
  ...panelMark,
};

/** The big light-italic numerals scores are set in. */
export const bigItalic = (size: number, lead: boolean): CSSProperties => ({
  fontSize: size,
  fontWeight: 300,
  fontStyle: "italic",
  letterSpacing: "-.05em",
  lineHeight: 1,
  color: lead ? "var(--ap-a100)" : "var(--ap-n300)",
});

export type Movement = { tone: "up" | "down" | "flat" | "new"; label: string };

export interface RowAction {
  label: ReactNode;
  onClick: () => void;
  on?: boolean;
  tone?: "quiet";
  disabled?: boolean;
  ariaLabel?: string;
}

export type TagTone = "slot" | "warn" | "live" | "flat";

export interface RowTag {
  label: ReactNode;
  tone: TagTone;
}

export interface RowOption {
  label: string;
  onClick: () => void;
  tone?: "danger" | "warn";
}

export interface RowSpec {
  /** Stable key for React and for expand-in-place. */
  key: string;
  num?: number;
  lit?: boolean;
  chg?: Movement;
  check?: boolean;
  /** Abbreviation text in a small square tile. */
  tile?: ReactNode;
  tileTone?: "me";
  /** A rendered logo in place of a text tile (a TeamCrest, a club mark). */
  logo?: ReactNode;
  title: ReactNode;
  titleColor?: string;
  tags?: RowTag[];
  sub?: ReactNode;
  spark?: number[] | null;
  /** Lower is better (a rank), so a falling line is the good direction. */
  sparkRank?: boolean;
  val?: ReactNode;
  valSub?: ReactNode;
  bigVal?: boolean;
  valColor?: string;
  actions?: RowAction[];
  hi?: boolean;
  tight?: boolean;
  onClick?: () => void;
  href?: string;
  /** Expand in place: key/value lines, and option buttons with a note under them. */
  detail?: [string, ReactNode][];
  opts?: RowOption[];
  optNote?: ReactNode;
  /** Anything else drawn under the row while it is open. */
  extra?: ReactNode;
}

export function tagStyle(tone: TagTone): CSSProperties {
  const base: CSSProperties = {
    fontSize: 8,
    letterSpacing: ".1em",
    padding: "2px 5px",
    borderRadius: 2,
    flex: "0 0 auto",
    whiteSpace: "nowrap",
    lineHeight: 1.3,
  };
  if (tone === "slot") return { ...base, color: "var(--ap-a100)", background: tint(30) };
  if (tone === "warn") return { ...base, color: "var(--ap-warn-text)", background: "rgb(var(--ap-warn-rgb) / .18)" };
  if (tone === "live") return { ...base, color: "var(--ap-a200)", border: "1px solid var(--ap-a600)" };
  return { ...base, color: "var(--ap-n400)", background: ink(7) };
}

export function Tag({ tag }: { tag: RowTag }) {
  return <span style={tagStyle(tag.tone)}>{tag.label}</span>;
}

/** The small square abbreviation tile: a position, a club, a slot. */
export function tileStyle(me?: boolean, size = 24): CSSProperties {
  return {
    flex: "0 0 auto",
    width: size,
    height: size,
    borderRadius: 3,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size > 28 ? 9 : 8,
    fontWeight: 600,
    letterSpacing: ".02em",
    ...(me
      ? { color: "var(--bg)", background: "var(--ap-a300)" }
      : { color: "var(--ap-a200)", background: tint(14), border: `1px solid ${tint(22)}` }),
  };
}

export function btnStyle(on?: boolean, tone?: "quiet", disabled?: boolean): CSSProperties {
  return {
    cursor: disabled ? "default" : "pointer",
    flex: "0 0 auto",
    fontFamily: "inherit",
    fontSize: 9,
    letterSpacing: ".12em",
    padding: "6px 8px",
    minHeight: 28,
    minWidth: 30,
    borderRadius: 3,
    border: "1px solid",
    ...(on
      ? { borderColor: "var(--ap-a500)", background: tint(22), color: "var(--ap-a100)" }
      : tone === "quiet" || disabled
        ? { borderColor: "var(--ap-n700)", background: "transparent", color: "var(--ap-n400)" }
        : { borderColor: "var(--ap-a700)", background: "transparent", color: "var(--ap-a200)" }),
    opacity: disabled ? 0.5 : 1,
  };
}

/** The full-width button under a panel: SEND, SIGN OUT, LOCK WEEK. */
export function wideBtnStyle(enabled: boolean, quiet?: boolean): CSSProperties {
  return {
    cursor: enabled ? "pointer" : "default",
    width: "100%",
    fontFamily: "inherit",
    fontSize: 10,
    letterSpacing: ".14em",
    padding: "10px 0",
    minHeight: 38,
    borderRadius: 3,
    border: "1px solid",
    ...(!enabled
      ? { borderColor: "var(--ap-n700)", background: "transparent", color: "var(--ap-n500)" }
      : quiet
        ? { borderColor: "var(--ap-n700)", background: "transparent", color: "var(--ap-n300)" }
        : { borderColor: "var(--ap-a500)", background: tint(18), color: "var(--ap-a100)" }),
  };
}

export function optStyle(tone?: "danger" | "warn" | "quiet"): CSSProperties {
  return {
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 10,
    letterSpacing: ".12em",
    padding: "8px 12px",
    minHeight: 34,
    borderRadius: 3,
    border: "1px solid",
    ...(tone === "danger"
      ? { borderColor: "rgb(var(--ap-bad-rgb) / .5)", background: "rgb(var(--ap-bad-rgb) / .08)", color: "var(--ap-bad-text)" }
      : tone === "warn"
        ? { borderColor: "rgb(var(--ap-warn-rgb) / .45)", background: "rgb(var(--ap-warn-rgb) / .08)", color: "var(--ap-warn-text)" }
        : tone === "quiet"
          ? { borderColor: "var(--ap-n700)", background: "transparent", color: "var(--ap-n300)" }
          : { borderColor: "var(--ap-a600)", background: tint(14), color: "var(--ap-a100)" }),
  };
}

/** The big italic rank; the top few lit with accent gradient text. */
export function numStyle(lit?: boolean): CSSProperties {
  const base: CSSProperties = {
    flex: "0 0 auto",
    width: 24,
    fontSize: 19,
    fontWeight: 300,
    fontStyle: "italic",
    letterSpacing: "-.06em",
    lineHeight: 1,
  };
  return lit
    ? {
        ...base,
        backgroundImage: "linear-gradient(170deg,var(--ap-a100),var(--ap-accent) 70%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        filter: `drop-shadow(0 0 9px ${tint(55)})`,
      }
    : { ...base, color: "var(--ap-a300)", opacity: 0.75 };
}

function chgColor(tone: Movement["tone"]) {
  if (tone === "up") return "var(--ap-a300)";
  if (tone === "down") return "var(--ap-bad-text)";
  if (tone === "new") return "var(--ap-a100)";
  return "var(--ap-n600)";
}

/** ▲3, ▼1, — or NEW, from a previous and a current position (lower is better). */
export function movement(prev: number | null | undefined, now: number): Movement {
  if (prev == null) return { tone: "new", label: "NEW" };
  const d = prev - now;
  if (d === 0) return { tone: "flat", label: "—" };
  return { tone: d > 0 ? "up" : "down", label: `${d > 0 ? "▲" : "▼"}${Math.abs(d)}` };
}

/** A four-point (or longer) trail as a 38x18 polyline with a dot on the end. */
export function Spark({ values, rank, width = 38 }: { values: number[]; rank?: boolean; width?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => {
    const x = Math.round(((i * 46) / (values.length - 1)) * 10) / 10;
    // A rank is drawn the way the design draws it: 1 at the top.
    const t = rank ? (v - lo) / span : (hi - v) / span;
    return [x, Math.round((2 + t * 14) * 10) / 10];
  });
  const up = rank ? values[0] >= values[values.length - 1] : values[values.length - 1] >= values[0];
  const colour = up ? "var(--ap-a300)" : "var(--ap-n500)";
  const end = pts[pts.length - 1];
  return (
    <svg width={width} height={18} viewBox="0 0 46 18" aria-hidden style={{ flex: "0 0 auto", overflow: "visible" }}>
      <polyline
        points={pts.map((p) => p.join(",")).join(" ")}
        fill="none"
        stroke={colour}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={end[0]} cy={end[1]} r={2.2} fill={colour} />
    </svg>
  );
}

export function Row({ row, first }: { row: RowSpec; first?: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const expandable = !!(row.detail?.length || row.opts?.length || row.extra);
  const clickable = !!(row.onClick || row.href || expandable);
  const activate = () => {
    if (row.onClick) row.onClick();
    else if (row.href) router.push(row.href);
    else if (expandable) setOpen((v) => !v);
  };

  return (
    <div
      style={{
        ...(first ? {} : hairline),
        ...(row.hi ? { backgroundColor: tint(10), boxShadow: "inset 2px 0 0 var(--ap-accent)" } : {}),
      }}
    >
      <div
        className="gl-row"
        onClick={clickable ? activate : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  activate();
                }
              }
            : undefined
        }
        role={clickable ? "button" : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
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
        {row.num != null ? <span style={numStyle(row.lit)}>{row.num}</span> : null}
        {row.chg ? (
          <span style={{ flex: "0 0 auto", width: 26, fontSize: 10, fontWeight: 500, color: chgColor(row.chg.tone) }}>
            {row.chg.label}
          </span>
        ) : null}
        {row.check != null ? (
          <span
            aria-hidden
            style={{
              flex: "0 0 auto",
              width: 17,
              height: 17,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "var(--bg)",
              ...(row.check
                ? { background: "var(--ap-a300)", border: "1px solid var(--ap-a300)" }
                : { border: "1px solid var(--ap-n600)" }),
            }}
          >
            {row.check ? "✓" : ""}
          </span>
        ) : null}
        {row.logo ? (
          <span style={{ flex: "0 0 auto", display: "inline-flex" }}>{row.logo}</span>
        ) : row.tile != null ? (
          <span style={tileStyle(row.tileTone === "me")}>{row.tile}</span>
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
            {row.tags?.map((t, i) => <Tag key={i} tag={t} />)}
          </div>
          {row.sub != null && row.sub !== "" ? (
            <div
              style={{
                fontSize: 9.5,
                color: "var(--ap-n500)",
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {row.sub}
            </div>
          ) : null}
        </div>
        {row.spark ? <Spark values={row.spark} rank={row.sparkRank} /> : null}
        {row.val != null ? (
          <div style={{ textAlign: "right", flex: "0 0 auto" }}>
            <div
              style={{
                ...(row.bigVal
                  ? { fontSize: 15, fontWeight: 300, fontStyle: "italic", letterSpacing: "-.03em" }
                  : { fontSize: 13, fontWeight: 500 }),
                color: row.valColor ?? "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {row.val}
            </div>
            {row.valSub ? (
              <div style={{ fontSize: 9, letterSpacing: ".06em", color: "var(--ap-n500)", marginTop: 2 }}>{row.valSub}</div>
            ) : null}
          </div>
        ) : null}
        {row.actions?.map((a, i) => (
          <button
            key={i}
            type="button"
            className="gl-press"
            aria-label={a.ariaLabel}
            aria-pressed={a.on}
            disabled={a.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!a.disabled) a.onClick();
            }}
            style={btnStyle(a.on, a.tone, a.disabled)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {open && row.opts?.length ? (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "4px 12px 4px 46px", animation: "ap-rise .2s ease both" }}>
            {row.opts.map((o) => (
              <button
                key={o.label}
                type="button"
                className="gl-press"
                onClick={(e) => {
                  e.stopPropagation();
                  o.onClick();
                }}
                style={optStyle(o.tone)}
              >
                {o.label}
              </button>
            ))}
          </div>
          {row.optNote ? (
            <div style={{ fontSize: 9.5, color: "var(--ap-n500)", padding: "2px 12px 10px 46px" }}>{row.optNote}</div>
          ) : null}
        </>
      ) : null}
      {open
        ? row.detail?.map(([k, v], i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 10, padding: "0 12px 6px 46px", fontSize: 10.5, lineHeight: 1.45, animation: "ap-rise .2s ease both" }}
            >
              <span style={{ color: "var(--ap-n500)", flex: "0 0 auto", width: 46 }}>{k}</span>
              <span style={{ color: "var(--ap-n300)", minWidth: 0 }}>{v}</span>
            </div>
          ))
        : null}
      {open && row.extra ? <div style={{ animation: "ap-rise .2s ease both" }}>{row.extra}</div> : null}
    </div>
  );
}

/** The italic group label with a fading accent rule and a note on the right. */
export function GroupLabel({ label, note }: { label: ReactNode; note?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 2px 6px" }}>
      <span
        style={{
          fontSize: 9.5,
          fontWeight: 500,
          fontStyle: "italic",
          letterSpacing: ".18em",
          color: "var(--ap-a200)",
          flex: "0 0 auto",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,var(--ap-a700),transparent)" }} />
      {note != null ? <span style={{ fontSize: 10, color: "var(--ap-n500)", flex: "0 0 auto" }}>{note}</span> : null}
    </div>
  );
}

/**
 * A labelled panel of rows. `limit` folds it to that many with a "Show all N"
 * row, the way the design keeps a 32-team board to one screen.
 */
export function RowGroup({
  label,
  note,
  rows,
  limit,
  empty,
}: {
  label?: ReactNode;
  note?: ReactNode;
  rows: RowSpec[];
  limit?: number;
  /** A row to show when there are none. */
  empty?: Omit<RowSpec, "key">;
}) {
  const [more, setMore] = useState(false);
  let shown = rows;
  if (limit && rows.length > limit) {
    shown = more ? rows : rows.slice(0, limit);
    shown = shown.concat({
      key: "__more",
      title: more ? "Show less" : `Show all ${rows.length}`,
      titleColor: "var(--ap-a300)",
      sub: more ? "" : `${rows.length - limit} more`,
      onClick: () => setMore((v) => !v),
    });
  }
  if (!shown.length && empty) shown = [{ key: "__empty", ...empty }];

  return (
    <div style={{ marginBottom: 10 }}>
      {label != null ? <GroupLabel label={label} note={note} /> : null}
      <div style={listPanel}>
        {shown.map((row, i) => (
          <Row key={row.key} row={row} first={i === 0} />
        ))}
      </div>
    </div>
  );
}

export interface Chip<T extends string> {
  value: T;
  label?: ReactNode;
}

/** The filter strip above a list: All · QB · RB … */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: (T | Chip<T>)[];
  value: T;
  onChange: (next: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 4, overflowX: "auto", scrollbarWidth: "none", padding: "0 0 8px" }}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const text = typeof o === "string" ? o : (o.label ?? o.value);
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            className="gl-press"
            aria-pressed={on}
            onClick={() => onChange(v)}
            style={{
              cursor: "pointer",
              flex: "0 0 auto",
              fontFamily: "inherit",
              fontSize: 10.5,
              padding: "5px 9px",
              minHeight: 30,
              borderRadius: 2,
              border: `1px solid ${on ? "var(--ap-a600)" : ink(9)}`,
              background: on ? tint(20) : "transparent",
              color: on ? "var(--text)" : "var(--ap-n400)",
              whiteSpace: "nowrap",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

/** A one-line callout above a list: UPGRADE, NO UPGRADES, DROPPED. */
export function Note({ tag, children, tone = "accent" }: { tag: string; children: ReactNode; tone?: "accent" | "warn" }) {
  const c =
    tone === "warn"
      ? ["rgb(var(--ap-warn-rgb) / .3)", "rgb(var(--ap-warn-rgb) / .08)", "var(--ap-warn-text)"]
      : [tint(30), tint(8), "var(--ap-a200)"];
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "flex-start",
        padding: "7px 9px",
        marginBottom: 8,
        borderRadius: 4,
        border: `1px solid ${c[0]}`,
        background: c[1],
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 8,
          letterSpacing: ".14em",
          padding: "2px 5px",
          borderRadius: 2,
          whiteSpace: "nowrap",
          color: c[2],
          border: `1px solid ${c[0]}`,
        }}
      >
        {tag}
      </span>
      <span style={{ fontSize: 10.5, lineHeight: 1.45, color: "var(--ap-n300)", minWidth: 0 }}>{children}</span>
    </div>
  );
}

/** The small grey line under a screen. */
export function Foot({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 10, lineHeight: 1.5, color: "var(--ap-n500)", padding: "2px 4px" }}>{children}</div>;
}

/** A loading placeholder in the shape of a list panel. */
export function GroupSkeleton({ rows = 6, label = true }: { rows?: number; label?: boolean }) {
  return (
    <div style={{ marginBottom: 10 }} aria-busy>
      {label ? <div style={{ height: 14, width: 120, margin: "2px 2px 8px", borderRadius: 2, background: ink(6) }} /> : null}
      <div style={listPanel}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} style={{ ...(i ? hairline : {}), height: 44, display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
            <span style={{ width: 24, height: 24, borderRadius: 3, background: ink(6) }} />
            <span style={{ flex: 1, height: 10, borderRadius: 2, background: ink(6), maxWidth: 160 + ((i * 37) % 80) }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A screen's content column, under the header strip: the design's 10px
 * gutters, and a phone-width column on a desktop so rows do not stretch to a
 * metre long.
 */
export function AppView({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div style={{ maxWidth: wide ? 900 : 560, margin: "0 auto", padding: "9px 10px 14px", boxSizing: "border-box" }}>
      {children}
    </div>
  );
}
