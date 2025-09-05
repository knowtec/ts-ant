// app/lib/db.ts
import Database from "better-sqlite3";
import fs from "fs";

let _db: Database.Database | null = null;

export function openSqlite() {
  if (_db) return _db;
  const dbPath = process.env.ANT_DB_PATH;
  if (!dbPath) throw new Error("ANT_DB_PATH ni nastavljen (.env.local)");
  if (!fs.existsSync(dbPath)) throw new Error(`ant.db ne obstaja: ${dbPath}`);
  _db = new Database(dbPath, { fileMustExist: true });
  return _db;
}

export function todayLj() {
  // yyyy-mm-dd po Europe/Ljubljana
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Ljubljana" }));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function requirePIN(url: URL) {
  const given = url.searchParams.get("pin") || "";
  const expected = process.env.ADMIN_PIN || "";
  if (!expected || given !== expected) {
    const e: any = new Error("Unauthorized");
    e.status = 401;
    throw e;
  }
}
