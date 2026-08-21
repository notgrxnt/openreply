/**
 * Read-only bridge to the Incension Portal's Supabase project.
 *
 * The funnel lives in Supabase; reels, DMs and clicks live here. To show one
 * funnel per reel we need both, and the join key is `utm_content` — which the
 * tracked link already carries end to end.
 *
 * Deliberately narrow: this reads ONE aggregate view (`content_performance`)
 * with the anon key. That view exposes counts only — no name, email, phone or
 * free-text answer ever crosses into this app. A service-role key here would
 * have handed the DM tool the keys to the whole CRM for the sake of a
 * dashboard, which is a bad trade.
 */

export interface FunnelAggregate {
  utm_content: string;
  signups: number;
  completed: number;
  qualified: number;
  tier_1: number;
  geo_disqualified: number;
  core_market: number;
  consented: number;
  last_signup: string | null;
}

const EMPTY: FunnelAggregate = {
  utm_content: "",
  signups: 0,
  completed: 0,
  qualified: 0,
  tier_1: 0,
  geo_disqualified: 0,
  core_market: 0,
  consented: 0,
  last_signup: null,
};

export function emptyAggregate(utmContent: string): FunnelAggregate {
  return { ...EMPTY, utm_content: utmContent };
}

/**
 * Fetch the whole rollup, keyed by utm_content for O(1) lookup.
 *
 * Never throws. The funnel side is an enrichment: if Supabase is unreachable
 * or unconfigured, the dashboard still renders reach, DMs and clicks rather
 * than failing whole. Missing funnel data reads as zeros, which is honest —
 * we distinguish "no signups" from "couldn't load" via `ok` on the response.
 */
export async function fetchFunnelAggregates(): Promise<{
  ok: boolean;
  byUtmContent: Map<string, FunnelAggregate>;
  error?: string;
}> {
  const url = process.env.INCENSION_SUPABASE_URL;
  const key = process.env.INCENSION_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      ok: false,
      byUtmContent: new Map(),
      error: "INCENSION_SUPABASE_URL / INCENSION_SUPABASE_ANON_KEY not set",
    };
  }

  try {
    const endpoint = new URL("/rest/v1/content_performance", url);
    endpoint.searchParams.set(
      "select",
      "utm_content,signups,completed,qualified,tier_1,geo_disqualified,core_market,consented,last_signup"
    );

    const response = await fetch(endpoint.toString(), {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // Funnel counts move slowly; a short cache keeps the page snappy without
      // going stale enough to mislead.
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return {
        ok: false,
        byUtmContent: new Map(),
        error: `Supabase responded ${response.status}`,
      };
    }

    const rows = (await response.json()) as FunnelAggregate[];
    const byUtmContent = new Map<string, FunnelAggregate>();
    for (const row of rows) {
      // Several campaigns can share a utm_content (e.g. a catch-all and a
      // post-specific one). Sum rather than overwrite.
      const existing = byUtmContent.get(row.utm_content);
      byUtmContent.set(
        row.utm_content,
        existing
          ? {
              ...existing,
              signups: existing.signups + row.signups,
              completed: existing.completed + row.completed,
              qualified: existing.qualified + row.qualified,
              tier_1: existing.tier_1 + row.tier_1,
              geo_disqualified: existing.geo_disqualified + row.geo_disqualified,
              core_market: existing.core_market + row.core_market,
              consented: existing.consented + row.consented,
            }
          : row
      );
    }

    return { ok: true, byUtmContent };
  } catch (error) {
    return {
      ok: false,
      byUtmContent: new Map(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/** Pull utm_content out of a tracked link's destination URL. */
export function utmContentFromUrl(destinationUrl: string): string | null {
  try {
    return new URL(destinationUrl).searchParams.get("utm_content");
  } catch {
    return null;
  }
}
