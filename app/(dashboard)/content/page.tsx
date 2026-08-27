"use client";

/**
 * Content — reel performance joined to lead outcomes.
 *
 * Instagram already shows views. The reason this page exists is the join:
 * which reels produce DMs, clicks and actual leads. Two pillars, in the order
 * they matter day to day —
 *
 *   1. What's working now — ranked on last-24h movement, so it answers
 *      "what should I do today" rather than "what happened this quarter".
 *   2. Full funnel per reel — every reel as a row, reach through to signups.
 *
 * Lead quality runs underneath both rather than leading, per how Grant wants
 * to read it: present in every row, never the headline.
 */

import { useEffect, useState } from "react";
import StatCard from "@/components/stat-card";
import type { ContentResponse } from "@/app/api/incension/content/route";
import type { ReelRow } from "@/incension/content/model";

function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Average watch time. The one metric that predicts breaking past your own followers. */
function secs(v: number | null): string {
  if (v === null) return "—";
  return `${v.toFixed(1)}s`;
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(v * 100 >= 10 ? 0 : 1)}%`;
}

function age(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

/** Truncate a caption to its first meaningful line. */
function title(row: ReelRow): string {
  if (!row.caption) return "(no caption)";
  const firstLine = row.caption.split("\n")[0].trim();
  return firstLine.length > 64 ? `${firstLine.slice(0, 64)}…` : firstLine;
}

function Thumb({ row }: { row: ReelRow }) {
  if (!row.thumbnailUrl) {
    return <div className="w-10 h-10 rounded bg-[var(--wash)] shrink-0" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={row.thumbnailUrl}
      alt=""
      className="w-10 h-10 rounded object-cover shrink-0"
    />
  );
}

function WorkingCard({ row }: { row: ReelRow }) {
  const moving = row.dmsLast24h + row.clicksLast24h;
  return (
    <div className="panel rounded p-4 flex gap-3">
      <Thumb row={row} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {row.isLive && (
            <span className="text-[10px] uppercase tracking-wider text-success">
              live
            </span>
          )}
          <span className="text-xs text-muted">{age(row.ageDays)}</span>
        </div>
        <p className="text-sm text-foreground truncate mt-0.5">{title(row)}</p>

        {row.campaignId ? (
          <p className="text-xs text-muted mt-1">
            {row.dmsLast24h} DM{row.dmsLast24h === 1 ? "" : "s"} ·{" "}
            {row.clicksLast24h} click{row.clicksLast24h === 1 ? "" : "s"} in 24h
            {moving === 0 && " · quiet"}
          </p>
        ) : (
          <p className="text-xs text-error mt-1">
            no campaign · {row.comments} comment
            {row.comments === 1 ? "" : "s"} unclaimed
          </p>
        )}

        <div className="flex gap-3 text-xs text-muted mt-2">
          <span>{num(row.views)} views</span>
          <span>{row.dmsSent} DMs</span>
          <span>{pct(row.ctr)} CTR</span>
          <span>
            {row.signups} lead{row.signups === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ContentPage() {
  const [data, setData] = useState<ContentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/incension/content?count=40")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || "Failed to load");
        return json as ContentResponse;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-muted">Loading content performance…</p>;
  }
  if (error) {
    return <p className="text-error">{error}</p>;
  }
  if (!data) return null;

  const { totals, working, unclaimed, rows } = data;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Content</h1>
        <p className="text-sm text-muted mt-1">
          Reels joined to DMs, clicks and leads — the part Instagram can&apos;t
          show you.
        </p>
      </div>

      {!data.funnelOk && (
        <div className="panel rounded p-3 text-xs text-muted">
          Funnel data unavailable — showing reach, DMs and clicks only.
          {data.funnelError ? ` (${data.funnelError})` : ""}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Moving (24h)" value={totals.dmsLast24h + totals.clicksLast24h} />
        <StatCard label="DMs sent" value={num(totals.dmsSent)} />
        <StatCard label="Clicks" value={num(totals.clicks)} />
        <StatCard label="Leads" value={num(totals.signups)} />
        <StatCard label="Qualified" value={num(totals.qualified)} />
      </div>

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          What&apos;s working now
        </h2>
        {working.length === 0 ? (
          <p className="text-sm text-muted">
            Nothing has moved in the last 24 hours.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {working.map((r) => (
              <WorkingCard key={r.mediaId} row={r} />
            ))}
          </div>
        )}
      </section>

      {unclaimed.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-1">
            Unclaimed reels
          </h2>
          <p className="text-sm text-muted mb-3">
            Getting comments with no campaign attached — these are leads
            falling on the floor.
          </p>
          <div className="grid md:grid-cols-2 gap-3">
            {unclaimed.slice(0, 4).map((r) => (
              <WorkingCard key={r.mediaId} row={r} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-foreground mb-3">
          Full funnel per reel
        </h2>
        <p className="text-xs text-muted mb-3">
          Era 2 — everything since the restart on 12 Aug 2026. Era 1 is vaulted
          below.
        </p>
        <div className="panel rounded overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-[var(--border)]">
                <th className="px-4 py-3 font-medium">Reel</th>
                <th className="px-3 py-3 font-medium text-right">Views</th>
                <th className="px-3 py-3 font-medium text-right">Watch</th>
                <th className="px-3 py-3 font-medium text-right">Comments</th>
                <th className="px-3 py-3 font-medium text-right">Cmt %</th>
                <th className="px-3 py-3 font-medium text-right">DMs</th>
                <th className="px-3 py-3 font-medium text-right">Clicks</th>
                <th className="px-3 py-3 font-medium text-right">CTR</th>
                <th className="px-3 py-3 font-medium text-right">Leads</th>
                <th className="px-3 py-3 font-medium text-right">Qual.</th>
                <th className="px-3 py-3 font-medium text-right">Core</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.era === 2).map((r) => (
                <tr
                  key={r.mediaId}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Thumb row={r} />
                      <div className="min-w-0">
                        <p className="text-foreground truncate max-w-[22rem]">
                          {r.permalink ? (
                            <a
                              href={r.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {title(r)}
                            </a>
                          ) : (
                            title(r)
                          )}
                        </p>
                        <p className="text-xs text-muted">
                          {age(r.ageDays)}
                          {r.campaignName
                            ? ` · ${r.keywords.join(", ") || r.campaignName}`
                            : " · no campaign"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">{num(r.views)}</td>
                  <td className="px-3 py-3 text-right">{secs(r.avgWatchSeconds)}</td>
                  <td className="px-3 py-3 text-right">{num(r.comments)}</td>
                  <td className="px-3 py-3 text-right">{pct(r.commentRate)}</td>
                  <td className="px-3 py-3 text-right">{num(r.dmsSent)}</td>
                  <td className="px-3 py-3 text-right">{num(r.clicks)}</td>
                  <td className="px-3 py-3 text-right">{pct(r.ctr)}</td>
                  <td className="px-3 py-3 text-right">{num(r.signups)}</td>
                  <td className="px-3 py-3 text-right">
                    {r.signups ? num(r.qualified) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right text-muted">
                    {r.signups ? `${r.coreMarket}/${r.signups}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted mt-2">
          Watch = average seconds viewed, the signal Instagram uses to decide
          whether to push a reel past your own followers. Cmt % = comments ÷
          views, the CTA metric that compares across eras.
          CTR = distinct people who clicked ÷ DMs sent, so it cannot exceed
          100%. Qual. = tier 1–2 leads. Core = signups from your core markets.
          A dash under DMs means that reel is served by the catch-all campaign
          and predates per-reel attribution — the number is genuinely unknown
          rather than zero.
        </p>
      </section>

      <section className="mt-8">
        <details className="panel rounded p-4">
          <summary className="cursor-pointer text-sm font-medium text-foreground">
            Era 1 vault — before the restart
            <span className="text-muted font-normal">
              {" "}
              · benchmarks only, excluded from every figure above
            </span>
          </summary>
          <p className="text-xs text-muted mt-3 mb-3">
            The account at full reach. DM columns are omitted on purpose: these
            reels ran under different campaigns, or none, and their comment
            counts are what carry forward. Use this for what a working hook
            looked like at scale, not for how this week is going.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-[var(--border)]">
                  <th className="px-4 py-2 font-medium">Reel</th>
                  <th className="px-3 py-2 font-medium text-right">Views</th>
                  <th className="px-3 py-2 font-medium text-right">Comments</th>
                  <th className="px-3 py-2 font-medium text-right">Cmt %</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .filter((r) => r.era === 1)
                  .map((r) => (
                    <tr
                      key={r.mediaId}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-4 py-2">
                        <p className="text-foreground truncate max-w-[26rem]">
                          {r.permalink ? (
                            <a
                              href={r.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              {title(r)}
                            </a>
                          ) : (
                            title(r)
                          )}
                        </p>
                        <p className="text-xs text-muted">{age(r.ageDays)}</p>
                      </td>
                      <td className="px-3 py-2 text-right">{num(r.views)}</td>
                      <td className="px-3 py-2 text-right">
                        {num(r.comments)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {pct(r.commentRate)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </div>
  );
}
