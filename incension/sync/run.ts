/**
 * One sync pass: collect from OpenReply, push to Incension Health, stitch.
 *
 * Idempotent. Upserts resolve on the same unique constraints the Health schema
 * declares, so re-running is always safe and DM status updates in place.
 */

import { collectContentPieces, collectInstagramLeads } from "./collect";
import { rpc, syncConfigured, upsert } from "./supabase";

export type SyncResult = {
  ok: boolean;
  contentPieces: number;
  instagramLeads: number;
  stitched: number | null;
  windowFrom: string | null;
  error?: string;
};

/**
 * @param sinceMinutes  look-back window. Pass null for a full backfill —
 *                      correct on first run, and after any gap in the schedule.
 */
export async function runSync(
  sinceMinutes: number | null = 60
): Promise<SyncResult> {
  if (!syncConfigured()) {
    return {
      ok: false,
      contentPieces: 0,
      instagramLeads: 0,
      stitched: null,
      windowFrom: null,
      error:
        "INCENSION_HEALTH_SUPABASE_URL / INCENSION_HEALTH_SERVICE_KEY are not set",
    };
  }

  const since =
    sinceMinutes === null
      ? undefined
      : new Date(Date.now() - sinceMinutes * 60_000);

  try {
    // Reels first — instagram_leads carries a FK to them.
    const pieces = await collectContentPieces();
    if (pieces.length) {
      await upsert("health_content_pieces", pieces, "platform_post_id");
    }

    const leads = await collectInstagramLeads(since);
    if (leads.length) {
      // comment_id is the unique key the Health schema actually declares.
      await upsert("health_instagram_leads", leads, "comment_id");
    }

    // Resolve commenter -> lead -> profile -> order, and push the creative down
    // the chain. Lives in Supabase because it only touches Health's own tables.
    // stitch_journey is not in the Health schema yet. Until it is, the sync
    // still does its job — the rows land and carry link_token — so a missing
    // function must not fail the whole pass.
    let stitched: number | null = null;
    try {
      stitched = await rpc("stitch_journey");
    } catch {
      stitched = null;
    }

    return {
      ok: true,
      contentPieces: pieces.length,
      instagramLeads: leads.length,
      stitched: typeof stitched === "number" ? stitched : null,
      windowFrom: since?.toISOString() ?? null,
    };
  } catch (err) {
    return {
      ok: false,
      contentPieces: 0,
      instagramLeads: 0,
      stitched: null,
      windowFrom: since?.toISOString() ?? null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
