// ant-bridge.cjs — ANT+ bridge z WebSocket + Express + SQLite + AUTOSTART (60s) + migracija sheme
// Zahteve: npm i express cors ws better-sqlite3 incyclist-ant-plus
// Driver: Windows (Zadig) -> ANT USB Stick 2 -> WinUSB

const path = require("path");
const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");
const { WebSocketServer } = require("ws");
const { AntDevice } = require("incyclist-ant-plus/lib/bindings");
const {
  BicyclePowerSensor,
  FitnessEquipmentSensor,
} = require("incyclist-ant-plus");

const HTTP_PORT = Number(process.env.HTTP_PORT || 8080);
const WS_PORT = Number(process.env.WS_PORT || 9876);
const DONATION_FACTOR = 1;
const DB_PATH = path.join(__dirname, "ant.db");

// --- AUTOSTART nastavitve (server-side) ---
const AUTO_THRESHOLD_W = Number(process.env.AUTO_THRESHOLD_W || 200); // prag moči za start
const AUTO_DEBOUNCE_MS = Number(process.env.AUTO_DEBOUNCE_MS || 35000); // min. razmik med poskusi

let autoLock = false; // če je true, server ne autostarta

// ---------- Pomožne funkcije časa ----------
function nowMs() {
  return Date.now();
}
function todayStr() {
  const d = new Date(),
    y = d.getFullYear(),
    m = String(d.getMonth() + 1).padStart(2, "0"),
    dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function toFixed1(n) {
  return Math.round(n * 10) / 10;
}

// ---------- DB init + MIGRACIJA (dodaj 'U' v CHECK constraint) ----------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

function ensureSchema() {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'"
    )
    .get();
  if (!row) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('M','F','U')),
        date TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER,
        peak_w REAL DEFAULT 0,
        best_wh60 REAL DEFAULT 0,
        total_wh REAL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
      CREATE INDEX IF NOT EXISTS idx_sessions_gender ON sessions(gender);
    `);
    return;
  }
  const ddl = row.sql || "";
  if (!ddl.includes("CHECK (gender IN ('M','F','U'))")) {
    // migriraj obstoječo tabelo na vključitev 'U'
    db.exec(`
      BEGIN;
      CREATE TABLE sessions_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        gender TEXT NOT NULL CHECK (gender IN ('M','F','U')),
        date TEXT NOT NULL,
        start_ts INTEGER NOT NULL,
        end_ts INTEGER,
        peak_w REAL DEFAULT 0,
        best_wh60 REAL DEFAULT 0,
        total_wh REAL DEFAULT 0
      );
      INSERT INTO sessions_new (id,name,gender,date,start_ts,end_ts,peak_w,best_wh60,total_wh)
        SELECT id,name, CASE WHEN gender IN ('M','F') THEN gender ELSE 'U' END,
               date,start_ts,end_ts,peak_w,best_wh60,total_wh
        FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_new RENAME TO sessions;
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
      CREATE INDEX IF NOT EXISTS idx_sessions_gender ON sessions(gender);
      COMMIT;
    `);
  }
}
ensureSchema();

// ---------- Model: SessionRecorder ----------
class SessionRecorder {
  constructor(id, name, gender) {
    this.id = id;
    this.name = name;
    this.gender = gender;
    this.startTs = nowMs();
    this.lastTs = null;
    this.lastPower = 0;
    this.peakW = 0;
    this.totalWh = 0;
    this.window = [];
    this.windowWh = 0;
    this.bestWh60 = 0;
    this.windowSecs = 60000; // 60 s drsno okno
  }
  onPowerSample(ts, power) {
    if (!(power >= 0) || !(ts > 0)) return;
    if (this.lastTs !== null && ts > this.lastTs) {
      const dt = ts - this.lastTs;
      const wh = (this.lastPower * dt) / 3600000; // W * s -> Wh
      this.window.push({
        start: this.lastTs,
        end: ts,
        power: this.lastPower,
        wh,
      });
      this.windowWh += wh;
      this.totalWh += wh;

      // odstrani stare intervale izven 60 s
      const cutoff = ts - this.windowSecs;
      while (this.window.length && this.window[0].end <= cutoff) {
        this.windowWh -= this.window[0].wh;
        this.window.shift();
      }
      // prilagodi prvi interval, če seka cutoff
      if (this.window.length) {
        const h = this.window[0];
        if (h.start < cutoff && h.end > cutoff) {
          const overlap = h.end - cutoff;
          const keepWh = (h.power * overlap) / 3600000;
          this.windowWh -= h.wh;
          h.start = cutoff;
          h.wh = keepWh;
          this.windowWh += h.wh;
        }
      }
      if (this.windowWh > this.bestWh60) this.bestWh60 = this.windowWh;
    }
    if (power > this.peakW) this.peakW = power;
    this.lastTs = ts;
    this.lastPower = power;
  }
  snapshot() {
    return {
      id: this.id,
      name: this.name,
      gender: this.gender,
      start_ts: this.startTs,
      peak_w: toFixed1(this.peakW),
      best_wh60: toFixed1(this.bestWh60),
      total_wh: toFixed1(this.totalWh),
    };
  }
}

// ---------- WebSocket (UI naročniki) ----------
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
  ws.send(
    JSON.stringify({ type: "hello", port: WS_PORT, lib: "incyclist-ant-plus" })
  );
});
function wsSend(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
}

// ---------- Globalno stanje seje + auto-end timer ----------
let current = null; // aktivna seja
let lastAutoTryTs = 0; // zadnji poskus autostarta (ms)
let autoEndTimer = null; // NodeJS.Timeout
let autoEndForId = null; // id seje, za katero teče timer
let autoEndAt = 0; // timestamp (ms), kdaj bo auto-stop

function clearAutoEnd() {
  if (autoEndTimer) {
    clearTimeout(autoEndTimer);
    autoEndTimer = null;
  }
  autoEndForId = null;
  autoEndAt = 0;
}
function remainingMs() {
  return Math.max(0, autoEndAt - nowMs());
}
function endCurrentSession(reason = "manual") {
  if (!current) return null;
  const s = current.snapshot();
  db.prepare(
    "UPDATE sessions SET end_ts=?, peak_w=?, best_wh60=?, total_wh=? WHERE id=?"
  ).run(nowMs(), s.peak_w, s.best_wh60, s.total_wh, current.id);
  const ended = { id: current.id, ...s, end_ts: nowMs(), reason };
  current = null;
  wsSend({ type: "session_end", ended });
  clearAutoEnd();
  return ended;
}
function scheduleAutoEnd(ms = 60000) {
  clearAutoEnd();
  if (!current) return;
  autoEndForId = current.id;
  autoEndAt = nowMs() + ms;
  autoEndTimer = setTimeout(() => {
    if (current && current.id === autoEndForId) {
      endCurrentSession("auto60s");
    }
  }, ms);
}

function buildSessionFromCurrent() {
  const s = current.snapshot();
  return {
    id: s.id,
    name: s.name,
    gender: s.gender,
    start_ts: s.start_ts,
    date: todayStr(),
    auto_ms: remainingMs(),
  };
}

function doAutostart() {
  // če je zaklenjeno (modal odprt ipd.), ne štartamo
  if (autoLock) {
    return { session: null, alreadyRunning: !!current, blocked: true };
  }

  // če že teče seja, bodi idempotenten (samo re-emit)
  if (current) {
    const session = buildSessionFromCurrent();
    wsSend({ type: "session_start", session });
    return { session, alreadyRunning: true };
  }

  // sicer ustvari novo anonimno sejo (gender 'U') in nastavi 60 s timer
  const date = todayStr();
  const start_ts = nowMs();
  const info = db
    .prepare(
      "INSERT INTO sessions (name, gender, date, start_ts) VALUES (?,?,?,?)"
    )
    .run("", "U", date, start_ts);

  current = new SessionRecorder(info.lastInsertRowid, "", "U");
  scheduleAutoEnd(60000);

  const session = buildSessionFromCurrent();
  wsSend({ type: "session_start", session });
  return { session, alreadyRunning: false };
}

// ---------- ANT+ naprava (incyclist-ant-plus) ----------
function pickNum(o, keys) {
  for (const k of keys) {
    const v = o?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}
function extractPower(d) {
  return pickNum(d, [
    "instantaneousPower",
    "InstantaneousPower",
    "Power",
    "CalculatedPower",
  ]);
}
function extractCadence(d) {
  return pickNum(d, ["cadence", "Cadence", "CalculatedCadence"]);
}
function extractSpeedKph(d) {
  const v = pickNum(d, ["RealSpeed", "speed", "Speed"]);
  return v == null ? null : v * 3.6;
}

(async () => {
  console.log("Opening ANT stick… (WinUSB via Zadig; close other apps)");
  const ant = new AntDevice({
    startupTimeout: 6000,
    detailedStartReport: true,
  });
  const opened = await ant.open();
  if (!opened || opened === "StartupError" || opened === "NoStick") {
    console.error("Failed to open ANT stick:", opened);
    process.exit(1);
  }
  console.log("ANT stick opened. Max channels:", ant.getMaxChannels());
  console.log(`WebSocket on ws://127.0.0.1:${WS_PORT}`);

  // scan za FE in PWR
  const scan = ant.getChannel();
  const seen = { fe: null, pwr: null };
  scan.on("detect", (profile, id) => {
    if (profile === "FE" && !seen.fe) seen.fe = id;
    if (profile === "PWR" && !seen.pwr) seen.pwr = id;
  });
  scan.attach(new FitnessEquipmentSensor());
  scan.attach(new BicyclePowerSensor());
  try {
    await scan.startScanner({ timeout: 8000 });
  } catch {}
  try {
    scan.stopScanner();
  } catch {}
  console.log("Detected devices:", seen);

  // FE-C kanal
  try {
    const chFE = ant.getChannel();
    const fe = new FitnessEquipmentSensor();
    chFE.on("data", (profile, id, data) => {
      if (profile !== "FE") return;
      const ts = nowMs();
      const power = extractPower(data);
      const cadence = extractCadence(data);
      const speedKph = extractSpeedKph(data);
      wsSend({ type: "fe", id, t: ts, power, cadence, speedKph });
      // AUTOSTART NA STREŽNIKU
      if (
        !autoLock &&
        !current &&
        typeof power === "number" &&
        power >= AUTO_THRESHOLD_W
      ) {
        const now = ts;
        if (now - lastAutoTryTs > AUTO_DEBOUNCE_MS) {
          lastAutoTryTs = now;
          doAutostart();
        }
      }
      if (current && typeof power === "number")
        current.onPowerSample(ts, power);
    });
    if (seen.fe) fe.setDeviceID(seen.fe);
    await chFE.startSensor(fe);
    console.log("FE-C channel started");
  } catch (e) {
    console.warn("FE-C start failed:", e?.message || e);
  }

  // PWR kanal
  try {
    const chPWR = ant.getChannel();
    const pwr = new BicyclePowerSensor();
    chPWR.on("data", (profile, id, data) => {
      if (profile !== "PWR") return;
      const ts = nowMs();
      const power = extractPower(data);
      const cadence = extractCadence(data);
      wsSend({ type: "power", id, t: ts, power, cadence });

      // AUTOSTART NA STREŽNIKU
      if (
        !autoLock &&
        !current &&
        typeof power === "number" &&
        power >= AUTO_THRESHOLD_W
      ) {
        const now = ts;
        if (now - lastAutoTryTs > AUTO_DEBOUNCE_MS) {
          lastAutoTryTs = now;
          doAutostart();
        }
      }

      if (current && typeof power === "number")
        current.onPowerSample(ts, power);
    });
    if (seen.pwr) pwr.setDeviceID(seen.pwr);
    await chPWR.startSensor(pwr);
    console.log("Power channel started");
  } catch (e) {
    console.warn("Power start failed:", e?.message || e);
  }
})().catch((e) => {
  console.error("Fatal ANT:", e);
  process.exit(1);
});

