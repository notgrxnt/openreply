/**
 * Per-reel funnel model.
 *
 * Instagram tells you views. Your own system is the only place that knows a
 * reel produced 63 DMs, 49 clicks, 6 signups and one qualified lead. This
 * module is the join that makes that one row.
 *
 * Chain:  reel → campaign → DMs sent → tracked clicks → signups → quality
 * Join keys: campaign.postId ↔ media.id, then utm_content ↔ the Supabase view.
 *
 * "What's working now" is computed from DM and click timestamps, which are
 * local. Instagram's per-media insights are cumulative totals with no time
 * series, so velocity is something only this side can answer.
 */

import { prisma } from "@/lib/db/client";
import { recipientToken } from "@/lib/tracking/recipient-token";
import {
  fetchFunnelAggregates,
  utmContentFromUrl,
  emptyAggregate,
  type FunnelAggregate,
} from "./supabase";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The restart. Everything before this is Era 1 — a dormant-account archive kept
 * for benchmarks (peak reach, best CTA rates) and deliberately excluded from
 * day-to-day reads. Everything after is Era 2, the account being rebuilt.
 *
 * A FIXED DATE, not a rolling window: a rolling 14 days would quietly vault
 * this week's reels next week, which is the opposite of what the split is for.
 */
export const ERA_2_START = new Date("2026-08-12T00:00:00Z").getTime();

export interface ReelRow {
  mediaId: string;
  caption: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  timestamp: string;
  ageDays: number;

  // Instagram side
  views: number | null;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
  /** Seconds. The metric that governs whether Instagram pushes past your followers. */
  avgWatchSeconds: number | null;

  // Ours
  campaignId: string | null;
  campaignName: string | null;
  keywords: string[];
  utmContent: string | null;
  dmsSent: number | null;       // null = not attributable to this reel yet
  clicks: number | null;        // raw click events
  uniqueClickers: number | null;// distinct people, for a click rate that can't exceed 100%
  dmsLast24h: number;
  clicksLast24h: number;
  /** How dmsSent/clicks were derived, so the UI never presents a guess as a fact. */
  attribution: "post-campaign" | "per-reel" | "unattributed";

  // Funnel (Supabase). Null where the campaign serves many reels, so its
  // signups belong to no single one — the same rule as dmsSent.
  signups: number | null;
  qualified: number | null;
  coreMarket: number | null;
  geoDisqualified: number | null;
  webinarInvited: number | null;
  productStarted: number | null;
  conversions: number | null;
  revenueCents: number | null;
  /**
   * The campaign's own totals, always populated. Display uses the per-reel
   * fields above and shows a dash when they are unknown; account-level tiles
   * still need a true figure, and they de-duplicate by campaign anyway.
   */
  campaignSignups: number;
  campaignQualified: number;
  campaignWebinar: number;
  campaignConversions: number;
  campaignRevenueCents: number;

  // Derived
  era: 1 | 2;                   // 1 = vaulted benchmark, 2 = the working era
  commentToDm: number | null;   // DMs / comments
  commentRate: number | null;   // comments / views — the CTA metric that survives era change
  ctr: number | null;           // unique clickers / DMs
  signupRate: number | null;    // signups / clicks
  leadsPerThousandViews: number | null;
  isLive: boolean;              // still actively producing
}

export interface MediaLike {
  id: string;
  caption?: string | null;
  permalink?: string | null;
  thumbnail_url?: string | null;
  media_url?: string | null;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
}

export interface InsightsLike {
  views?: number;
  reach?: number;
  saved?: number;
  shares?: number;
}

function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return numerator / denominator;
}

/**
 * Build one row per reel, newest first.
 *
 * A reel with no campaign still appears — that is the point. An unattached
 * reel pulling comments is a missed campaign, and it should be visible as
 * such rather than filtered out of the view.
 */
