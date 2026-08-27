"use client";

/**
 * Geography — the lead pipeline, by market.
 *
 * Built as a console, not a report. Every tile carries a verdict, every reel
 * row carries a threshold rule, and the sort is by CORE-MARKET leads rather
 * than total leads — because ranking by total is what let a reel that pulls
 * mostly the wrong country look like the best performer.
 *
 * Scope note that belongs on the page and not just in a doc: this is
 * geography at the LEAD level. Instagram exposes country only account-wide
 * (follower_demographics / engaged_audience_demographics) and per-media
 * insights accept no breakdown parameter, so a per-reel *view* geography does
 * not exist on any endpoint. Country here is resolved from each lead's browser
 * timezone, which is present on every row, rather than the free-text country
 * field, which is not.
 */

import { useEffect, useMemo, useState } from "react";
import type { ContentResponse } from "@/app/api/incension/content/route";
import type { GeographyResponse } from "@/app/api/incension/geography/route";
import type { ReelRow } from "@/incension/content/model";
import {
  ChartFrame,
  DataTable,
  Legend,
  SplitBar,
  StatTile,
  GEO_COLORS,
  GEO_LEGEND,
  statusForCoreShare,
  n,
  compact,
  pct,
} from "@/components/incension/chart-kit";

/** Above this share of non-core leads, a reel is actively costing you. */
const CORE_FLOOR = 0.4;

function title(row: ReelRow | undefined, fallback: string): string {
  if (!row?.caption) return fallback;
  const first = row.caption.split("\n")[0].trim();
  return first.length > 54 ? `${first.slice(0, 54)}…` : first;
}

function verdict(status: string, label: string) {
  return <span className={`verdict verdict-${status}`}>{label}</span>;
}

