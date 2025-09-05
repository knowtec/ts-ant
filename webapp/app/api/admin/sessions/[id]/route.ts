export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { openSqlite } from '../../../../../lib/db';
import { requireAdminPIN } from '../../../../../lib/admin';

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  try {
    const url = new URL(req.url);
    requireAdminPIN(req.headers, null, url.searchParams);

    const db = openSqlite();
    const id = Number(ctx.params.id);
    const r = db.prepare('DELETE FROM sessions WHERE id=?').run(id);
    return NextResponse.json({ ok: r.changes > 0, deleted: r.changes });
  } catch (e:any) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}
