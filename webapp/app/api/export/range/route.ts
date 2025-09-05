// app/api/export/range/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { openSqlite } from '../../../../lib/db';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = (url.searchParams.get('from') || '0000-01-01').trim();
  const to   = (url.searchParams.get('to')   || '9999-12-31').trim();

  const db = openSqlite();
  const rows = db.prepare(`
    SELECT id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts,date
    FROM sessions
    WHERE date BETWEEN ? AND ? AND end_ts IS NOT NULL
    ORDER BY date ASC, start_ts ASC
  `).all(from, to);

  const lines = [
    'id,name,gender,peak_w,best_wh60,total_wh,start_ts,end_ts,date',
    ...rows.map((r:any)=>[
      r.id, JSON.stringify(r.name ?? ''), r.gender, r.peak_w, r.best_wh60, r.total_wh, r.start_ts, r.end_ts, r.date
    ].join(','))
  ].join('\n');

  return new NextResponse(lines, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="sessions_${from}_to_${to}.csv"`
    }
  });
}
