/**
 * Ported from pylon-intro-v2.jsx (design handoff, launch-intro bundle):
 * the character-map sprites, the palette, and the row-runs that turn a
 * sprite's rows into flat rect lists. Precomputed once at module load so
 * the per-frame draw never re-walks a character grid.
 */

export type Rect = { x: number; y: number; w: number; c: string };
export type RectSet = Rect[] & { w: number; h: number };

const PAL: Record<string, string> = {
  H: "#0e2350",
  h: "#2c4a80",
  N: "#0e2350",
  G: "#69be28",
  g: "#a5acaf",
  d: "#6e7478",
  W: "#f4f2ff",
  S: "#8a5a3c",
  K: "#0a0820",
  B: "#8a4a1c",
  b: "#5e2f10",
  L: "#f4f2ff",
  M: "#c8ccdc",
  R: "#d8324e",
  r: "#b8203c",
  w: "#e0daff",
  T: "#c68a5c",
  O: "#0a0820",
};

const JSN_RUN = [
  ".....HHHHHH.....",
  "....HHHGGHHH....",
  "....HhHGGHHH....",
  "....HMMMMMMH....",
  "....HMSKSKMH....",
  "....HMSSSSMH....",
  ".....MMSSMM.....",
  "...NNNNNNNNNN...",
  "..NNNNNNNNNNNN..",
  ".SNNNNWNNWNNNNS.",
  ".SNNNNWNNWNNNNS.",
  ".SSNNNWNNWNNNSS.",
  "..S.NNNNNNNN.S..",
  "....GGGGGGGG....",
  "....gggggggg....",
  "....ggg..ggg....",
  "....ggg..ggg....",
  "....NNN..ggg....",
  "....NNN..NNN....",
  "....NNN..KKK....",
  "...KKKK.........",
  "................",
];
const JSN_CATCH = [
  "...SS......SS...",
  "...SS......SS...",
  "...NS.HHHH.SN...",
  "...NNHHGGHHNN...",
  "....NHhGGHHN....",
  "....HMMMMMMH....",
  "....HMSKSKMH....",
  "....HMSSSSMH....",
  ".....MMSSMM.....",
  "...NNNNNNNNNN...",
  "..NNNNNNNNNNNN..",
  "..NNNNWNNWNNNN..",
  "...NNNWNNWNNN...",
  "...NNNWNNWNNN...",
  "....NNNNNNNN....",
  "....GGGGGGGG....",
  "....gggggggg....",
  "....ggg..ggg....",
  "....ggg..ggg....",
  "....NNN..NNN....",
  "....NNN..NNN....",
  "...KKKK..KKKK...",
];
const JSN_DIVE = [
  "....................HHHH",
  "...................HhhHHM",
  "...........GNNNNNNHhHGHSMM",
  "KK.ggggggNNNWNWNNNHHHGSSSM...SSBB",
  "KKNgggdggGNNWNWNNNNHHHSSSSSSSSBBBB",
  ".NNggggggGNNWNWNNNNNNSSSSSSSSSSBBB",
  "...gggg..GNNNNNNNNNNNNN.......SS",
];
const SAF_RUN = [
  ".....RRRRRR.....",
  "....RRRWWRRR....",
  "....RRRWWRRR....",
  "....RMMMMMMR....",
  "....RMTKTKMR....",
  "....RMTTTTMR....",
  ".....MMTTMM.....",
  "...WWWWWWWWWW...",
  "..WWrrWWWWrrWW..",
  ".TWWWWrrrrWWWWT.",
  ".TWWWWWWWrrWWWT.",
  ".TTWWWrrrrWWWTT.",
  "..T.WWrrWWWW.T..",
  "....RRRRRRRR....",
  "....wwwwwwww....",
  "....www..www....",
  "....www..www....",
  "....RRR..www....",
  "....RRR..RRR....",
  "....RRR..KKK....",
  "...KKKK.........",
  "................",
];
const SAF_LUNGE = [
  "...................RRRR",
  "..................RWWRRRM",
  "..........RWWWWWWRRRRRTMM",
  "KK.wwwwwwRWWWrrWWWRRRRTTTTTTT",
  "KKRwwwwwwRWWWrrWWWWWRRTTTTTTTT",
  ".RRwwwwwwRWWWWWWWWWWWTTT",
  "...wwww..RWWWWWWWWWW",
];
const BALL = [".bBb.", "BBLBB", ".bBb."];

function mirror(rows: string[]): string[] {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, ".").split("").reverse().join(""));
}

/** Dark 1px outline around every sprite — the console-era read. */
function outline(rows: string[]): string[] {
  const w = Math.max(...rows.map((r) => r.length)) + 2;
  const grid = [
    ".".repeat(w),
    ...rows.map((r) => (`.${r}`).padEnd(w, ".")),
    ".".repeat(w),
  ].map((r) => r.split(""));
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] !== ".") continue;
      if (
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(
          ([dx, dy]) =>
            grid[y + dy] && grid[y + dy][x + dx] && grid[y + dy][x + dx] !== "."
        )
      ) {
        out[y][x] = "O";
      }
    }
  }
  return out.map((r) => r.join(""));
}

function toRects(rows: string[]): RectSet {
  const out: Rect[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === "." || !PAL[ch]) {
        x++;
        continue;
      }
      let e = x;
      while (row[e + 1] === ch) e++;
      out.push({ x, y, w: e - x + 1, c: PAL[ch] });
      x = e + 1;
    }
  });
  const set = out as RectSet;
  set.w = Math.max(...rows.map((r) => r.length));
  set.h = rows.length;
  return set;
}

const spr = (rows: string[]) => toRects(outline(rows));

/** Pylon geometry, generated from the app-icon.svg paths — no image file. */
export function pylonRects(h: number): RectSet {
  const s = h / 264;
  const out: Rect[] = [];
  const face = ["#ffb066", "#f79450", "#ec7a3a", "#e2662a"];
  const side = ["#d97b3c", "#c46430", "#b55424", "#a8431a"];
  for (let r = 0; r < h; r++) {
    const t = (r + 0.5) / h;
    const b = Math.min(3, Math.floor(t * 4));
    const fl = Math.round((196 - 28 * t - 150) * s);
    const fr = Math.round((280 + 28 * t - 150) * s);
    const sr = Math.round((316 + 24 * t - 150) * s);
    out.push({ x: fl, y: r, w: fr - fl, c: face[b] });
    out.push({ x: fr, y: r, w: Math.max(1, sr - fr), c: side[b] });
    if (t < 0.75 && fr - fl > 3) out.push({ x: fl + 1, y: r, w: 1, c: "#ffd09a" });
  }
  const bw = Math.round(212 * s);
  const bh = Math.max(2, Math.round(22 * s));
  for (let r = 0; r < bh; r++) {
    const inset = r === 0 || r === bh - 1 ? 1 : 0;
    out.push({
      x: inset,
      y: h + r,
      w: bw - inset * 2,
      c: r === 0 ? "#3a3458" : "#2b2741",
    });
  }
  const set = out as RectSet;
  set.w = bw;
  set.h = h + bh;
  return set;
}

export const PYLON_H = 17;

export const SPRITES = {
  runA: spr(JSN_RUN),
  runB: spr(mirror(JSN_RUN)),
  catchFrame: spr(JSN_CATCH),
  dive: spr(JSN_DIVE),
  sA: spr(SAF_RUN),
  sB: spr(mirror(SAF_RUN)),
  lunge: spr(SAF_LUNGE),
  ball: toRects(BALL),
  pylon: pylonRects(PYLON_H),
  logo: pylonRects(46),
};
