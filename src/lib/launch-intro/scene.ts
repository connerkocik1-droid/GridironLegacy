/**
 * Ported from pylon-intro-v2.jsx (design handoff, launch-intro bundle):
 * the low-telephoto camera, the static world, and the frame-by-frame
 * choreography of `Piece()`. `drawFrame` is a pure function of (T, cut,
 * fontReady) — every position in it is derived from T, never from the
 * previous frame — matching the prototype's own composition model.
 */
import { SPRITES, type RectSet } from "./sprites";

export type Cut = "full" | "short";

/** Design tokens, from src/app/theme.css [data-theme="16bit"] plus scene-only colours. */
const C16 = {
  bg: "#12102a",
  well: "#0a0820",
  board: "#1a1638",
  raised: "#282252",
  appBg: "#161826",
  violet: "#9e5cff",
  violetDeep: "#5a2ea6",
  cyan: "#5ce1ff",
  cyanText: "#9df7ff",
  text: "#f4f2ff",
  text2: "#e0daff",
  off: "#605796",
  warn: "#ffd23d",
  bad: "#ff5c7a",
};

// Camera: low telephoto behind the end zone looking upfield. Field X in
// [-26.67, 26.67] yards, Z = yards from camera; goal line at Z=10.
const W = 130;
const H = 282;
const HOR = 90;
const CAMH = 3;
const F = 220;
const CAMX = 25.17;
const SIDE = 26.67;
const GOAL = 10;

function proj(X: number, Z: number, h = 0) {
  const s = F / Z;
  return { x: 65 + (X - CAMX) * s, y: HOR + (CAMH - h) * s, s };
}
function kOf(Z: number) {
  return Math.max(0.5, Math.round(((F / Z) * 2) / 22 / 0.5) * 0.5);
}
const PY = proj(SIDE, GOAL);

// Section starts (seconds), keyed off the two cuts' OM_SCENES durations.
const CUES_FULL = { Pass: 1.8, Catch: 3.8, Dive: 5.0, Hit: 6.2, Logo: 7.8 };
const CUES_SHORT = { Dive: 0.6, Hit: 1.4, Logo: 2.4 };
export const CUT_DURATION: Record<Cut, number> = { full: 10.0, short: 4.0 };

