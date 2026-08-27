"use client";

/**
 * Pipeline — Reel → Comment → Lead → Webinar → Conversion.
 *
 * The view the tool exists to produce. Five horizontal bars from a common left
 * baseline, not a tapered cone: a cone encodes value as area with no shared
 * baseline, so a 40% drop and a 60% drop look nearly the same. Bars from one
 * baseline are honest, and are what the ordinal ramp was validated for.
 *
 * Linear by default even though stage 1 dwarfs stage 5 — the dwarfing IS the
 * finding. The proportional toggle re-bases each stage against the one above.
 *
 * Scope is a filter, never a different component: the same bars serve the whole
 * account and a single reel. Clicking a leaderboard row re-scopes them.
 */

import { useEffect, useMemo, useState } from "react";
import type { ContentResponse } from "@/app/api/incension/content/route";
import type { ReelRow } from "@/incension/content/model";
import { buildPipeline } from "@/incension/content/pipeline";
import {
  ChartFrame,
  DataTable,
  MiniStages,
  StageBars,
  Legend,
  STAGE_COLORS,
  n,
  compact,
  pct,
  money,
} from "@/components/incension/chart-kit";

function title(row: ReelRow): string {
  if (!row.caption) return "(no caption)";
  const first = row.caption.split("\n")[0].trim();
  return first.length > 58 ? `${first.slice(0, 58)}…` : first;
}

