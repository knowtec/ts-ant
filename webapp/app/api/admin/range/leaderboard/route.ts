// app/api/admin/range/leaderboard/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { openSqlite, requirePIN }  from '../../../../../lib/db';

type Row = {
  name: string;
  gender: "M" | "F";
  best_wh60: number;
  peak_w: number;
  id_best_wh60: number | null;
  id_peak_w: number | null;
};

function listBy<T extends Record<string, any>>(
  arr: T[],
  metricKey: string,
  idKey: string,
  limit?: number | "all"
) {
  const sorted = arr
    .slice()
    .sort((a, b) => (Number(b[metricKey]) || 0) - (Number(a[metricKey]) || 0));

  const take =
    !limit || limit === "all" || !Number.isFinite(limit) ? sorted : sorted.slice(0, Number(limit));

  return take.map((r) => ({
    id: r[idKey],            // za prikaz #ID
    name: r.name,
    gender: r.gender,
    best_wh60: r.best_wh60,
    peak_w: r.peak_w,
  }));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    requirePIN(url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const limitParam = url.searchParams.get("limit"); // npr. "all" ali "100"
    const limit: number | "all" | undefined =
      !limitParam || limitParam === "all" ? "all" : Number(limitParam);

    if (!from || !to) {
      return NextResponse.json({ error: "from/to required" }, { status: 400 });
    }

    const db = openSqlite();

    const rows = db
      .prepare(
        `
        SELECT
          LOWER(TRIM(s.name))                  AS grp,
          MIN(s.name)                          AS name,
          s.gender                             AS gender,
          MAX(s.best_wh60)                     AS best_wh60,
          MAX(s.peak_w)                        AS peak_w,
          (
            SELECT s2.id
            FROM sessions s2
            WHERE s2.end_ts IS NOT NULL
              AND s2.date BETWEEN ? AND ?
              AND s2.gender = s.gender
              AND s2.name IS NOT NULL AND TRIM(s2.name) <> ''
              AND LOWER(TRIM(s2.name)) = LOWER(TRIM(s.name))
            ORDER BY s2.best_wh60 DESC, s2.id DESC
            LIMIT 1
          )                                     AS id_best_wh60,
          (
            SELECT s3.id
            FROM sessions s3
            WHERE s3.end_ts IS NOT NULL
              AND s3.date BETWEEN ? AND ?
              AND s3.gender = s.gender
              AND s3.name IS NOT NULL AND TRIM(s3.name) <> ''
              AND LOWER(TRIM(s3.name)) = LOWER(TRIM(s.name))
            ORDER BY s3.peak_w DESC, s3.id DESC
            LIMIT 1
          )                                     AS id_peak_w
        FROM sessions s
        WHERE s.end_ts IS NOT NULL
          AND s.date BETWEEN ? AND ?
          AND s.name IS NOT NULL AND TRIM(s.name) <> ''
          AND s.gender IN ('M','F')
        GROUP BY LOWER(TRIM(s.name)), s.gender
      `
      )
      .all(from, to, from, to, from, to);

    const men = rows.filter((r: any) => r.gender === "M");
    const women = rows.filter((r: any) => r.gender === "F");

    return NextResponse.json({
      from,
      to,
      menWh60:   listBy(men,   "best_wh60", "id_best_wh60", limit),
      menPeakW:  listBy(men,   "peak_w",    "id_peak_w",    limit),
      womenWh60: listBy(women, "best_wh60", "id_best_wh60", limit),
      womenPeakW:listBy(women, "peak_w",    "id_peak_w",    limit),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}