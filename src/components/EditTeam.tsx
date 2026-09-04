"use client";

import Link from "next/link";
import TeamCrest from "./TeamCrest";
import TeamSettings from "./TeamSettings";
import { useMe } from "@/lib/use-me";

/**
 * The Edit Team page.
 *
 * The forms are TeamSettings, the same ones behind the crest in the nav —
 * this is where they are given room and a title rather than a second
 * implementation of them.
 */
export default function EditTeam() {
  const me = useMe();

  if (me.status === "checking") {
    return (
      <div style={{ maxWidth: 560, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "var(--text-dim)" }}>
        Reading your franchise…
      </div>
    );
  }

  if (me.status !== "signed-in" || !me.manager) {
    return (
      <div
        style={{
          maxWidth: 560,
          margin: "60px auto",
          padding: "0 18px",
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        Sign in to change your team.
      </div>
    );
  }

  const manager = me.manager;

  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 6px" }}>
        <Link
          href="/my-team"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
            fontSize: 11.5,
            color: "var(--accent-link)",
            textDecoration: "none",
          }}
        >
          ← My Team
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 13, marginBottom: 18 }}>
        <TeamCrest franchise={manager.franchise} logo={manager.logo} size={48} shape="box" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>EDIT TEAM</div>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 26,
              letterSpacing: "-.02em",
              margin: "6px 0 0",
              fontWeight: 500,
              color: "var(--text)",
              overflowWrap: "anywhere",
            }}
          >
            {manager.franchise}
          </h1>
        </div>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 16px" }}>
        Your franchise&rsquo;s name and picture are what the rest of the league sees
        beside your score. Your PIN is only yours.
      </p>

      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          borderRadius: "var(--radius-lg)",
          background: "rgb(var(--surface-rgb) / .55)",
          overflow: "hidden",
          paddingTop: 2,
        }}
      >
        <TeamSettings manager={manager} />
      </div>
    </div>
  );
}
