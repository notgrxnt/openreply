/**
 * The pipeline: Reel → Comment → Lead → Webinar → Conversion.
 *
 * Deliberately free of any Prisma import. The pipeline view is a client
 * component and re-scopes in the browser when you click a reel, so this has to
 * be bundleable — pulling model.ts across would drag the database client into
 * the browser build. It takes rows that were already fetched and reshapes them.
 */

import type { ReelRow } from "./model";

export interface PipelineStage {
  key: "views" | "comments" | "leads" | "webinar" | "conversions";
  label: string;
  /** null means the stage is not instrumented — never render it as zero. */
  count: number | null;
  /** Shown in place of a drop-off figure when count is null. */
  note?: string;
}

export function buildPipeline(rows: ReelRow[]): PipelineStage[] {
  const sum = (pick: (r: ReelRow) => number | null) =>
    rows.reduce((acc, r) => acc + (pick(r) ?? 0), 0);

  // De-duplicate the funnel side by campaign: several reels can share one
  // campaign, and its signups must not be counted once per reel.
  const seen = new Set<string>();
  let signups = 0;
  let webinar = 0;
  let conversions = 0;
  for (const r of rows) {
    if (!r.campaignId || seen.has(r.campaignId)) continue;
    seen.add(r.campaignId);
    signups += r.campaignSignups;
    webinar += r.campaignWebinar;
    conversions += r.campaignConversions;
  }

  return [
    { key: "views", label: "Reel views", count: sum((r) => r.views) },
    { key: "comments", label: "Comments", count: sum((r) => r.comments) },
    { key: "leads", label: "Leads", count: signups },
    {
      key: "webinar",
      label: "Webinar invited",
      count: webinar,
      note: "invitations sent — registration is not instrumented",
    },
    { key: "conversions", label: "Conversions", count: conversions },
  ];
}
