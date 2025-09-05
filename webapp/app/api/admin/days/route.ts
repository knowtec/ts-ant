// app/api/admin/days/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openSqlite, requirePIN } from '../../../../lib/db';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    requirePIN(url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) {
      return NextResponse.json({ error: "from/to required" }, { status: 400 });
    }

    const db = openSqlite();

    const rows = db.prepare(`
      SELECT
        date,
        COUNT(*) AS sessions,
        SUM(CASE WHEN end_ts IS NOT NULL THEN 1 ELSE 0 END) AS sessions_ended,
        COALESCE(SUM(total_wh),0) AS total_wh,
        COALESCE(SUM(total_wh),0) * COALESCE(NULLIF( (SELECT 1.0), 0), 1.0) AS total_eur, -- (če želiš EUR faktor, raje ga vrni iz bridge / .env)
        COALESCE(MAX(peak_w),0) AS max_peak_w,
        COALESCE(MAX(best_wh60),0) AS max_best_wh60
      FROM sessions
      WHERE date BETWEEN ? AND ?
      GROUP BY date
      ORDER BY date DESC
    `).all(from, to);

    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