// ---------- HTTP API (Express) ----------
const app = express();
app.use(cors());
app.use(express.json());

// AUTOSTART (anonimno, gender='U') + server-side auto-stop po 60 s
app.post("/api/session/autostart", (req, res) => {
  const r = doAutostart();
  if (r?.blocked)
    return res.json({
      ok: false,
      blocked: true,
      alreadyRunning: r.alreadyRunning,
    });
  return res.json({
    ok: true,
    session: r.session,
    alreadyRunning: !!r.alreadyRunning,
  });
});

app.post("/api/autostart/lock", (req, res) => {
  const lock = !!req.body?.lock;
  autoLock = lock;
  if (lock) endCurrentSession("locked_by_ui"); // varno: zaključi, če teče
  res.json({ ok: true, locked: autoLock });
});
app.get("/api/autostart/status", (req, res) => res.json({ locked: autoLock }));

// ROČNI START (brez auto-timerja)
app.post("/api/session/start", (req, res) => {
  const { name, gender } = req.body || {};
  const g = (gender || "").toUpperCase();
  if (!name || !["M", "F"].includes(g))
    return res.status(400).json({ error: "name and gender (M/F) required" });

  endCurrentSession("pre_manual_start"); // NE pustimo dveh sej
  const date = todayStr(),
    start_ts = nowMs();
  const info = db
    .prepare(
      "INSERT INTO sessions (name, gender, date, start_ts) VALUES (?,?,?,?)"
    )
    .run(name, g, date, start_ts);
  current = new SessionRecorder(info.lastInsertRowid, name, g);
  clearAutoEnd(); // brez auto-stop za ročne seje
  res.json({
    ok: true,
    session: { id: current.id, name, gender: g, start_ts, date },
  });
});

