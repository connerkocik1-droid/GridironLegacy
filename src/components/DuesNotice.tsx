"use client";

import { useMe } from "@/lib/use-me";

/**
 * A line at the top of the home page, for the people who have not paid.
 *
 * Every league has the same problem in September and it is never the software:
 * three people have not paid, the commissioner does not want to be the one who
 * keeps asking, and so the asking happens in a group text where it is either
 * ignored or resented. This is a better place for it. It is seen by the person
 * who owes and by nobody else, it says the amount and where to send it in the
 * commissioner's own words, and it goes away the moment they are marked paid.
 *
 * Three things have to be true before it says anything, and the order is the
 * point:
 *
 *   1. The league has set a note. No note, no notice, for anybody, ever — a
 *      league that does not collect dues never sees a word about them.
 *   2. Somebody is signed in, and it is their own franchise being asked.
 *   3. That franchise is not marked paid.
 *
 * Deliberately not dismissible. A notice you can dismiss is a notice that is
 * dismissed once and never seen again, which is exactly the failure it exists
 * to fix — and the way to clear it is the way it should be cleared, which is
 * to pay. It is one line, it never covers anything, and it is gone for good
 * the moment the commissioner says so.
 *
 * Amber rather than red: this is a reminder between friends about a pot of
 * money, not a warning that something is broken.
 */
export default function DuesNotice() {
  const me = useMe();

  // "checking" says nothing. Being unsure must not look like being in arrears
  // — a bill that flashes up on every cold launch and then vanishes is worse
  // than no bill at all.
  if (me.status !== "signed-in" || !me.duesNote) return null;
  if (me.manager?.dues_paid !== false) return null;

  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "10px 26px 11px",
        borderBottom: "1px solid rgb(var(--warn-rgb) / .3)",
        background: "rgb(var(--warn-rgb) / .1)",
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: ".2em",
          color: "var(--warn)",
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        DUES
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "var(--text-2)",
          lineHeight: 1.5,
          minWidth: 0,
          overflowWrap: "anywhere",
        }}
      >
        {me.duesNote}
      </span>
    </div>
  );
}
