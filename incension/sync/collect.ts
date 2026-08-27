/**
 * Reads OpenReply's own tables and shapes them into Incension Health rows.
 *
 * The join key is recipientToken(automationId, commenterId) — the SAME
 * function the DM worker used when it built the link, imported rather than
 * reimplemented. That is the whole reason this runs here instead of inside
 * Supabase: there is no second copy of the secret to drift.
 */

import { prisma } from "@/lib/db/client";
import { recipientToken } from "@/lib/tracking/recipient-token";

const ERA = process.env.INCENSION_ERA ?? "h1";

export type ContentPieceRow = {
  platform_post_id: string;
  url: string | null;
  keyword: string | null;
  era: string;
};

export type InstagramLeadRow = {
  ig_user_id: string;
  ig_username: string | null;
  ig_account_username: string | null;
  ig_account_id: string | null;
  automation_id: string;
  automation_name: string | null;
  matched_keyword: string | null;
  post_id: string | null;
  post_url: string | null;
  comment_id: string;
  comment_text: string | null;
  commented_at: string;
  dm_status: string | null;
  dm_sent_at: string | null;
  dm_error: string | null;
  link_token: string;
  link_destination: string | null;
  first_click_at: string | null;
  click_count: number;
  era: string;
};

/** Reels that any campaign points at, so revenue can attribute to creative. */
export async function collectContentPieces(): Promise<ContentPieceRow[]> {
  const automations = await prisma.automation.findMany({
    where: { postId: { not: null } },
    select: { postId: true, postUrl: true, keywords: true },
  });

  const byPost = new Map<string, ContentPieceRow>();
  for (const a of automations) {
    if (!a.postId) continue;
    byPost.set(a.postId, {
      platform_post_id: a.postId,
      url: a.postUrl ?? null,
      keyword: a.keywords.join(",") || null,
      era: ERA,
    });
  }
  return [...byPost.values()];
}

/**
 * Every comment that matched a campaign, with its DM outcome and per-recipient
 * click rollup.
 *
 * `since` makes the routine cheap on a 15-minute schedule; omit it for a full
 * backfill. Because the token is derived rather than stored, a backfill reaches
 * every historical DmLog row, not just ones created after the sync existed.
 */
export async function collectInstagramLeads(
  since?: Date
): Promise<InstagramLeadRow[]> {
  const logs = await prisma.dmLog.findMany({
    where: since ? { updatedAt: { gte: since } } : undefined,
    select: {
      commenterId: true,
      commenterName: true,
      commentId: true,
      commentText: true,
      matchedKeyword: true,
      status: true,
      dmSentAt: true,
      errorMessage: true,
      createdAt: true,
      automationId: true,
      automation: {
        select: {
          id: true,
          name: true,
          postId: true,
          postUrl: true,
          instagramAccount: { select: { id: true, username: true } },
          trackedLinks: {
            select: { destinationUrl: true },
            orderBy: { createdAt: "asc" },
            take: 1,
          },
        },
      },
    },
  });

  if (logs.length === 0) return [];

  // Click rollup, keyed by the same token.
  const tokens = logs.map((l) => recipientToken(l.automationId, l.commenterId));
  const clicks = await prisma.linkClick.groupBy({
    by: ["recipientToken"],
    where: { recipientToken: { in: tokens } },
    _min: { createdAt: true },
    _count: { _all: true },
  });

  const clicksByToken = new Map(
    clicks
      .filter((c) => c.recipientToken)
      .map((c) => [
        c.recipientToken as string,
        { first: c._min.createdAt, count: c._count._all },
      ])
  );

  return logs.map((l) => {
    const token = recipientToken(l.automationId, l.commenterId);
    const click = clicksByToken.get(token);

    return {
      ig_user_id: l.commenterId,
      ig_username: l.commenterName ?? null,
      ig_account_username: l.automation.instagramAccount?.username ?? null,
      ig_account_id: l.automation.instagramAccount?.id ?? null,
      automation_id: l.automationId,
      automation_name: l.automation.name ?? null,
      matched_keyword: l.matchedKeyword ?? null,
      post_id: l.automation.postId ?? null,
      post_url: l.automation.postUrl ?? null,
      comment_id: l.commentId,
      comment_text: l.commentText ?? null,
      commented_at: l.createdAt.toISOString(),
      dm_status: l.status,
      dm_sent_at: l.dmSentAt?.toISOString() ?? null,
      dm_error: l.errorMessage ?? null,
      link_token: token,
      link_destination: l.automation.trackedLinks[0]?.destinationUrl ?? null,
      first_click_at: click?.first?.toISOString() ?? null,
      click_count: click?.count ?? 0,
      era: ERA,
    };
  });
}
