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
        "INCENSION_SUPABASE_URL / INCENSION_SUPABASE_SERVICE_KEY are not set",
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
      await upsert("content_pieces", pieces, "platform_post_id");
    }

    const leads = await collectInstagramLeads(since);
    if (leads.length) {
      await upsert("instagram_leads", leads, "automation_id,comment_id");
    }

    // Resolve commenter -> lead -> profile -> order, and push the creative down
    // the chain. Lives in Supabase because it only touches Health's own tables.
    const stitched = await rpc("stitch_journey");

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
