"use client";

import { useState } from "react";
import ConfirmDialog from "./ConfirmDialog";

/**
 * The commissioner's undo for a draft that went wrong.
 *
 * It is deliberately two steps. The button itself does nothing but open a
 * dialog that says, in plain numbers, what is about to be thrown away — a
 * commissioner who meant to switch to the board view and missed has not just
 * wiped four rounds of picks.
 *
 * The trigger is rendered only for the commissioner, and the rule is enforced
 * again in SQL: this hides the control, it does not grant the right.
 */
export default function ResetDraft({
  picksMade,
  busy,
  onConfirm,
}: {
  picksMade: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={busy}
        style={{
          padding: "6px 13px",
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          border: "1px solid rgba(224,131,131,.34)",
          background: "transparent",
          color: "#c98f8f",
          borderRadius: "var(--radius-sm)",
          font: "inherit",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.5 : 1,
        }}
      >
        Reset draft
      </button>

      <ConfirmDialog
        open={open}
        title="Reset the draft?"
        confirmLabel="Reset the draft"
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          onConfirm();
        }}
      >
        <p style={{ fontSize: 13, lineHeight: 1.75, color: "#9397ab", margin: "0 0 10px" }}>
          {picksMade === 1 ? "One pick is" : `All ${picksMade} picks are`} undone and every roster
          in the league is emptied. The board is redrawn at the league&rsquo;s current size and the
          room closes, ready to open again.
        </p>

        <p style={{ fontSize: 12, lineHeight: 1.7, color: "#75798c", margin: 0 }}>
          Standing trade offers are declined and pending waiver claims cancelled, since the players
          they name go back into the pool. Draft queues are left alone, and the rosters are saved
          to the league&rsquo;s backups on the way past.
        </p>
      </ConfirmDialog>
    </>
  );
}