function age(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "1d";
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export default function PipelinePage() {
  const [data, setData] = useState<ContentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proportional, setProportional] = useState(false);
  const [scope, setScope] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/incension/content")
      .then((r) => r.json())
      .then((j) => {
        if (!live) return;
        if (j.error) setError(j.error);
        else setData(j as ContentResponse);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, []);

  const era2 = useMemo(
    () => (data?.rows ?? []).filter((r) => r.era === 2),
    [data]
  );

  const scoped = useMemo(
    () => (scope ? era2.filter((r) => r.mediaId === scope) : era2),
    [era2, scope]
  );

  const stages = useMemo(() => buildPipeline(scoped), [scoped]);

  const scopedRow = scope ? era2.find((r) => r.mediaId === scope) : null;

  /** Automations that sent DMs and produced no clicks — silent failure today. */
  const deadEnds = useMemo(
    () =>
      era2.filter(
        (r) => (r.dmsSent ?? 0) >= 5 && (r.uniqueClickers ?? 0) === 0
      ),
    [era2]
  );

  const leaderboard = useMemo(
    () =>
      [...era2]
        .filter((r) => r.comments > 0 || (r.dmsSent ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.conversions ?? 0) - (a.conversions ?? 0) ||
            (b.campaignSignups ?? 0) - (a.campaignSignups ?? 0) ||
            b.comments - a.comments
        ),
    [era2]
  );

  if (error) {
    return (
      <main className="p-8">
        <h1>
          The pipeline could not <em>load</em>.
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
          {error}
        </p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="p-8">
        <div
          style={{
            height: 220,
            background: "var(--sunken)",
            borderRadius: "var(--radius)",
            opacity: 0.55,
          }}
        />
      </main>
    );
  }

  const stageItems = stages.map((s, i) => ({
    label: s.label,
    count: s.count,
    color: STAGE_COLORS[i],
    note: s.note,
  }));

  return (
    <main className="p-8 flex flex-col" style={{ gap: 28, maxWidth: 1180 }}>
      <header>
        <span className="eyebrow">Era 2 · since 12 Aug 2026</span>
        <h1 style={{ marginTop: 10 }}>
          Where the system <em>leaks</em>.
        </h1>
        <p style={{ marginTop: 8 }}>
          Every stage from a reel being watched to money arriving. Step rates,
          not cumulative — cumulative hides which single step is losing people.
        </p>
      </header>

      {/* ── The pipeline ─────────────────────────────────────────────── */}
      <ChartFrame
        title={
          scopedRow
            ? `${title(scopedRow)} — stage by stage.`
            : "Most of what you reach never reaches you."
        }
        read={
          scopedRow
            ? `One reel, ${age(scopedRow.ageDays)} old. Click the scope chip to return to the whole account.`
            : "Read the step percentages between rows. The biggest single drop is the one worth fixing first."
        }
        legend={
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <Legend
              items={stageItems.map((s, i) => ({
                label: s.label,
                color: STAGE_COLORS[i],
              }))}
            />
            <div className="flex items-center gap-2">
              {scope ? (
                <button
                  type="button"
                  onClick={() => setScope(null)}
                  style={chipStyle(true)}
                >
                  Scoped to one reel ✕
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setProportional((v) => !v)}
                aria-pressed={proportional}
                style={chipStyle(proportional)}
              >
                Proportional
              </button>
            </div>
          </div>
        }
        table={
          <DataTable
            head={["Stage", "Count", "Step rate", "Dropped"]}
            rows={stages.map((s, i) => {
              const prev = i > 0 ? stages[i - 1] : null;
              const rate =
                prev?.count && s.count !== null && prev.count > 0
                  ? s.count / prev.count
                  : null;
              const dropped =
                prev?.count !== null &&
                prev?.count !== undefined &&
                s.count !== null
                  ? prev.count - s.count
                  : null;
              return [
                s.label,
                s.count === null ? "n/a" : n(s.count),
                i === 0 ? "—" : pct(rate),
                i === 0 ? "—" : dropped === null ? "—" : n(dropped),
              ];
            })}
          />
        }
      >
        <StageBars stages={stageItems} proportional={proportional} />
      </ChartFrame>

      {/* ── What is not instrumented ─────────────────────────────────── */}
      <section className="panel" style={{ padding: "24px 26px" }}>
        <h3 style={{ fontSize: 20, margin: 0 }}>
          Two stages are thinner than they <em>look</em>.
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 20,
            marginTop: 16,
          }}
        >
          <div>
            <span className="eyebrow">Webinar</span>
            <p style={{ marginTop: 6 }}>
              This counts invitations <em>sent</em>. Registration and attendance
              are not stored anywhere — no event, no table, no import. A
              &ldquo;registered&rdquo; figure would be invented, so there isn&rsquo;t one.
            </p>
          </div>
          <div>
            <span className="eyebrow">Conversion</span>
            <p style={{ marginTop: 6 }}>
              Real, from the clients table, with prices. But it only resolves
              for campaigns whose traffic carried a utm_content. Historic revenue
              sits on untracked visits and cannot be attributed backwards.
            </p>
          </div>
        </div>
      </section>

      {/* ── Content leaderboard ──────────────────────────────────────── */}
      <ChartFrame
        title="Comments and conversions do not rank the same."
        read="Sorted by conversions, not comments — the divergence is the point. Click a row to scope the pipeline above to that reel."
        table={
          <DataTable
            head={[
              "Reel",
              "Views",
              "Comments",
              "Cmt %",
              "Leads",
              "Conversions",
              "Revenue",
            ]}
            rows={leaderboard.map((r) => [
              title(r),
              compact(r.views),
              n(r.comments),
              pct(r.commentRate),
              r.signups === null ? "—" : n(r.signups),
              r.conversions === null ? "—" : n(r.conversions),
              r.revenueCents === null ? "—" : money(r.revenueCents),
            ])}
          />
        }
      >
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Reel</th>
                <th style={{ textAlign: "left" }}>Funnel</th>
                <th style={{ textAlign: "right" }}>Views</th>
                <th style={{ textAlign: "right" }}>Comments</th>
                <th style={{ textAlign: "right" }}>Cmt %</th>
                <th style={{ textAlign: "right" }}>Leads</th>
                <th style={{ textAlign: "right" }}>Conv.</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.map((r) => (
                <tr
                  key={r.mediaId}
                  onClick={() => setScope(r.mediaId)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <span className="primary">{title(r)}</span>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {age(r.ageDays)}
                    </div>
                  </td>
                  <td>
                    <MiniStages
                      counts={[
                        r.views,
                        r.comments,
                        r.signups,
                        r.webinarInvited,
                        r.conversions,
                      ]}
                      colors={STAGE_COLORS}
                    />
                  </td>
                  <td className="num">{compact(r.views)}</td>
                  <td className="num">{n(r.comments)}</td>
                  <td className="num">{pct(r.commentRate)}</td>
                  <td className="num">
                    {r.signups === null ? "—" : n(r.signups)}
                  </td>
                  <td className="num">
                    {r.conversions === null ? "—" : n(r.conversions)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartFrame>

      {/* ── Dead ends ────────────────────────────────────────────────── */}
      <section className="panel" style={{ padding: "24px 26px" }}>
        <h3 style={{ fontSize: 20, margin: 0 }}>
          Reels that sent DMs and produced <em>nothing</em>.
        </h3>
        <p style={{ marginTop: 6, color: "var(--muted)", fontSize: 13 }}>
          Five or more DMs delivered, zero distinct people clicked. This fails
          silently today — nothing surfaces it anywhere else.
        </p>
        <div style={{ marginTop: 16 }}>
          {deadEnds.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
              None. Every reel that sent DMs got at least one click.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Reel</th>
                  <th style={{ textAlign: "right" }}>DMs</th>
                  <th style={{ textAlign: "right" }}>Clicks</th>
                  <th style={{ textAlign: "right" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {deadEnds.map((r) => (
                  <tr key={r.mediaId}>
                    <td className="primary">{title(r)}</td>
                    <td className="num">{n(r.dmsSent)}</td>
                    <td className="num">0</td>
                    <td style={{ textAlign: "right" }}>
                      <span className="pill is-failed">No clicks</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    letterSpacing: "0.16em",
    textTransform: "uppercase",
    padding: "7px 13px",
    borderRadius: "var(--radius-sm)",
    border: `1px solid ${active ? "var(--ink)" : "var(--line-strong)"}`,
    background: active ? "var(--ink)" : "transparent",
    color: active ? "var(--surface)" : "var(--ink-2)",
    cursor: "pointer",
  };
}
