/**
 * Incension Health attribution sync.
 *
 * New file — see INCENSION-OVERLAY.md. Mirrors the shape of the existing
 * /api/cron/* routes so it fits the deployment already running.
 *
 *   GET  /api/incension/sync                 last 60 minutes
 *   GET  /api/incension/sync?since=all       full backfill
 *   GET  /api/incension/sync?since=1440      last 24 hours
 *
 * Authorization: Bearer <INCENSION_SYNC_SECRET>, or ?key= for schedulers that
 * cannot set headers.
 */

import { NextRequest, NextResponse } from "next/server";
import { runSync } from "@/incension/sync/run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const secret = process.env.INCENSION_SYNC_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  return request.nextUrl.searchParams.get("key") === secret;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const raw = request.nextUrl.searchParams.get("since");
  const sinceMinutes =
    raw === "all" ? null : raw ? Number(raw) : 60;

  if (sinceMinutes !== null && !Number.isFinite(sinceMinutes)) {
    return NextResponse.json(
      { success: false, error: "since must be a number of minutes or 'all'" },
      { status: 400 }
    );
  }

  const result = await runSync(sinceMinutes);

  return NextResponse.json(
    { success: result.ok, ...result },
    { status: result.ok ? 200 : 500 }
  );
}
