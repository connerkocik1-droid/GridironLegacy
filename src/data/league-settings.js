// League settings, owned by the commissioner and read by every other screen.
// Scalar settings live in localStorage; the intro video is a Blob, which is too
// large for that, so it goes to IndexedDB.

const KEY = "gl.league";
const DB = "gl-media";
const STORE = "files";

// Two divisions of six. A league that has more stored from an earlier version is
// folded back down on read — editing the default alone would never reach anyone
// who has already saved settings.
export const MAX_DIVISIONS = 2;

export const DEFAULTS = {
  divisions: [
    { name: "Iron", teams: ["STL", "BLZ", "RVN", "APEX", "NOVA", "HELX"] },
    { name: "Vapor", teams: ["VOLT", "ONYX", "ORBT", "FLUX", "ZEN", "TITN"] }
  ],
  commissionerSlot: "HELX", // the slot that holds the league office
  ready: {},                // slot -> true, once a manager says they are set
  draftAt: "",              // ISO local datetime, e.g. 2026-09-01T20:00
  rounds: 18,
  pickSeconds: 90,
  cinematicRounds: 3,
  lottery: true,
  lotteryOrder: null,       // set once the lottery has been drawn
  scoring: "half",          // half | ppr | standard
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 8,
  ir: 2,
  regularWeeks: 13,
  playoffWeeks: 4,          // weeks 14-17; week 18 is not played
  tradePicksWeek: 8,
  introName: ""
};

export function readSettings() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  const out = Object.assign({}, DEFAULTS, saved || {});
  out.starters = Object.assign({}, DEFAULTS.starters, (saved && saved.starters) || {});
  if (!Array.isArray(out.divisions) || !out.divisions.length) out.divisions = DEFAULTS.divisions;
  out.divisions = foldDivisions(out.divisions);
  return out;
}

// Anything past MAX_DIVISIONS has its teams moved into the surviving ones,
// dealt round-robin so the result stays even. No team is ever dropped.
export function foldDivisions(divisions) {
  if (!Array.isArray(divisions) || divisions.length <= MAX_DIVISIONS) return divisions;
  const keep = divisions.slice(0, MAX_DIVISIONS).map(d => ({ name: d.name, teams: (d.teams || []).slice() }));
  const orphans = divisions.slice(MAX_DIVISIONS).reduce((all, d) => all.concat(d.teams || []), []);
  orphans.forEach((t, i) => {
    // into whichever kept division is currently smallest
    const target = keep.reduce((a, b) => (b.teams.length < a.teams.length ? b : a));
    if (target.teams.indexOf(t) === -1) target.teams.push(t);
  });
  return keep;
}

// Removing a division moves its teams into the one that stays, rather than
// stranding them outside every division.
export function removeDivision(settings, index) {
  const divisions = settings.divisions || [];
  if (divisions.length <= 1) return settings;
  const gone = divisions[index];
  const keep = divisions.filter((d, i) => i !== index).map(d => ({ name: d.name, teams: (d.teams || []).slice() }));
  (gone.teams || []).forEach(t => {
    const target = keep.reduce((a, b) => (b.teams.length < a.teams.length ? b : a));
    if (target.teams.indexOf(t) === -1) target.teams.push(t);
  });
  return writeSettings(Object.assign({}, settings, { divisions: keep }));
}

export function writeSettings(next) {
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { console.warn("[league] could not save", e); }
  return next;
}

// How many roster spots the starters and bench add up to. The draft is only
// coherent when its round count matches.
export function rosterSize(s) {
  const starters = Object.keys(s.starters).reduce((n, k) => n + s.starters[k], 0);
  return starters + s.bench;
}

export function startingSlots(s) {
  const out = [];
  ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"].forEach(pos => {
    for (let i = 0; i < (s.starters[pos] || 0); i++) out.push(pos);
  });
  return out;
}

// The gap to draft day, broken out. Returns null when nothing is scheduled.
export function countdownTo(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (isNaN(then)) return null;
  let ms = then - Date.now();
  const past = ms <= 0;
  ms = Math.abs(ms);
  const sec = Math.floor(ms / 1000);
  return {
    past: past,
    days: Math.floor(sec / 86400),
    hours: Math.floor((sec % 86400) / 3600),
    minutes: Math.floor((sec % 3600) / 60),
    seconds: sec % 60
  };
}

