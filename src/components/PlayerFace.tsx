"use client";

import { player } from "@/lib/roster";
import Headshot from "./Headshot";
import TeamMark from "./TeamMark";
import { tileStyle } from "./RowList";

/**
 * A player's face for a list row: his headshot over his position tile, with
 * his club's mark in the corner. A man with no picture shows the tile, and a
 * free agent shows no mark.
 */
export default function PlayerFace({ name, size = 30 }: { name: string; size?: number }) {
  const p = player(name);
  const pos = p?.p === "D/ST" ? "DEF" : (p?.p ?? "");
  // A defense is its club: the logo is the face.
  if (p?.p === "D/ST" && p.t) {
    return (
      <span style={{ ...tileStyle(false, size), padding: 3, boxSizing: "border-box" }}>
        <TeamMark team={p.t} size={size - 8} opacity={1} />
      </span>
    );
  }
  return (
    <span style={{ position: "relative", flex: "0 0 auto", width: size, height: size }}>
      <span style={{ ...tileStyle(false, size), position: "absolute", inset: 0 }}>{pos}</span>
      <Headshot
        name={name}
        width={size}
        height={size}
        style={{ position: "absolute", inset: 0, width: size, height: size, borderRadius: 3, objectFit: "cover", objectPosition: "top" }}
      />
      {p?.t ? (
        <span
          style={{
            position: "absolute",
            right: -4,
            bottom: -4,
            width: 15,
            height: 15,
            display: "grid",
            placeItems: "center",
            borderRadius: 3,
            background: "var(--bg)",
            border: "1px solid var(--ap-n700)",
          }}
        >
          <TeamMark team={p.t} size={11} opacity={1} />
        </span>
      ) : null}
    </span>
  );
}
