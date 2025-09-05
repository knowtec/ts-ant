// app/api/leaderboard/all/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
// Če nimaš aliasa "@/lib/...", uporabi relativno pot: "../../../lib/db"
import { openSqlite } from "../../../../lib/db";

function top<T extends Record<string, any>>(arr: T[], key: string, n = 5) {
  return arr
    .slice()
    .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0))
    .slice(0, n);
}

export async function GET() {
  try {
    const db = openSqlite();

    // VZEMI ID!
    const rows = db
      .prepare(
        `
        SELECT id, name, gender, peak_w, best_wh60, total_wh
        FROM sessions
        WHERE end_ts IS NOT NULL
      `
      )
      .all();

    const men = rows.filter((r: any) => r.gender === "M");
    const women = rows.filter((r: any) => r.gender === "F");

    return NextResponse.json({
      date: "ALL",
      menWh60: top(men, "best_wh60", 5),
      menPeakW: top(men, "peak_w", 5),
      womenWh60: top(women, "best_wh60", 5),
      womenPeakW: top(women, "peak_w", 5),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
