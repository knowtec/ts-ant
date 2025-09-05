// app/api/admin/sessions/[date]/route.ts
export const runtime = 'nodejs';
import { NextResponse } from 'next/server';
import { openSqlite } from '../../../../../lib/db';
import { requireAdminPIN } from '../../../../../lib/admin';

export async function GET(req: Request, ctx: { params: { date: string } }) {
  try {
    const url = new URL(req.url);
    requireAdminPIN(req.headers, null, url.searchParams);

    const db = openSqlite();
    const rows = db.prepare(`
      SELECT id,name,gender,date,start_ts,end_ts,peak_w,best_wh60,total_wh
      FROM sessions
      WHERE date = ?
      ORDER BY start_ts DESC
    `).all(ctx.params.date);

    return NextResponse.json({ date: ctx.params.date, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
