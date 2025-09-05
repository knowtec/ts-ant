export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'node:path';
import fs from 'node:fs';
import { openSqlite } from '../../../../lib/db';
import { requireAdminPIN } from '../../../../lib/admin';

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function stamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return { date: `${y}-${m}-${day}`, ts: `${y}-${m}-${day}_${hh}${mm}` };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    requireAdminPIN(req.headers, body);

    const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), '.backups');
    ensureDir(BACKUP_DIR);

    const db = openSqlite();
    const { date, ts } = stamp();

    // 1) .sqlite varna kopija (SQLite Online Backup API)
    const sqliteOut = path.join(BACKUP_DIR, `ant_${ts}.sqlite`);
    // better-sqlite3 >=7 ima async backup API:
    // @ts-ignore
    await db.backup(sqliteOut);

    // 2) CSV za današnji dan
    const rows = db.prepare(`
      SELECT id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts
      FROM sessions
      WHERE date=? AND end_ts IS NOT NULL
      ORDER BY start_ts ASC
    `).all(date);

    const csv = [
      'id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts',
      ...rows.map((r: any) => [
        r.id,
        JSON.stringify(r.name ?? ''),
        r.gender,
        r.peak_w,
        r.best_wh60,
        r.total_wh,
        r.start_ts,
        r.end_ts,
      ].join(',')),
    ].join('\n');

    const csvOut = path.join(BACKUP_DIR, `sessions_${date}.csv`);
    fs.writeFileSync(csvOut, csv, 'utf8');

    return NextResponse.json({ ok: true, sqliteOut, csvOut });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 500 });
  }
}
