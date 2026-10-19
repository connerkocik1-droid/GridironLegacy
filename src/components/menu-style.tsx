import type { CSSProperties, ReactNode } from "react";
import { hairline, tint } from "./RowList";

/**
 * The avatar menu's own small vocabulary, from the menu panel in
 * prototype/Pylon App.dc.html: rows that expand in place, each with a label,
 * a quiet hint on the right and a chevron that turns when it opens. Shared by
 * ProfileMenu and TeamSettings, whose rows sit in the same panel.
 */

export function menuRowStyle(open: boolean, first?: boolean): CSSProperties {
  return {
    ...(first ? {} : hairline),
    ...(open ? { backgroundColor: tint(7) } : {}),
  };
}

export const menuButton: CSSProperties = {
  cursor: "pointer",
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "13px 16px",
  minHeight: 44,
  border: 0,
  background: "transparent",
  color: "var(--text)",
  font: "inherit",
  textAlign: "left",
};

export function MenuLabel({
  children,
  hint,
  open,
  tone,
}: {
  children: ReactNode;
  hint?: ReactNode;
  open?: boolean;
  tone?: "accent" | "quiet" | "danger";
}) {
  return (
    <>
      <span
        style={{
          fontSize: 13,
          fontWeight: 500,
          ...(tone === "accent"
            ? { color: "var(--ap-a200)", fontStyle: "italic" }
            : tone === "quiet"
              ? { color: "var(--ap-n400)" }
              : tone === "danger"
                ? { color: "var(--ap-bad-text)" }
                : {}),
        }}
      >
        {children}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ap-n500)", whiteSpace: "nowrap" }}>{hint}</span>
      <span
        aria-hidden
        style={{
          flex: "0 0 auto",
          fontSize: 15,
          color: "var(--ap-n500)",
          transition: "transform .2s ease",
          transform: `rotate(${open ? 90 : 0}deg)`,
        }}
      >
        ›
      </span>
    </>
  );
}

/** The inside of an open row. */
export const menuBody: CSSProperties = { padding: "0 16px 12px" };

export const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 11,
  color: "var(--ap-n500)",
  marginBottom: 6,
  letterSpacing: ".04em",
};

export const fieldStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 11px",
  borderRadius: 3,
  border: "1px solid var(--ap-n700)",
  background: "color-mix(in oklch, var(--bg) 70%, transparent)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 13,
};

export const menuText: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.55,
  color: "var(--ap-n400)",
};