// What a week is: regular season through 13, playoffs 14-17, nothing after.
export function weekPhase(week, s) {
  const reg = (s && s.regularWeeks) || 13;
  const last = reg + ((s && s.playoffWeeks) || 4);
  if (week <= reg) return "regular";
  if (week <= last) return "playoffs";
  return "over";
}
export function lastWeek(s) {
  return ((s && s.regularWeeks) || 13) + ((s && s.playoffWeeks) || 4);
}

export function draftLabel(s) {
  if (!s.draftAt) return "Not scheduled";
  const d = new Date(s.draftAt);
  if (isNaN(d)) return "Not scheduled";
  return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── the intro video ────────────────────────────────────────────────────────
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function saveIntro(file) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(file, "intro");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

export function loadIntro() {
  return open().then(db => new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("intro");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  })).catch(() => null);
}

export function clearIntro() {
  return open().then(db => new Promise(resolve => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete("intro");
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  })).catch(() => false);
}

// The lottery: a shuffled order, drawn once and then fixed, so every screen
// agrees on who picks where. Seeded from the draw time so a redraw is a
// deliberate act rather than a page refresh.
export function drawLottery(teams) {
  const pool = teams.slice();
  const order = [];
  while (pool.length) order.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return order;
}

// ── the trade block ────────────────────────────────────────────────────────
// Players their managers have said they will listen on. One flat list for the
// whole league, keyed by player name, so every screen reads the same block.
const BLOCK = "gl.block";

export function readBlock() {
  try { return JSON.parse(localStorage.getItem(BLOCK)) || {}; } catch (e) { return {}; }
}

export function onBlock(name) { return !!readBlock()[name]; }

export function toggleBlock(name, team) {
  const b = readBlock();
  if (b[name]) delete b[name];
  else b[name] = { team: team, at: new Date().toISOString() };
  try { localStorage.setItem(BLOCK, JSON.stringify(b)); } catch (e) {}
  return b;
}

// ── league administration ──────────────────────────────────────────────────
// The two destructive powers, kept apart from ordinary settings. Both take a
// snapshot first, because a commissioner presses these by accident.
const SNAPSHOTS = "gl.snapshots";
const ACCOUNTS = "gl.accounts";

export function readSnapshots() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOTS)) || []; } catch (e) { return []; }
}

function snapshot(kind, payload) {
  const all = [{ kind, payload, at: new Date().toISOString() }].concat(readSnapshots()).slice(0, 5);
  try { localStorage.setItem(SNAPSHOTS, JSON.stringify(all)); } catch (e) {}
  return all;
}

// Clearing rosters also clears the draft and the lottery: a roster reset that
// left the drawn order standing would put teams back on a board they had
// already drafted from.
export function resetRosters() {
  const before = {
    league: readSettings(),
    block: readBlock(),
    trades: (() => { try { return JSON.parse(localStorage.getItem("gl.trades")) || []; } catch (e) { return []; } })()
  };
  const snaps = snapshot("rosters", before);
  const next = Object.assign({}, before.league, { lotteryOrder: null, ready: {} });
  writeSettings(next);
  try {
    localStorage.removeItem("gl.trades");
    localStorage.removeItem(BLOCK);
  } catch (e) {}
  return { settings: next, snapshots: snaps };
}

export function restoreSnapshot(index) {
  const snaps = readSnapshots();
  const s = snaps[index || 0];
  if (!s || s.kind !== "rosters") return null;
  writeSettings(s.payload.league);
  try {
    localStorage.setItem("gl.trades", JSON.stringify(s.payload.trades || []));
    localStorage.setItem(BLOCK, JSON.stringify(s.payload.block || {}));
  } catch (e) {}
  return s.payload.league;
}

export function readAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS)) || {}; } catch (e) { return {}; }
}

// The commissioner clears a PIN; they never see or set one. If they could set
// another manager's PIN they could sign in as any team in the league. A null
// hash sends that manager through PIN creation on their next sign-in.
export function clearPin(slot) {
  const accounts = readAccounts();
  if (!accounts[slot]) return accounts;
  snapshot("pin", { slot: slot });
  accounts[slot] = Object.assign({}, accounts[slot], { pin: null, mustSetPin: true });
  try { localStorage.setItem(ACCOUNTS, JSON.stringify(accounts)); } catch (e) {}
  return accounts;
}
