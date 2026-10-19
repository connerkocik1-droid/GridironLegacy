/**
 * Shared style fragments for the liquid-glass visual language, so every
 * page ported onto it reads as one system rather than each reinventing its
 * own gradient and blur numbers.
 *
 * `glassPanel` is the card/panel treatment used throughout
 * `prototype/Pylon App.dc.html` (a two-stop accent-tinted gradient over a
 * heavy blur, a hairline border, an inset top highlight) — already applied
 * to Nav, TabBar, the account menu and RowList's RowGroup. This file
 * extends the same look to the existing pages' own panels, and adds the
 * broadcast-style rank numeral and lit-gradient treatment for the numbered
 * lists (standings, power rankings, player ranks).
 */

import type { CSSProperties } from "react";

/**
 * Marks a surface as a panel for sixteen-bit mode, which swaps its glass for a
 * gold border and a hard shadow (globals.css). A custom property rather than a
 * data attribute so it travels inside the style objects below — every panel
 * that spreads one of them is marked without its JSX knowing.
 */
export const panelMark = { ["--gl-panel" as string]: 1 } as CSSProperties;

/** The same, for a full-width bar: a gold bottom edge rather than a box. */
export const barMark = { ["--gl-bar" as string]: 1 } as CSSProperties;

/** The accent-tinted glass panel: a card, a row group, a table wrapper. */
export const glassPanel: CSSProperties = {
  ...panelMark,
  background:
    "linear-gradient(160deg,rgb(var(--accent-rgb) / .07),rgb(var(--surface-rgb) / .3))",
  backdropFilter: "blur(18px) saturate(150%)",
  WebkitBackdropFilter: "blur(18px) saturate(150%)",
  border: "1px solid rgb(var(--accent-rgb) / .14)",
  boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .12)",
};

/** A slightly brighter variant for the one card on a page that is "mine"
 * or otherwise meant to stand out among its siblings. */
export const glassPanelAccent: CSSProperties = {
  ...panelMark,
  background:
    "linear-gradient(160deg,rgb(var(--accent-rgb) / .16),rgb(var(--surface-rgb) / .3))",
  backdropFilter: "blur(18px) saturate(150%)",
  WebkitBackdropFilter: "blur(18px) saturate(150%)",
  border: "1px solid rgb(var(--accent-rgb) / .34)",
  boxShadow: "inset 0 1px 0 rgb(var(--accent-rgb) / .18)",
};

/**
 * The broadcast rank numeral: light italic, tight tracking. `lit` gradients
 * the top handful in accent colour with a soft glow, the way the DC marks
 * #1–#3 (or #1–#5) on every ranked list.
 */
export function rankNumeral(lit?: boolean): CSSProperties {
  const base: CSSProperties = {
    fontWeight: 300,
    fontStyle: "italic",
    letterSpacing: "-.04em",
    fontVariantNumeric: "tabular-nums",
    lineHeight: 1,
  };
  if (!lit) return { ...base, color: "var(--accent-link)", opacity: 0.75 };
  return {
    ...base,
    backgroundImage:
      "linear-gradient(170deg,rgb(var(--accent-bright-rgb)),var(--accent-solid) 70%)",
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    filter: "drop-shadow(0 0 7px rgb(var(--accent-rgb) / .5))",
  };
}
