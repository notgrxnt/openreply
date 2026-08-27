/**
 * Lead geography, per reel.
 *
 * Instagram exposes country only at the ACCOUNT level, and per-media insights
 * accept no breakdown parameter at all — there is no endpoint that returns the
 * country mix of one reel's views. So geography is managed where it actually
 * decides something: at the lead. Every lead carries a browser timezone, the
 * timezone resolves to a country, and the lead already carries the utm_content
 * of the reel that produced it. That chain gives a real per-reel country
 * breakdown without inventing anything.
 *
 * Reads two aggregate views from the Portal project with the anon key. Counts
 * only — no name, email, phone or free-text answer crosses into this app, the
 * same trade already made in incension/content/supabase.ts.
 */

/** One (reel, country) cell. */
export interface GeoCell {
  utm_content: string;
  /** ISO alpha-2, or 'UNKNOWN' when neither timezone nor dialling code resolved. */
  country: string;
  core_market: boolean;
  leads: number;
  completed: number;
  tier_1: number;
  tier_2: number;
  webinar_invited: number;
  product_started: number;
  last_lead_at: string | null;
}

/** One reel's geography, already rolled up. */
export interface GeoRollup {
  utm_content: string;
  leads: number;
  core_leads: number;
  india_leads: number;
  other_leads: number;
  unknown_leads: number;
  core_tier_1: number;
  core_webinar_invited: number;
  core_pct: number | null;
  india_pct: number | null;
  last_lead_at: string | null;
}

export interface GeoData {
  ok: boolean;
  cells: GeoCell[];
  rollup: GeoRollup[];
  byUtmContent: Map<string, GeoRollup>;
  error?: string;
}

/** Postgres returns numeric as a string over REST. Coerce, preserving null. */
function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}
function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

async function readView<T>(
  path: string,
  select: string
): Promise<{ ok: boolean; rows: T[]; error?: string }> {
  const base = process.env.INCENSION_SUPABASE_URL;
  const key = process.env.INCENSION_SUPABASE_ANON_KEY;

  if (!base || !key) {
    return {
      ok: false,
      rows: [],
      error: "INCENSION_SUPABASE_URL / INCENSION_SUPABASE_ANON_KEY not set",
    };
  }

  try {
    const endpoint = new URL(`/rest/v1/${path}`, base);
    endpoint.searchParams.set("select", select);

    const res = await fetch(endpoint.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return { ok: false, rows: [], error: `Supabase responded ${res.status}` };
    }
    return { ok: true, rows: (await res.json()) as T[] };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Never throws. Geography is an enrichment on top of the reel data — if the
 * Portal is unreachable the rest of the dashboard still renders, and the page
 * says "couldn't load" rather than showing zeros that read as "no leads".
 */
export async function fetchLeadGeography(): Promise<GeoData> {
  const [cellsRes, rollupRes] = await Promise.all([
    readView<Record<string, unknown>>(
      "content_geography",
      "utm_content,country,core_market,leads,completed,tier_1,tier_2,webinar_invited,product_started,last_lead_at"
    ),
    readView<Record<string, unknown>>(
      "content_geography_rollup",
      "utm_content,leads,core_leads,india_leads,other_leads,unknown_leads,core_tier_1,core_webinar_invited,core_pct,india_pct,last_lead_at"
    ),
  ]);

  if (!cellsRes.ok || !rollupRes.ok) {
    return {
      ok: false,
      cells: [],
      rollup: [],
      byUtmContent: new Map(),
      error: cellsRes.error ?? rollupRes.error,
    };
  }

  const cells: GeoCell[] = cellsRes.rows.map((r) => ({
    utm_content: String(r.utm_content ?? "(none)"),
    country: String(r.country ?? "UNKNOWN"),
    core_market: Boolean(r.core_market),
    leads: num(r.leads),
    completed: num(r.completed),
    tier_1: num(r.tier_1),
    tier_2: num(r.tier_2),
    webinar_invited: num(r.webinar_invited),
    product_started: num(r.product_started),
    last_lead_at: (r.last_lead_at as string) ?? null,
  }));

  const rollup: GeoRollup[] = rollupRes.rows.map((r) => ({
    utm_content: String(r.utm_content ?? "(none)"),
    leads: num(r.leads),
    core_leads: num(r.core_leads),
    india_leads: num(r.india_leads),
    other_leads: num(r.other_leads),
    unknown_leads: num(r.unknown_leads),
    core_tier_1: num(r.core_tier_1),
    core_webinar_invited: num(r.core_webinar_invited),
    core_pct: nullableNum(r.core_pct),
    india_pct: nullableNum(r.india_pct),
    last_lead_at: (r.last_lead_at as string) ?? null,
  }));

  return {
    ok: true,
    cells,
    rollup,
    byUtmContent: new Map(rollup.map((r) => [r.utm_content, r])),
    error: undefined,
  };
}

/** Account-wide totals. Sums the rollup rather than the cells so a reel with
 *  no leads cannot skew the denominator. */
export function geoTotals(rollup: GeoRollup[]) {
  const leads = rollup.reduce((s, r) => s + r.leads, 0);
  const core = rollup.reduce((s, r) => s + r.core_leads, 0);
  const india = rollup.reduce((s, r) => s + r.india_leads, 0);
  const other = rollup.reduce((s, r) => s + r.other_leads, 0);
  const unknown = rollup.reduce((s, r) => s + r.unknown_leads, 0);

  return {
    leads,
    core,
    india,
    other,
    unknown,
    corePct: leads > 0 ? core / leads : null,
    indiaPct: leads > 0 ? india / leads : null,
  };
}

/** Country totals across every reel, biggest first. */
export function byCountry(cells: GeoCell[]) {
  const map = new Map<string, { country: string; core: boolean; leads: number; tier_1: number }>();
  for (const c of cells) {
    const existing = map.get(c.country);
    map.set(c.country, {
      country: c.country,
      core: c.core_market,
      leads: (existing?.leads ?? 0) + c.leads,
      tier_1: (existing?.tier_1 ?? 0) + c.tier_1,
    });
  }
  return [...map.values()].sort((a, b) => b.leads - a.leads);
}
