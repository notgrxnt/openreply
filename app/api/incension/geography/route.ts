/**
 * Lead geography API.
 *
 * New route — /api/incension/content is untouched. Returns the per-reel
 * country breakdown of LEADS, which is the only per-reel geography that
 * exists: Instagram publishes country at the account level only, and media
 * insights take no breakdown parameter at all.
 */

import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import {
  fetchLeadGeography,
  geoTotals,
  byCountry,
  type GeoCell,
  type GeoRollup,
} from "@/incension/geo/leads";

export const dynamic = "force-dynamic";

export interface GeographyResponse {
  ok: boolean;
  error?: string;
  cells: GeoCell[];
  rollup: GeoRollup[];
  countries: Array<{ country: string; core: boolean; leads: number; tier_1: number }>;
  totals: {
    leads: number;
    core: number;
    india: number;
    other: number;
    unknown: number;
    corePct: number | null;
    indiaPct: number | null;
  };
}

export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const geo = await fetchLeadGeography();

  const body: GeographyResponse = {
    ok: geo.ok,
    error: geo.error,
    cells: geo.cells,
    rollup: geo.rollup,
    countries: byCountry(geo.cells),
    totals: geoTotals(geo.rollup),
  };

  return NextResponse.json(body);
}