app.post("/api/session/end", (req, res) => {
  const ended = endCurrentSession("api");
  res.json({ ok: true, ended });
});

// RENAME po autostartu (po 60 s, ko UI pokaže modal)
app.post("/api/session/rename", (req, res) => {
  const { id, name, gender } = req.body || {};
  const g = (gender || "").toUpperCase();
  if (!id || !name || !["M", "F"].includes(g))
    return res.status(400).json({ error: "id, name, gender M/F required" });
  const r = db
    .prepare("UPDATE sessions SET name=?, gender=? WHERE id=?")
    .run(name, g, id);
  res.json({ ok: r.changes > 0 });
});

// TRENUTNA (če teče)
app.get("/api/session/current", (req, res) => {
  res.json({ session: current ? current.snapshot() : null });
});

// Dnevne lestvice (M/F × Wh60/PeakW)
app.get("/api/leaderboard/today", (req, res) => {
  const date = todayStr();
  const rows = db
    .prepare(
      "SELECT id,name,gender,peak_w,best_wh60,total_wh FROM sessions WHERE date=? AND end_ts IS NOT NULL"
    )
    .all(date);
  const men = rows.filter((r) => r.gender === "M");
  const women = rows.filter((r) => r.gender === "F");

  const sortBy = (arr, key) =>
    arr.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0));
  const top = (arr, key, n = 5) => sortBy(arr, key).slice(0, n); // <-- top 5 privzeto

  res.json({
    date,
    menWh60: top(men, "best_wh60"),
    menPeakW: top(men, "peak_w"),
    womenWh60: top(women, "best_wh60"),
    womenPeakW: top(women, "peak_w"),
  });
});