// ---- pure math helpers (ported from animations-v3.jsx's subset actually used)
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const Easing = {
  easeInQuad: (t: number) => t * t,
  easeOutCubic: (t: number) => (--t) * t * t + 1,
};
function interpolate(input: [number, number], output: [number, number], ease: (t: number) => number = (t) => t) {
  return (t: number) => {
    if (t <= input[0]) return output[0];
    if (t >= input[1]) return output[1];
    const span = input[1] - input[0];
    const local = span === 0 ? 0 : (t - input[0]) / span;
    return output[0] + (output[1] - output[0]) * ease(local);
  };
}
const MOTION = {
  enter: (a: number, b: number, t0: number, t1: number) => (T: number) =>
    interpolate([t0, t1], [a, b], Easing.easeOutCubic)(T),
  fall: (a: number, b: number, t0: number, t1: number) => (T: number) =>
    interpolate([t0, t1], [a, b], Easing.easeInQuad)(T),
  steps: <V,>(T: number, keys: [number, V][]) => {
    let v = keys[0][1];
    for (const [t, val] of keys) if (T >= t) v = val;
    return v;
  },
};
function lerpKeys(T: number, keys: [number, number][]) {
  if (T <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (T <= keys[i][0]) {
      const [t0, a] = keys[i - 1];
      const [t1, b] = keys[i];
      return a + (b - a) * ((T - t0) / (t1 - t0));
    }
  }
  return keys[keys.length - 1][1];
}
function hash(i: number, k: number) {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

// ---- the static world (sky, towers, crowd, turf, yard lines, goal post) ----
type WorldRect = { x: number; y: number; w: number; h: number; c: string; o?: number };
type World = { rects: WorldRect[]; heads: [number, number][] };

function buildWorld(): World {
  const rects: WorldRect[] = [];
  const R = (x: number, y: number, w: number, h: number, c: string, o?: number) =>
    rects.push({ x, y, w, h, c, o });

  R(-20, -20, W + 40, 40, "#0a0820");
  R(-20, 20, W + 40, 16, "#0e0b26");
  R(-20, 36, W + 40, 14, C16.bg);
  [20, 36].forEach((y0, i) => {
    for (let x = -20; x < W + 20; x += 2) R(x, y0 - 1, 1, 1, i ? C16.bg : "#0e0b26");
  });
  for (let i = 0; i < 18; i++) {
    R(Math.floor(hash(i, 1) * W), Math.floor(hash(i, 2) * 30), 1, 1, hash(i, 3) > 0.7 ? C16.cyanText : C16.off);
  }
  // Light towers
  ([[6, 14], [106, 8]] as const).forEach(([x, y]) => {
    R(x + 7, y + 12, 2, HOR - 40 - y - 12, "#1a1638");
    for (let g = 3; g >= 1; g--) R(x - g * 3, y - g * 3, 16 + g * 6, 12 + g * 6, C16.cyan, 0.06);
    R(x - 1, y - 1, 18, 13, "#282252");
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) R(x + c * 4, y + r * 4, 3, 3, C16.text);
  });
  // Far stands + crowd
  R(-20, HOR - 42, W + 40, 3, C16.board);
  R(-20, HOR - 40, W + 40, 1, C16.violetDeep);
  const crowdC = ["#2a2258", "#3a2e78", "#5a2ea6", "#9e5cff", "#282252", "#3a2e78", "#ff5c7a", "#5ce1ff"];
  const heads: [number, number][] = [];
  for (let y = HOR - 38, row = 0; y < HOR - 6; y += 3, row++) {
    for (let x = -12 + (row % 2) * 1.5; x < W + 12; x += 3) {
      const i = heads.length;
      R(Math.floor(x), y, 2, 2, crowdC[Math.floor(hash(i, 7) * (hash(i, 8) > 0.92 ? 8 : 6))]);
      heads.push([Math.floor(x), y]);
    }
  }
  R(-20, HOR - 6, W + 40, 6, C16.violetDeep);
  R(-20, HOR - 5, W + 40, 1, C16.cyan);
  // Far goalpost (field centre, back of the far end zone)
  const gp = proj(0, 120);
  const gs = gp.s;
  R(Math.round(gp.x), Math.round(gp.y - 3.3 * gs), 1, Math.round(3.3 * gs), C16.warn);
  R(Math.round(gp.x - 3.1 * gs), Math.round(gp.y - 3.3 * gs), Math.round(6.2 * gs) + 1, 1, C16.warn);
  R(Math.round(gp.x - 3.1 * gs), Math.round(gp.y - 10 * gs), 1, Math.round(6.7 * gs), C16.warn);
  R(Math.round(gp.x + 3.1 * gs), Math.round(gp.y - 10 * gs), 1, Math.round(6.7 * gs), C16.warn);
  // Ground, row by row in perspective
  for (let y = HOR; y < H + 10; y++) {
    const s = (y + 0.5 - HOR) / CAMH;
    const Z = F / s;
    const xs = Math.round(65 + (SIDE - CAMX) * s);
    const lw = Math.max(1, Math.round(0.15 * s));
    if (Z < GOAL) {
      const X0 = CAMX + (-20 - 65) / s;
      const X1 = CAMX + (xs - 65) / s;
      const P = 1.6;
      const i0 = Math.floor((X0 + Z) / P);
      const i1 = Math.floor((X1 + Z) / P);
      for (let i = i0; i <= i1; i++) {
        const a = Math.max(X0, i * P - Z);
        const b = Math.min(X1, (i + 1) * P - Z);
        const xa = Math.round(65 + (a - CAMX) * s);
        const xb = Math.round(65 + (b - CAMX) * s);
        if (xb > xa) R(xa, y, xb - xa, 1, i % 2 ? "#4a3391" : "#3b2a7a");
      }
    } else {
      R(-20, y, xs + 20, 1, Math.floor((Z - GOAL) / 5) % 2 ? "#3fae4a" : "#34983f");
    }
    R(xs, y, lw, 1, "#f4f2ff");
    R(xs + lw, y, 200, 1, "#23803f");
  }
  for (let Z = GOAL; Z <= 45; Z += 5) {
    const y0 = HOR + (CAMH * F) / (Z + 0.12);
    const y1 = HOR + (CAMH * F) / (Z - 0.12);
    const ya = Math.round(y0);
    const hgt = Math.max(Z === GOAL ? 2 : 1, Math.round(y1) - ya);
    R(-20, ya, Math.round(65 + (SIDE - CAMX) * (F / Z)) + 20, hgt, "#f4f2ff");
  }
  return { rects, heads };
}