export default function GeographyPage() {
  const [geo, setGeo] = useState<GeographyResponse | null>(null);
  const [content, setContent] = useState<ContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/incension/geography").then((r) => r.json()),
      fetch("/api/incension/content").then((r) => r.json()),
    ])
      .then(([g, c]) => {
        if (!live) return;
        if (g.error && !g.cells) setError(g.error);
        else setGeo(g as GeographyResponse);
        if (!c.error) setContent(c as ContentResponse);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, []);

  /** utm_content → the reel that carries it, for titles and view counts. */
  const reelByUtm = useMemo(() => {
    const map = new Map<string, ReelRow>();
    for (const r of content?.rows ?? []) {
      if (!r.utmContent) continue;
      const existing = map.get(r.utmContent);
      // Several reels can share a catch-all campaign's utm_content. Keep the
      // newest so the label points at live work rather than the oldest reel.
      if (!existing || r.timestamp > existing.timestamp) map.set(r.utmContent, r);
    }
    return map;
  }, [content]);

  const rows = useMemo(() => {
    const list = (geo?.rollup ?? []).map((g) => {
      const reel = reelByUtm.get(g.utm_content);
      const share = g.leads > 0 ? g.core_leads / g.leads : null;
      return {
        ...g,
        reel,
        share,
        status: statusForCoreShare(share),
        label: title(reel, g.utm_content),
        views: reel?.views ?? null,
        /** The optimisation metric: core leads earned per 1,000 views. Total
         *  leads per 1,000 rewards reach into the wrong market. */
        corePerK:
          reel?.views && reel.views > 0
            ? (g.core_leads / reel.views) * 1000
            : null,
      };
    });
    return list.sort(
      (a, b) => b.core_leads - a.core_leads || (b.share ?? 0) - (a.share ?? 0)
    );
  }, [geo, reelByUtm]);

  const t = geo?.totals;
  const coreStatus = statusForCoreShare(t?.corePct ?? null);

  if (error) {
    return (
      <main className="p-8">
        <h1>
          Geography could not <em>load</em>.
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>{error}</p>
      </main>
    );
  }

  if (!geo) {
    return (
      <main className="p-8">
        <div
          style={{
            height: 200,
            background: "var(--sunken)",
            borderRadius: "var(--radius)",
            opacity: 0.55,
          }}
        />
      </main>
    );
  }

  return (
    <main className="p-8 flex flex-col" style={{ gap: 22, maxWidth: 1180 }}>
      <header>
        <span className="eyebrow">Lead pipeline · by market</span>
        <h1 style={{ marginTop: 10 }}>
          Where your leads actually <em>live</em>.
        </h1>
        <p style={{ marginTop: 8 }}>
          Resolved per lead from browser timezone, joined to the reel that
          produced it. Ranked by core-market leads, never by total.
        </p>
      </header>

      {/* ── The verdict row ──────────────────────────────────────────── */}
      <div className="station">
        <StatTile
          label="Core-market share"
          value={pct(t?.corePct ?? null, 0)}
          status={coreStatus}
          hint={
            <>
              {verdict(coreStatus, coreStatus)} {n(t?.core)} of {n(t?.leads)}{" "}
              leads
            </>
          }
        />
        <StatTile
          label="India share"
          value={pct(t?.indiaPct ?? null, 0)}
          accent={GEO_COLORS.india}
          hint={`${n(t?.india)} leads · the sway being managed`}
        />
        <StatTile
          label="Other markets"
          value={n(t?.other)}
          accent={GEO_COLORS.other}
          hint="Outside core and outside India"
        />
        <StatTile
          label="Unresolved"
          value={n(t?.unknown)}
          status={t && t.unknown > 0 ? "warning" : "neutral"}
          hint={
            t && t.unknown > 0
              ? "No timezone and no dialling code — excluded from every share above"
              : "Every lead resolved to a country"
          }
        />
      </div>

      {/* ── Per reel ─────────────────────────────────────────────────── */}
      <ChartFrame
        title="One bar per reel. The mix is the point."
        read={`Sorted by core-market leads. A reel below ${Math.round(CORE_FLOOR * 100)}% core is flagged — it is spending reach on people who will not buy.`}
        legend={<Legend items={GEO_LEGEND} />}
        table={
          <DataTable
            head={["Reel", "Leads", "Core", "India", "Other", "Core %", "Core / 1K views"]}
            rows={rows.map((r) => [
              r.label,
              n(r.leads),
              n(r.core_leads),
              n(r.india_leads),
              n(r.other_leads),
              pct(r.share, 0),
              r.corePerK === null ? "—" : r.corePerK.toFixed(2),
            ])}
          />
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reel</th>
                <th style={{ textAlign: "left", minWidth: 200 }}>Mix</th>
                <th style={{ textAlign: "right" }}>Leads</th>
                <th style={{ textAlign: "right" }}>Core</th>
                <th style={{ textAlign: "right" }}>Core %</th>
                <th style={{ textAlign: "right" }}>Core / 1K</th>
                <th style={{ textAlign: "right" }}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.utm_content} className={`row-${r.status}`}>
                  <td>
                    <span className="primary">{r.label}</span>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {r.utm_content}
                      {r.views ? ` · ${compact(r.views)} views` : ""}
                    </div>
                  </td>
                  <td style={{ minWidth: 200 }}>
                    <SplitBar
                      core={r.core_leads}
                      india={r.india_leads}
                      other={r.other_leads}
                    />
                  </td>
                  <td className="num">{n(r.leads)}</td>
                  <td className="num">{n(r.core_leads)}</td>
                  <td className="num">{pct(r.share, 0)}</td>
                  <td className="num">
                    {r.corePerK === null ? "—" : r.corePerK.toFixed(2)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {verdict(r.status, r.status)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartFrame>

      {/* ── Country roll ─────────────────────────────────────────────── */}
      <ChartFrame
        title="Every country that has produced a lead."
        read="Core markets carry the core hue. Tier-1 counts show whether a market sends quality, not just volume."
        legend={<Legend items={GEO_LEGEND.slice(0, 2)} />}
        table={
          <DataTable
            head={["Country", "Leads", "Tier 1", "Core market"]}
            rows={(geo.countries ?? []).map((c) => [
              c.country,
              n(c.leads),
              n(c.tier_1),
              c.core ? "yes" : "no",
            ])}
          />
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(geo.countries ?? []).map((c) => {
            const max = geo.countries[0]?.leads || 1;
            const color = c.core
              ? GEO_COLORS.core
              : c.country === "IN"
                ? GEO_COLORS.india
                : GEO_COLORS.other;
            return (
              <div
                key={c.country}
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
                <div
                  style={{
                    width: 74,
                    flexShrink: 0,
                    fontSize: 12,
                    letterSpacing: "0.06em",
                    color: "var(--ink-2)",
                  }}
                >
                  {c.country}
                </div>
                <div style={{ flex: 1 }}>
                  <div
                    title={`${c.country}: ${c.leads} leads`}
                    style={{
                      width: `${Math.max((c.leads / max) * 100, 2)}%`,
                      height: 16,
                      background: color,
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div
                  className="num"
                  style={{ width: 52, textAlign: "right", fontSize: 14 }}
                >
                  {n(c.leads)}
                </div>
                <div
                  style={{
                    width: 60,
                    textAlign: "right",
                    fontSize: 12,
                    color: "var(--muted)",
                  }}
                >
                  {c.tier_1 > 0 ? `${c.tier_1} T1` : "—"}
                </div>
              </div>
            );
          })}
        </div>
      </ChartFrame>

      {/* ── Scope ────────────────────────────────────────────────────── */}
      <section className="panel" style={{ padding: "22px 26px" }}>
        <h3 style={{ fontSize: 19, margin: 0 }}>
          What this is measuring, <em>exactly</em>.
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))",
            gap: 20,
            marginTop: 14,
          }}
        >
          <div>
            <span className="eyebrow">Leads, not views</span>
            <p style={{ marginTop: 6 }}>
              Instagram publishes country account-wide only. Per-media insights
              accept no breakdown parameter, so a per-reel <em>view</em>{" "}
              geography does not exist on any endpoint. This is the real
              per-reel geography — one step further down the funnel, and the
              step that decides revenue.
            </p>
          </div>
          <div>
            <span className="eyebrow">Timezone, not the country field</span>
            <p style={{ marginTop: 6 }}>
              The typed country field holds <code>India</code>,{" "}
              <code>INDIA</code>, <code>US</code> and <code>United States</code>{" "}
              and is empty on a third of rows. Browser timezone is present on
              every lead and resolves cleanly. Unresolved leads are counted
              separately, never folded into &ldquo;other&rdquo;.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
