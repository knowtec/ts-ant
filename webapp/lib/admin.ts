// lib/admin.ts
export function requireAdminPIN(headers: Headers, body?: any, search?: URLSearchParams) {
  const want = String(process.env.ADMIN_PIN || '');
  // Če PIN ni nastavljen v .env.local, ne blokiraj (odpri admin lokalno)
  if (!want) return;

  const got = String(
    headers.get('x-admin-pin') ||
    body?.pin ||
    search?.get('pin') ||
    ''
  );
  if (got !== want) {
    const e: any = new Error('bad pin');
    e.status = 401;
    throw e;
  }
}