let worldCache: World | null = null;
let worldCanvas: HTMLCanvasElement | null = null;
const WORLD_OX = -20;
const WORLD_OY = -20;
const WORLD_W = W + 40;
const WORLD_H = H + 40;

function getWorld(): { world: World; canvas: HTMLCanvasElement } {
  if (!worldCache || !worldCanvas) {
    worldCache = buildWorld();
    const canvas = document.createElement("canvas");
    canvas.width = WORLD_W;
    canvas.height = WORLD_H;
    const wctx = canvas.getContext("2d")!;
    for (const r of worldCache.rects) {
      wctx.globalAlpha = r.o ?? 1;
      wctx.fillStyle = r.c;
      wctx.fillRect(r.x - WORLD_OX, r.y - WORLD_OY, r.w, r.h);
    }
    wctx.globalAlpha = 1;
    worldCanvas = canvas;
  }
  return { world: worldCache, canvas: worldCanvas };
}

function fillRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, o = 1) {
  ctx.globalAlpha = o;
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  rects: RectSet,
  x: number,
  y: number,
  k = 1,
  rot = 0,
  sx = 1,
  sy = 1,
  ox = 0,
  oy = 0
) {
  const cx = (rects.w || 0) / 2;
  const cy = (rects.h || 0) / 2;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.translate(ox, oy);
  ctx.scale(sx, sy);
  ctx.translate(-ox, -oy);
  ctx.scale(k, k);
  if (rot) {
    ctx.translate(cx, cy);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  for (const r of rects) fillRect(ctx, r.x, r.y, r.w, 1, r.c);
  ctx.restore();
}

/** Draws each glyph by hand so letter-spacing matches the prototype's CSS value. */
function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  y: number,
  colorFor: (i: number) => string,
  letterSpacing: number
) {
  const widths = text.split("").map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + letterSpacing * (text.length - 1);
  let x = cx - total / 2;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  text.split("").forEach((ch, i) => {
    ctx.fillStyle = colorFor(i);
    ctx.fillText(ch, x, y);
    x += widths[i] + letterSpacing;
  });
  ctx.textAlign = prevAlign;
}

const WORDMARK = "PYLON FANTASY";

/**
 * Draws the intro at time T (seconds since the intro started) for the given
 * cut. Pure in T and cut — nothing here reads or mutates state from a prior
 * frame — matching pylon-intro-v2.jsx's Piece().
 */
