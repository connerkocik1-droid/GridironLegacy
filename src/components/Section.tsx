"use client";

import { setCollapsed, useCollapsed } from "@/lib/use-collapsed";

/**
 * One band of the home page. Every section is announced the same way, so a
 * page made of four unrelated things still reads as one page.
 *
 * Given a `collapseId` the heading becomes the control for folding the band
 * away, and the fold is remembered for this browser. A manager who never looks
 * at the mini-games can put them out of sight without arguing with anybody
 * else's home page.
 */
export default function Section({
  eyebrow,
  title,
  aside,
  children,
  id,
  collapseId,
}: {
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  /** Makes the section collapsible, and names it in this browser's memory. */
  collapseId?: string;
}) {
  const folded = useCollapsed();
  const open = collapseId ? !folded[collapseId] : true;
  const bodyId = collapseId ? `${collapseId}-body` : undefined;

  const heading = (
    <>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>{eyebrow}</div>
      <h2
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 22,
          letterSpacing: "-.02em",
          fontWeight: 500,
          margin: "5px 0 0",
        }}
      >
        {title}
      </h2>
    </>
  );

  return (
    <section id={id} style={{ padding: "26px 26px 0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          margin: open ? "0 0 12px" : "0",
        }}
      >
        {collapseId ? (
          <button
            onClick={() => setCollapsed(collapseId, open)}
            aria-expanded={open}
            aria-controls={bodyId}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: 0,
              border: "none",
              background: "transparent",
              color: "inherit",
              font: "inherit",
              textAlign: "left",
              cursor: "pointer",
            }}
          >
            {/* Points down when the band is open, right when it is folded —
                the direction the content went, rather than an instruction. */}
            <span
              aria-hidden
              style={{
                marginTop: 14,
                color: "var(--text-dim)",
                fontSize: 10,
                lineHeight: 1,
                transition: "transform 140ms ease",
                transform: open ? "rotate(90deg)" : "none",
              }}
            >
              ▶
            </span>
            <span>{heading}</span>
          </button>
        ) : (
          <div>{heading}</div>
        )}

        {aside && open ? (
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>{aside}</div>
        ) : null}
      </div>

      {/* Unmounted rather than hidden. These bands hold live boards that poll;
          leaving one running behind a fold would be work nobody asked for. */}
      {open ? <div id={bodyId}>{children}</div> : null}
    </section>
  );
}
