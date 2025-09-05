// app/api/admin/sessions/today/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openSqlite, todayLj, requirePIN } from '../../../../../lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    requirePIN(url);

    const db = openSqlite();
    const date = todayLj();

    const rows = db.prepare(`
      SELECT id,name,gender,date,start_ts,end_ts,peak_w,best_wh60,total_wh
      FROM sessions
      WHERE date=?
      ORDER BY id DESC
    `).all(date);

    return NextResponse.json({ rows, dateUsed: date, dbPath: process.env.ANT_DB_PATH });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