export async function buildReelRows({
  workspaceId,
  media,
  insights,
}: {
  workspaceId: string;
  media: MediaLike[];
  insights: Array<InsightsLike | null>;
}): Promise<{ rows: ReelRow[]; funnelOk: boolean; funnelError?: string }> {
  const now = Date.now();
  const since24h = new Date(now - DAY_MS);

  const automations = await prisma.automation.findMany({
    where: { workspaceId },
    select: {
      id: true,
      name: true,
      postId: true,
      matchAnyPost: true,
      keywords: true,
      isActive: true,
      createdAt: true,
      trackedLinks: {
        select: { destinationUrl: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const automationIds = automations.map((a) => a.id);

  // Counts in bulk rather than per-reel queries — a 150-post account would
  // otherwise fire several hundred round trips to render one page.
  const [
    sentTotals,
    sent24h,
    clickTotals,
    clicks24h,
    funnel,
    sentByMedia,
    dmRecipients,
    tokenClicks,
  ] = await Promise.all([
      prisma.dmLog.groupBy({
        by: ["automationId"],
        where: { automationId: { in: automationIds }, status: "SENT" },
        _count: { _all: true },
      }),
      prisma.dmLog.groupBy({
        by: ["automationId"],
        where: {
          automationId: { in: automationIds },
          status: "SENT",
          createdAt: { gte: since24h },
        },
        _count: { _all: true },
      }),
      prisma.linkClick.groupBy({
        by: ["automationId"],
        where: { automationId: { in: automationIds } },
        _count: { _all: true },
      }),
      prisma.linkClick.groupBy({
        by: ["automationId"],
        where: {
          automationId: { in: automationIds },
          createdAt: { gte: since24h },
        },
        _count: { _all: true },
      }),
      fetchFunnelAggregates(),
      // Per-reel DM counts. Only rows written since the mediaId migration have
      // one; older rows stay unattributed rather than being guessed at.
      prisma.dmLog.groupBy({
        by: ["mediaId"],
        where: {
          automationId: { in: automationIds },
          status: "SENT",
          mediaId: { not: null },
        },
        _count: { _all: true },
      }),
      // The click → reel bridge. LinkClick has no mediaId, but it carries the
      // recipient token, and the token is a pure function of
      // (automationId, commenterId) — which DmLog has alongside mediaId.
      prisma.dmLog.findMany({
        where: {
          automationId: { in: automationIds },
          mediaId: { not: null },
        },
        select: { automationId: true, commenterId: true, mediaId: true },
      }),
      prisma.linkClick.findMany({
        where: {
          automationId: { in: automationIds },
          recipientToken: { not: null },
        },
        select: { recipientToken: true, automationId: true },
      }),
    ]);

  const countMap = (
    groups: Array<{ automationId: string | null; _count: { _all: number } }>
  ) => {
    const m = new Map<string, number>();
    for (const g of groups) {
      if (g.automationId) m.set(g.automationId, g._count._all);
    }
    return m;
  };

  const sentBy = countMap(sentTotals);
  const sent24By = countMap(sent24h);
  const clicksBy = countMap(clickTotals);
  const clicks24By = countMap(clicks24h);

  // DMs actually recorded against each reel (post-migration rows only).
  const dmsByMedia = new Map<string, number>();
  for (const g of sentByMedia) {
    if (g.mediaId) dmsByMedia.set(g.mediaId, g._count._all);
  }

  // token -> reel, then clicks -> reel. Distinct tokens give a click rate that
  // is people, not taps, so it can never exceed 100% the way raw clicks do.
  const mediaByToken = new Map<string, string>();
  for (const d of dmRecipients) {
    if (d.mediaId) {
      mediaByToken.set(recipientToken(d.automationId, d.commenterId), d.mediaId);
    }
  }
  const clicksByMedia = new Map<string, number>();
  const clickersByMedia = new Map<string, Set<string>>();
  // Distinct clickers per CAMPAIGN. A post-specific campaign fires on exactly
  // one reel, so its distinct clickers are that reel's — no mediaId history
  // required, which is what lets an older reel show a real CTR today.
  const clickersByAutomation = new Map<string, Set<string>>();
  for (const c of tokenClicks) {
    const token = c.recipientToken;
    if (!token) continue;
    let byAuto = clickersByAutomation.get(c.automationId);
    if (!byAuto) clickersByAutomation.set(c.automationId, (byAuto = new Set()));
    byAuto.add(token);

    const mediaId = mediaByToken.get(token);
    if (!mediaId) continue;
    clicksByMedia.set(mediaId, (clicksByMedia.get(mediaId) ?? 0) + 1);
    let set = clickersByMedia.get(mediaId);
    if (!set) clickersByMedia.set(mediaId, (set = new Set()));
    set.add(token);
  }

  // Post-specific campaigns win the association; a catch-all is the fallback
  // for reels nothing else claims. That mirrors how the worker actually
  // resolves precedence, so the dashboard agrees with reality.
  const byPostId = new Map<string, (typeof automations)[number]>();
  for (const a of automations) {
    if (a.postId && !byPostId.has(a.postId)) byPostId.set(a.postId, a);
  }
  const catchAll = automations.find((a) => a.matchAnyPost && a.isActive) ?? null;

  const rows: ReelRow[] = media.map((m, i) => {
    const ins = insights[i];
    const automation = byPostId.get(m.id) ?? catchAll;
    const utmContent = automation?.trackedLinks[0]
      ? utmContentFromUrl(automation.trackedLinks[0].destinationUrl)
      : null;

    const agg: FunnelAggregate =
      (utmContent && funnel.byUtmContent.get(utmContent)) ||
      emptyAggregate(utmContent ?? "");

    // Attribution, honestly. A post-specific campaign fires on exactly one
    // reel, so its campaign totals ARE that reel's totals. A catch-all fires on
    // every reel, so its totals belong to no single one — use the per-reel rows
    // if we have them and report nothing if we don't. The old fallback printed
    // the catch-all's career figures against all 38 reels, which read as data.
    const postSpecific = Boolean(automation && !automation.matchAnyPost);

    let dmsSent: number | null;
    let clicks: number | null;
    let uniqueClickers: number | null;
    let attribution: ReelRow["attribution"];

    if (postSpecific && automation) {
      dmsSent = sentBy.get(automation.id) ?? 0;
      clicks = clicksBy.get(automation.id) ?? 0;
      uniqueClickers = clickersByAutomation.get(automation.id)?.size ?? null;
      attribution = "post-campaign";
    } else if (dmsByMedia.has(m.id)) {
      dmsSent = dmsByMedia.get(m.id) ?? 0;
      clicks = clicksByMedia.get(m.id) ?? 0;
      uniqueClickers = clickersByMedia.get(m.id)?.size ?? 0;
      attribution = "per-reel";
    } else {
      dmsSent = null;
      clicks = null;
      uniqueClickers = null;
      attribution = "unattributed";
    }

    const dmsLast24h =
      postSpecific && automation ? (sent24By.get(automation.id) ?? 0) : 0;
    const clicksLast24h =
      postSpecific && automation ? (clicks24By.get(automation.id) ?? 0) : 0;

    const comments = m.comments_count ?? 0;
    const views = ins?.views ?? null;
    const ageDays = Math.max(
      0,
      Math.floor((now - new Date(m.timestamp).getTime()) / DAY_MS)
    );

    return {
      mediaId: m.id,
      caption: m.caption?.trim().slice(0, 140) ?? null,
      permalink: m.permalink ?? null,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp,
      ageDays,

      views,
      reach: ins?.reach ?? null,
      likes: m.like_count ?? 0,
      comments,
      saved: ins?.saved ?? null,
      shares: ins?.shares ?? null,
      avgWatchSeconds: (() => {
        // Meta reports this in milliseconds.
        const raw = (ins as Record<string, number> | null)?.[
          "ig_reels_avg_watch_time"
        ];
        return typeof raw === "number" ? raw / 1000 : null;
      })(),

      campaignId: automation?.id ?? null,
      campaignName: automation?.name ?? null,
      keywords: automation?.keywords ?? [],
      utmContent,
      dmsSent,
      clicks,
      uniqueClickers,
      attribution,
      dmsLast24h,
      clicksLast24h,

      // Signups arrive keyed on utm_content, which is a CAMPAIGN. For a
      // post-specific campaign that is this reel. For the catch-all it is
      // thirteen reels' worth, and printing it against each one repeats the
      // exact mistake the DM column stopped making.
      campaignSignups: agg.signups,
      campaignQualified: agg.qualified,
      campaignWebinar: agg.webinar_invited,
      campaignConversions: agg.conversions,
      campaignRevenueCents: agg.revenue_cents,
      signups: postSpecific ? agg.signups : null,
      qualified: postSpecific ? agg.qualified : null,
      coreMarket: postSpecific ? agg.core_market : null,
      geoDisqualified: postSpecific ? agg.geo_disqualified : null,
      webinarInvited: postSpecific ? agg.webinar_invited : null,
      productStarted: postSpecific ? agg.product_started : null,
      conversions: postSpecific ? agg.conversions : null,
      revenueCents: postSpecific ? agg.revenue_cents : null,

      era: new Date(m.timestamp).getTime() >= ERA_2_START ? 2 : 1,
      commentToDm: dmsSent === null ? null : ratio(dmsSent, comments),
      commentRate: views ? comments / views : null,
      // Unique clickers, not raw taps — a rate that cannot exceed 100%.
      ctr:
        uniqueClickers === null || dmsSent === null
          ? null
          : ratio(uniqueClickers, dmsSent),
      signupRate: clicks === null ? null : ratio(agg.signups, clicks),
      leadsPerThousandViews: views ? (agg.signups / views) * 1000 : null,
      isLive: dmsLast24h > 0 || clicksLast24h > 0,
    };
  });

  return { rows, funnelOk: funnel.ok, funnelError: funnel.error };
}

/**
 * "What's working right now."
 *
 * Ranked on last-24h movement, not lifetime totals — a reel from March with
 * 40k views is history; a reel from this morning pulling DMs is the thing you
 * can still act on. Reels with recent activity first, then anything posted in
 * the last week that hasn't moved yet.
 */
export function whatsWorkingNow(rows: ReelRow[], limit = 5): ReelRow[] {
  // Era 2 only. A vaulted 15M-view reel from last year is not "working now".
  rows = rows.filter((r) => r.era === 2);

  const active = rows
    .filter((r) => r.isLive)
    .sort(
      (a, b) =>
        b.dmsLast24h + b.clicksLast24h - (a.dmsLast24h + a.clicksLast24h)
    );

  if (active.length >= limit) return active.slice(0, limit);

  const recentQuiet = rows
    .filter((r) => !r.isLive && r.ageDays <= 7)
    .sort((a, b) => a.ageDays - b.ageDays);

  return [...active, ...recentQuiet].slice(0, limit);
}

/**
 * Reels pulling keyword comments with no campaign attached — leads falling on
 * the floor. Surfaced because it is the single most recoverable miss on the
 * page.
 */
export function unclaimedReels(rows: ReelRow[]): ReelRow[] {
  return rows
    .filter((r) => !r.campaignId && r.comments > 0 && r.ageDays <= 30)
    .sort((a, b) => b.comments - a.comments);
}
