/**
 * Minimal Supabase REST client — no SDK, no new dependency.
 *
 * Only what the sync needs: upsert with conflict resolution, and a POST to an
 * RPC. Service-role key, so this must never be imported into a client bundle.
 */

const URL_BASE = process.env.INCENSION_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.INCENSION_SUPABASE_SERVICE_KEY ?? "";

export function syncConfigured(): boolean {
  return Boolean(URL_BASE && SERVICE_KEY);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * Upsert rows, resolving on the given unique constraint columns. Chunked
 * because a busy campaign can produce more rows than one request should carry.
 */
export async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  chunkSize = 500
): Promise<number> {
  let written = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const res = await fetch(
      `${URL_BASE}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
      {
        method: "POST",
        headers: headers({
          Prefer: "resolution=merge-duplicates,return=minimal",
        }),
        body: JSON.stringify(chunk),
      }
    );

    if (!res.ok) {
      throw new Error(
        `supabase upsert ${table} failed: ${res.status} ${await res.text()}`
      );
    }
    written += chunk.length;
  }

  return written;
}

/** Call a Postgres function (e.g. stitch_journey). */
export async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(args),
  });

  if (!res.ok) {
    throw new Error(`supabase rpc ${fn} failed: ${res.status} ${await res.text()}`);
  }
  return res.json().catch(() => null);
}
