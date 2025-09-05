// app/api/admin/range/sessions/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { openSqlite, requirePIN } from "../../../../../lib/db";

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
      SELECT id,name,gender,date,start_ts,end_ts,peak_w,best_wh60,total_wh
      FROM sessions
      WHERE date BETWEEN ? AND ?
      ORDER BY date DESC, id DESC
    `).all(from, to);

    return NextResponse.json({ rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