// Statistika (€ iz Wh)
// app.get("/api/stats", (req, res) => {
//   const date = todayStr();
//   const t = db
//     .prepare(
//       "SELECT COALESCE(SUM(total_wh),0) wh FROM sessions WHERE date=? AND end_ts IS NOT NULL"
//     )
//     .get(date);
//   const a = db
//     .prepare(
//       "SELECT COALESCE(SUM(total_wh),0) wh FROM sessions WHERE end_ts IS NOT NULL"
//     )
//     .get();
//   const today_wh = toFixed1(t.wh || 0),
//     all_wh = toFixed1(a.wh || 0);
//   res.json({
//     date,
//     euro_per_wh: EURO_PER_WH,
//     today_wh,
//     today_eur: toFixed1(today_wh * EURO_PER_WH),
//     all_wh,
//     all_eur: toFixed1(all_wh * EURO_PER_WH),
//   });
// });
app.get("/api/stats", (req, res) => {
  const date = todayStr();
  const t = db
    .prepare(
      "SELECT COALESCE(SUM(total_wh),0) wh FROM sessions WHERE date=? AND end_ts IS NOT NULL"
    )
    .get(date);
  const a = db
    .prepare(
      "SELECT COALESCE(SUM(total_wh),0) wh FROM sessions WHERE end_ts IS NOT NULL"
    )
    .get();

  const today_wh = toFixed1(t.wh || 0);
  const all_wh = toFixed1(a.wh || 0);

  res.json({
    date,
    euro_per_wh: DONATION_FACTOR,
    today_wh,
    today_eur: toFixed1(today_wh * DONATION_FACTOR),
    all_wh,
    all_eur: toFixed1(all_wh * DONATION_FACTOR),
  });
});

// CSV izvoz za danes
app.get("/api/export/today.csv", (req, res) => {
  const date = todayStr();
  const rows = db
    .prepare(
      "SELECT id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts FROM sessions WHERE date=? AND end_ts IS NOT NULL"
    )
    .all(date);
  const lines = [
    "id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts",
  ].concat(
    rows.map((r) =>
      [
        r.id,
        JSON.stringify(r.name),
        r.gender,
        r.peak_w,
        r.best_wh60,
        r.total_wh,
        r.start_ts,
        r.end_ts,
      ].join(",")
    )
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="sessions-${date}.csv"`
  );
  res.send(lines.join("\n"));
});

app.listen(HTTP_PORT, () => {
  console.log(`HTTP API on http://127.0.0.1:${HTTP_PORT}`);
});
