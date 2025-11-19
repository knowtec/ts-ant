import { NextRequest, NextResponse } from "next/server";

// nujno: ker better-sqlite3 ne deluje na edge runtimu
export const runtime = "nodejs";

function todayStrLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

async function tryBridge() {
  const base = process.env.BRIDGE_BASE || "http://127.0.0.1:8080";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 800); // kratek timeout
    const r = await fetch(`${base}/api/stats`, { signal: ac.signal });
    clearTimeout(t);
    if (r.ok) return await r.json();
  } catch {}
  return null;
}

function readFromSQLite() {
  const Database = require("better-sqlite3") as typeof import("better-sqlite3");
  const dbPath = process.env.ANT_DB_PATH;
  const EURO_PER_WH = Number(process.env.EURO_PER_WH || 1);

  if (!dbPath) {
    return {
      date: todayStrLocal(),
      euro_per_wh: EURO_PER_WH,
      today_wh: 0,
      today_eur: 0,
      all_wh: 0,
      all_eur: 0,
      source: "fallback:no-dbpath",
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    const date = todayStrLocal();
    const t = db
      .prepare(
        "SELECT COALESCE(SUM(total_wh),0) AS wh FROM sessions WHERE date=? AND end_ts IS NOT NULL"
      )
      .get(date);
    const a = db
      .prepare(
        "SELECT COALESCE(SUM(total_wh),0) AS wh FROM sessions WHERE end_ts IS NOT NULL"
      )
      .get();

    const today_wh = Number((t?.wh || 0).toFixed ? t.wh : Number(t?.wh || 0));
    const all_wh = Number((a?.wh || 0).toFixed ? a.wh : Number(a?.wh || 0));

    return {
      date,
      euro_per_wh: EURO_PER_WH,
      today_wh,
      today_eur: Number((today_wh * EURO_PER_WH).toFixed(1)),
      all_wh,
      all_eur: Number((all_wh * EURO_PER_WH).toFixed(1)),
      source: "sqlite",
    };
  } catch (e) {
    return {
      date: todayStrLocal(),
      euro_per_wh: EURO_PER_WH,
      today_wh: 0,
      today_eur: 0,
      all_wh: 0,
      all_eur: 0,
      source: "fallback:error",
      error: String(e),
    };
  }
}

export async function GET(_req: NextRequest) {
  // 1) poskusi preko bridge-a
  const bridged = await tryBridge();
  if (bridged) return NextResponse.json(bridged);

  // 2) fallback: preberi SQLite neposredno
  const stats = readFromSQLite();
  return NextResponse.json(stats);
}
