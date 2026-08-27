/**
 * Content intelligence API.
 *
 * Reels joined to campaigns, DMs, clicks and funnel outcomes. New route — the
 * existing /api/instagram/overview is upstream's and stays untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import {
  getAllUserMedia,
  getMediaInsights,
  PermissionError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  buildReelRows,
  whatsWorkingNow,
  unclaimedReels,
  type ReelRow,
} from "@/incension/content/model";

export const maxDuration = 60;

const MAX_POSTS = 120;
const INSIGHTS_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

export interface ContentResponse {
  working: ReelRow[];
  unclaimed: ReelRow[];
  rows: ReelRow[];
  totals: {
    reels: number;
    dmsSent: number;
    clicks: number;
    signups: number;
    qualified: number;
    dmsLast24h: number;
    clicksLast24h: number;
  };
  funnelOk: boolean;
  funnelError?: string;
  insightsAvailable: boolean;
}

export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const account = await getWorkspaceInstagramAccount(workspaceId);
  if (!account?.accessToken) {
    return NextResponse.json(
      { error: "No Instagram account connected" },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const countParam = request.nextUrl.searchParams.get("count");
    const parsed = countParam ? Number.parseInt(countParam, 10) : NaN;
    const target = Math.min(
      Number.isFinite(parsed) ? Math.max(parsed, 1) : 40,
      MAX_POSTS
    );

    const media = await getAllUserMedia(accessToken, target);

    let insightsAvailable = false;
    const insights = await mapWithConcurrency(
      media,
      INSIGHTS_CONCURRENCY,
      async (m) => {
        try {
          const data = await getMediaInsights(accessToken, m.id, [
            "views",
            "reach",
            "saved",
            "shares",
          ]);
          insightsAvailable = true;

          // Retention, asked for separately on purpose. Meta rejects the WHOLE
          // insights call if one metric doesn't apply to a media type, so
          // bundling watch time with the base four would cost us views and
          // reach on every non-reel post. Its own call degrades to null.
          let watch: Record<string, number> = {};
          try {
            watch = (await getMediaInsights(accessToken, m.id, [
              "ig_reels_avg_watch_time",
              "ig_reels_video_view_total_time",
            ])) as unknown as Record<string, number>;
          } catch {
            // Not a reel, or the metric is unavailable for this post. Fine.
          }

          return { ...data, ...watch };
        } catch (err) {
          if (!(err instanceof PermissionError)) {
            console.warn("[content] insights failed for", m.id);
          }
          return null;
        }
      }
    );

    const { rows, funnelOk, funnelError } = await buildReelRows({
      workspaceId,
      media,
      insights,
    });

    // Headline figures describe Era 2 — the account being rebuilt. Era 1 is a
    // vaulted archive; folding its 15M-view reels into "totals" would drown
    // every number that describes this week.
    const era2 = rows.filter((r) => r.era === 2);

    const totals = era2.reduce(
      (acc, r) => ({
        reels: acc.reels + 1,
        dmsSent: acc.dmsSent + (r.dmsSent ?? 0),
        clicks: acc.clicks + (r.clicks ?? 0),
        signups: acc.signups + r.signups,
        qualified: acc.qualified + r.qualified,
        dmsLast24h: acc.dmsLast24h + r.dmsLast24h,
        clicksLast24h: acc.clicksLast24h + r.clicksLast24h,
      }),
      {
        reels: 0,
        dmsSent: 0,
        clicks: 0,
        signups: 0,
        qualified: 0,
        dmsLast24h: 0,
        clicksLast24h: 0,
      }
    );

    // A campaign attached to several reels would otherwise have its DMs and
    // signups counted once per reel. De-dupe totals by campaign.
    const seen = new Set<string>();
    let dedupedDms = 0;
    let dedupedClicks = 0;
    let dedupedSignups = 0;
    let dedupedQualified = 0;
    for (const r of era2) {
      if (!r.campaignId || seen.has(r.campaignId)) continue;
      seen.add(r.campaignId);
      dedupedDms += r.dmsSent ?? 0;
      dedupedClicks += r.clicks ?? 0;
      dedupedSignups += r.signups;
      dedupedQualified += r.qualified;
    }
    totals.dmsSent = dedupedDms;
    totals.clicks = dedupedClicks;
    totals.signups = dedupedSignups;
    totals.qualified = dedupedQualified;

    const payload: ContentResponse = {
      working: whatsWorkingNow(rows),
      unclaimed: unclaimedReels(rows),
      rows,
      totals,
      funnelOk,
      funnelError,
      insightsAvailable,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[content] failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