export function drawFrame(ctx: CanvasRenderingContext2D, Traw: number, cut: Cut, fontReady: boolean) {
  const T = Math.floor(Traw * 24) / 24;
  const { world, canvas } = getWorld();
  const sp = SPRITES;

  const short = cut === "short";
  const D = short ? CUES_SHORT.Dive : CUES_FULL.Dive;
  const Hh = short ? CUES_SHORT.Hit : CUES_FULL.Hit;
  const L = short ? CUES_SHORT.Logo : CUES_FULL.Logo;
  const C = short ? D - 0.9 : CUES_FULL.Catch;
  const P = short ? C - 1.4 : CUES_FULL.Pass;
  const end = CUT_DURATION[cut];

  const pylonX = Math.round(PY.x - sp.pylon.w / 2);
  const pylonY = Math.round(PY.y - sp.pylon.h);
  const TIP = { x: pylonX + 3, y: pylonY + 1 };

  // ---- JSN
  const jZ = lerpKeys(T, [
    [0, 44],
    [P, 36],
    [C, 19],
    [D, 14.5],
  ]);
  const jX = 24.2;
  const jp = proj(jX, jZ);
  const jk = kOf(jZ);
  const layers: { z: number; draw: () => void }[] = [];
  let ball: (() => void) | null = null;
  let ballShadow: (() => void) | null = null;

  if (T < D) {
    const catching = T >= C - 0.12 && T < C + 0.3;
    const crouch = T >= D - 0.08;
    const frame = catching ? sp.catchFrame : crouch ? sp.runA : Math.floor(T * 8) % 2 ? sp.runB : sp.runA;
    const x = jp.x - (frame.w * jk) / 2;
    const y =
      jp.y - frame.h * jk + (crouch ? jk : 0) + (!catching && Math.floor(T * 8) % 2 ? -jk * 0.5 : 0);
    layers.push({ z: jZ, draw: () => drawSprite(ctx, frame, x, y, jk) });
    if (T >= P && T < C - 0.04) {
      const p = (T - P) / (C - P);
      const bZ = interpolate([0, 1], [62, jZ + 0.2])(p);
      const bX = interpolate([0, 1], [21, jX])(p);
      const bh = 2 + 11 * Math.sin(Math.PI * p);
      const bp = proj(bX, bZ, bh);
      const sh = proj(bX, bZ, 0);
      const bk = Math.max(1, Math.round(((bp.s * 0.45) / 5) * 2) / 2);
      ball = () => drawSprite(ctx, sp.ball, bp.x - 2.5 * bk, bp.y - 1.5 * bk, bk);
      ballShadow = () =>
        fillRect(ctx, Math.round(sh.x - bk * 2), Math.round(sh.y), Math.max(1, Math.round(bk * 4)), 1, "#1c5a28");
    } else if (T >= C - 0.04) {
      const bk = Math.max(0.5, jk * 0.7);
      const hx = catching ? x + 8.5 * jk : x + 13 * jk;
      const hy = catching ? y + 0.5 * jk : y + 11 * jk;
      ball = () => drawSprite(ctx, sp.ball, hx - 2.5 * bk, hy - 1.5 * bk, bk);
    }
  } else {
    const p = clamp((T - D) / (Hh - D), 0, 1);
    const start = { x: jp.x + 17 * 1.5, y: HOR + (CAMH - 1) * jp.s };
    const tx = MOTION.enter(start.x, TIP.x, D, Hh)(T);
    const ty = interpolate([0, 1], [start.y, TIP.y])(p) - Math.sin(Math.PI * p) * 10;
    const k = p < 0.5 ? 1.5 : 2;
    let x = tx - 35 * k;
    let y = ty - 5.5 * k;
    if (T >= Hh + 0.15) {
      const q = clamp((T - Hh - 0.15) / 0.45, 0, 1);
      x += q * 44;
      y = interpolate([0, 1], [y, PY.y - 4], Easing.easeInQuad)(q);
    }
    const fx = x;
    const fy = y;
    layers.push({ z: GOAL + 0.2, draw: () => drawSprite(ctx, sp.dive, fx, fy, k) });
  }

  // ---- Safety
  const sT0 = P + 0.2;
  if (T >= sT0) {
    const lungeAt = D + 0.35;
    const sZ = lerpKeys(T, [
      [sT0, 26],
      [D, 13.2],
      [lungeAt, 12.2],
    ]);
    const sX = lerpKeys(T, [
      [sT0, 16],
      [D, 22.4],
      [lungeAt, 23],
    ]);
    const s = proj(sX, sZ);
    const sk = kOf(sZ);
    if (T < lungeAt) {
      const frame = Math.floor(T * 8 + 1) % 2 ? sp.sB : sp.sA;
      const fx = s.x - (frame.w * sk) / 2;
      const fy = s.y - frame.h * sk;
      layers.push({ z: sZ, draw: () => drawSprite(ctx, frame, fx, fy, sk) });
    } else {
      const s0 = proj(23, 12.2);
      const hand = { x: TIP.x - 38, y: TIP.y - 1 };
      const p = clamp((T - lungeAt) / (Hh - lungeAt), 0, 1);
      let hx = interpolate([0, 1], [s0.x + 14, hand.x], Easing.easeInQuad)(p);
      let hy = interpolate([0, 1], [HOR + (CAMH - 1.2) * s0.s, hand.y])(p) - Math.sin(Math.PI * p) * 6;
      if (T >= Hh + 0.15) {
        const q = clamp((T - Hh - 0.15) / 0.25, 0, 1);
        hx += q * 10;
        hy = interpolate([0, 1], [hand.y, PY.y - 2], Easing.easeInQuad)(q);
      }
      const fx = hx;
      const fy = hy;
      layers.push({ z: GOAL + 0.6, draw: () => drawSprite(ctx, sp.lunge, fx - 30 * 2, fy - 4.5 * 2, 2) });
    }
  }
  layers.push({ z: GOAL, draw: () => drawSprite(ctx, sp.pylon, pylonX, pylonY) });
  layers.sort((a, b) => b.z - a.z);

  // ---- FX
  const fk = Math.floor(T * 12);
  const flashN = T >= Hh ? 22 : T >= C ? 8 : 4;
  const flashPts: [number, number][] = [];
  for (let i = 0; i < flashN; i++) {
    const head = world.heads[Math.floor(hash(i, fk) * world.heads.length)];
    if (head) flashPts.push(head);
  }
  const lights = MOTION.steps(T, [
    [0, 0],
    [0.05, 1],
    [0.1, 0],
    [0.16, 1],
  ]);
  const sparkP = (T - Hh) / 0.45;
  const sparks: { x: number; y: number; sz: number; i: number }[] = [];
  if (sparkP >= 0 && sparkP < 1) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.3;
      const d = 3 + sparkP * 22;
      const sz = sparkP < 0.5 ? 2 : 1;
      sparks.push({ x: Math.round(TIP.x + Math.cos(a) * d), y: Math.round(TIP.y + Math.sin(a) * d * 0.8), sz, i });
    }
  }
  const hitStarShow = T >= Hh && T < Hh + 0.3;
  const shK = T >= Hh + 0.15 && T < Hh + 0.55 ? 1 - (T - Hh - 0.15) / 0.4 : 0;
  const shX = Math.round((hash(fk, 3) - 0.5) * 6 * shK);
  const shY = Math.round((hash(fk, 5) - 0.5) * 4 * shK);
  const pan = Math.round(
    lerpKeys(T, [
      [0, 4],
      [Hh, -3],
    ])
  );
  const zoom = T >= Hh && T < Hh + 0.22 ? 1.5 : 1;
  const zc = { x: TIP.x - 20, y: TIP.y };
  const flash = MOTION.steps(T, [
    [0, 0],
    [Hh, 1],
    [Hh + 0.05, 0.6],
    [Hh + 0.1, 0.25],
    [Hh + 0.15, 0],
  ]);
  const tdScale = MOTION.steps(T, [
    [0, 0],
    [Hh + 0.22, 0.5],
    [Hh + 0.26, 1.3],
    [Hh + 0.3, 0.92],
    [Hh + 0.34, 1],
  ]);
  const tdLift = Math.round(MOTION.enter(0, -14, L - 0.1, L + 0.12)(T));
  const dim = MOTION.steps(T, [
    [0, 0],
    [L - 0.06, 0.33],
    [L, 0.66],
    [L + 0.06, 1],
  ]);
  const dropY = Math.round(MOTION.fall(-150, 0, L + 0.06, L + 0.3)(T));
  const squash = MOTION.steps(T, [
    [0, [1, 1]],
    [L + 0.3, [1.22, 0.78]],
    [L + 0.36, [0.9, 1.1]],
    [L + 0.42, [1, 1]],
  ]) as [number, number];
  const typed = clamp(Math.floor((T - (L + 0.44)) / 0.03), 0, WORDMARK.length);
  const dotsOn = T >= L + 0.9;
  const dotI = Math.floor((T - L) * 8) % 3;
  const handoff = MOTION.steps(T, [
    [0, 0],
    [end - 0.15, 0.33],
    [end - 0.1, 0.66],
    [end - 0.05, 1],
  ]);
  const logoW = sp.logo.w;
  const full = { x: -20, y: -20, w: W + 40, h: H + 40 };
  const headingFont = fontReady ? "'Pixelify Sans', monospace" : "monospace";

  // ---- paint
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(zc.x, zc.y);
  ctx.scale(zoom, zoom);
  ctx.translate(-zc.x, -zc.y);
  ctx.translate(pan + shX, shY);

  ctx.drawImage(canvas, WORLD_OX, WORLD_OY);
  if (!lights) fillRect(ctx, -20, -20, W + 40, HOR - 20, C16.well, 0.85);
  for (const [hx, hy] of flashPts) fillRect(ctx, hx, hy, 2, 2, "#ffffff");
  ballShadow?.();
  for (const l of layers) l.draw();
  ball?.();
  if (hitStarShow) {
    const cx = TIP.x - 38;
    const cy = TIP.y - 2;
    const r = MOTION.steps(T, [
      [Hh, 5],
      [Hh + 0.08, 8],
      [Hh + 0.18, 6],
    ]);
    fillRect(ctx, cx - 1, cy - 2 * r, 2, r, C16.warn);
    fillRect(ctx, cx - 1, cy + r, 2, r, C16.warn);
    fillRect(ctx, cx - 2 * r, cy - 1, r, 2, C16.warn);
    fillRect(ctx, cx + r, cy - 1, r, 2, C16.warn);
    fillRect(ctx, cx - 2, cy - 2, 4, 4, C16.text);
  }
  for (const s of sparks) fillRect(ctx, s.x, s.y, s.sz, s.sz, s.i % 2 ? C16.warn : C16.text);
  ctx.restore();

  // ---- overlays (unaffected by camera pan/zoom/shake)
  fillRect(ctx, full.x, full.y, full.w, full.h, "#ffffff", flash);

  if (T < L + 0.12 && tdScale > 0) {
    ctx.save();
    ctx.globalAlpha = dim >= 1 ? 0 : 1;
    ctx.translate(65, 40 + tdLift);
    ctx.scale(tdScale, tdScale);
    ctx.textAlign = "center";
    ctx.font = `700 19px ${headingFont}`;
    ctx.fillStyle = C16.violetDeep;
    ctx.fillText("TOUCHDOWN!", 1.5, 1.5);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = C16.well;
    ctx.strokeText("TOUCHDOWN!", 0, 0);
    ctx.fillStyle = C16.warn;
    ctx.fillText("TOUCHDOWN!", 0, 0);
    ctx.restore();
  }

  fillRect(ctx, full.x, full.y, full.w, full.h, C16.bg, dim);

  if (T >= L) {
    ctx.save();
    ctx.translate(Math.round(65 - logoW / 2), 100 + dropY);
    drawSprite(ctx, sp.logo, 0, 0, 1, 0, squash[0], squash[1], logoW / 2, sp.logo.h);
    ctx.restore();

    ctx.font = `600 10.5px ${headingFont}`;
    const visible = WORDMARK.slice(0, typed);
    drawTrackedText(ctx, visible, 65, 170, (i) => (i < 5 ? C16.text : C16.cyan), 1.6);

    if (dotsOn) {
      for (let i = 0; i < 3; i++) fillRect(ctx, 59 + i * 5, 182, 3, 3, i === dotI ? C16.cyan : C16.off);
    }
  }

  fillRect(ctx, full.x, full.y, full.w, full.h, C16.appBg, handoff);
}
