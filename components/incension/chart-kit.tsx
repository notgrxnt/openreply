"use client";

/**
 * Chart primitives for the Content OS.
 * ============================================================================
 *
 * Hand-authored SVG on purpose. `recharts` is already in the tree, but it is
 * there for one upstream component (follower-chart) and its default theme
 * breaks most of the mark spec: dashed gridlines, cycled hues, borders drawn
 * around marks to separate them, tooltips as the only path to a value. We need
 * to control every mark, so we draw them.
 *
 * The specs these enforce, so they are not re-litigated per chart:
 *   · bars ≤ 24px thick, 4px rounded at the DATA end, square at the baseline
 *   · 2px gap in the surface colour between touching fills — never a border
 *   · gridlines 1px solid hairline, never dashed
 *   · text always wears an ink token, never a series colour
 *   · every chart ships a table view; tooltips enhance, never gate
 *   · charts draw in once on mount and do NOT re-animate on filter change,
 *     because re-animating makes before/after comparison impossible
 */

import { useId, useState, type ReactNode } from "react";

/* ── Formatting ──────────────────────────────────────────────────────── */

export function n(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US");
}

export function compact(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US");
}

export function pct(v: number | null | undefined, dp = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const p = v * 100;
  return `${p.toFixed(p >= 10 ? Math.max(0, dp - 1) : dp)}%`;
}

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/* ── A bar with one rounded end ──────────────────────────────────────── */

/**
 * Square at the baseline, rounded at the data end. A fully rounded bar reads as
 * a pill and loses the baseline; a fully square one reads as a table cell.
 */
function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  if (w <= 0) return "";
  return [
    `M${x},${y}`,
    `H${x + w - rr}`,
    `Q${x + w},${y} ${x + w},${y + rr}`,
    `V${y + h - rr}`,
    `Q${x + w},${y + h} ${x + w - rr},${y + h}`,
    `H${x}`,
    "Z",
  ].join(" ");
}

/* ── Chart frame: title that states the finding, one-line read, table view ── */

export function ChartFrame({
  title,
  read,
  children,
  table,
  legend,
}: {
  /** States the finding, not the fields. "Most comments don't become leads." */
  title: string;
  /** One line under the title: what the reader should take from it. */
  read?: string;
  children: ReactNode;
  /** Mandatory. Tooltips enhance, never gate — and the yellow relief rule depends on it. */
  table: ReactNode;
  legend?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();

  return (
    <figure className="panel" style={{ padding: "24px 26px", margin: 0 }}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h3 style={{ fontSize: 20, margin: 0 }}>{title}</h3>
          {read ? (
            <p
              id={`${id}-read`}
              style={{
                fontSize: 13,
                color: "var(--muted)",
                margin: "6px 0 0",
                maxWidth: "62ch",
              }}
            >
              {read}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          className="shrink-0"
          style={{
            fontSize: 10,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--ink-2)",
            background: "transparent",
            border: "1px solid var(--line-strong)",
            borderRadius: "var(--radius-sm)",
            padding: "7px 13px",
            cursor: "pointer",
          }}
        >
          {showTable ? "Chart" : "Table"}
        </button>
      </div>

      {legend ? <div style={{ marginTop: 16 }}>{legend}</div> : null}

      <div style={{ marginTop: 18 }} aria-describedby={read ? `${id}-read` : undefined}>
        {showTable ? table : children}
      </div>
    </figure>
  );
}

/* ── Legend. Colour lives in the mark; the text stays ink. ───────────── */

export function Legend({
  items,
}: {
  items: Array<{ label: string; color: string }>;
}) {
  if (items.length < 2) return null; // a single series is named by the title
  return (
    <ul
      className="flex flex-wrap gap-x-5 gap-y-2"
      style={{ listStyle: "none", padding: 0, margin: 0 }}
    >
      {items.map((it) => (
        <li
          key={it.label}
          className="flex items-center gap-2"
          style={{ fontSize: 12, color: "var(--ink-2)" }}
        >
          <span
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: it.color,
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ── Stage bars — the pipeline ───────────────────────────────────────── */

export interface Stage {
  label: string;
  count: number | null;
  color: string;
  /** Rendered instead of a bar when the stage has no data behind it. */
  note?: string;
}

/**
 * Horizontal bars from a common left baseline, in stage order.
 *
 * NOT a tapered cone: a cone encodes value as area with no shared baseline, so
 * a 40% drop and a 60% drop look nearly identical. Bars from one baseline are
 * honest, and are what the ordinal ramp was validated for.
 *
 * Linear by default even when stage 1 dwarfs stage 5 — the dwarfing IS the
 * finding. `proportional` re-bases each stage against the one above it.
 */
export function StageBars({
  stages,
  proportional = false,
}: {
  stages: Stage[];
  proportional?: boolean;
}) {
  const known = stages.filter((s) => s.count !== null) as Array<
    Stage & { count: number }
  >;
  const max = Math.max(1, ...known.map((s) => s.count));

  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1] : null;
        const step =
          prev && prev.count && s.count !== null && prev.count > 0
            ? s.count / prev.count
            : null;
        const dropped =
          prev && prev.count !== null && s.count !== null
            ? prev.count - s.count
            : null;

        const base = proportional && prev?.count ? prev.count : max;
        const frac =
          s.count === null || base <= 0 ? 0 : Math.min(1, s.count / base);

        return (
          <div key={s.label}>
            {/* Step conversion between rows. Step, not cumulative —
                cumulative hides which single step is leaking. */}
            {i > 0 ? (
              <div
                className="flex items-baseline gap-3"
                style={{
                  padding: "6px 0 6px 2px",
                  borderLeft: "1px solid var(--line)",
                  marginLeft: 6,
                  paddingLeft: 14,
                }}
              >
                <span style={{ fontSize: 13, color: "var(--ink)" }}>
                  {step === null ? "—" : pct(step)}
                </span>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  {dropped === null
                    ? s.note ?? "not instrumented"
                    : `↓ ${n(dropped)} dropped`}
                </span>
              </div>
            ) : null}

            <div className="flex items-center gap-4">
              <div
                style={{
                  width: 150,
                  flexShrink: 0,
                  fontSize: 12,
                  color: "var(--muted)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {s.label}
              </div>

              <div className="flex-1 min-w-0">
                <svg
                  width="100%"
                  height="24"
                  viewBox="0 0 100 24"
                  preserveAspectRatio="none"
                  role="img"
                  aria-label={`${s.label}: ${s.count === null ? "not instrumented" : n(s.count)}`}
                  style={{ display: "block", overflow: "visible" }}
                >
                  {s.count === null ? (
                    <rect
                      x="0"
                      y="7"
                      width="100"
                      height="10"
                      fill="var(--sunken)"
                      rx="2"
                    />
                  ) : (
                    <path
                      d={barPath(0, 0, Math.max(frac * 100, 0.4), 24, 1.2)}
                      fill={s.color}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                </svg>
              </div>

              {/* Every bar is direct-labeled. Five rows is few enough, and a
                  funnel's whole point is the numbers. */}
              <div
                style={{
                  width: 92,
                  flexShrink: 0,
                  textAlign: "right",
                  fontSize: 15,
                  color: s.count === null ? "var(--muted)" : "var(--ink)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.count === null ? "n/a" : n(s.count)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── Horizontal bar list — "how much, across named things" ───────────── */

export function BarList({
  rows,
  color = "var(--series-1)",
  format = compact,
}: {
  rows: Array<{ label: string; value: number; href?: string; color?: string }>;
  color?: string;
  format?: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  if (rows.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
        Nothing in this window yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col" style={{ gap: 2 }}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-4">
          <div
            style={{
              width: 200,
              flexShrink: 0,
              fontSize: 13,
              color: "var(--ink-2)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={r.label}
          >
            {r.label}
          </div>
          <div className="flex-1 min-w-0">
            <svg
              width="100%"
              height="20"
              viewBox="0 0 100 20"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${r.label}: ${format(r.value)}`}
              style={{ display: "block", overflow: "visible" }}
            >
              <path
                d={barPath(0, 2, Math.max((r.value / max) * 100, 0.3), 16, 1)}
                fill={r.color ?? color}
              />
            </svg>
          </div>
          <div
            style={{
              width: 72,
              flexShrink: 0,
              textAlign: "right",
              fontSize: 13,
              color: "var(--ink)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {format(r.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Mini stage sparkline — the funnel SHAPE, scannable down a column ── */

/**
 * Each bar is that stage's conversion from the stage above it, not its absolute
 * count.
 *
 * Absolute was the first instinct and it does not work: at 84px wide, a
 * 7,700 → 10 funnel renders every stage after the first as a sub-pixel sliver,
 * so every row looks identical and the column carries no information. Step
 * rates make rows comparable — which is the only reason this mark exists — and
 * the absolute numbers are already in the columns beside it.
 *
 * The first bar is always full width: stage one is the denominator.
 */
export function MiniStages({
  counts,
  colors,
}: {
  counts: Array<number | null>;
  colors: string[];
}) {
  const W = 84;
  const rates = counts.map((c, i) => {
    if (i === 0) return c === null ? null : 1;
    const prev = counts[i - 1];
    if (c === null || prev === null || prev <= 0) return null;
    return Math.min(1, c / prev);
  });

  const label = counts
    .map((c, i) => (c === null ? "n/a" : `${c}`))
    .join(" then ");

  return (
    <svg
      width={W}
      height="16"
      role="img"
      aria-label={`Funnel shape, step rates. Counts: ${label}`}
      style={{ display: "block" }}
    >
      {rates.map((r, i) => (
        <rect
          key={i}
          x={0}
          y={i * 3.2}
          width={r === null ? W : Math.max(r * W, 1.5)}
          height={2.4}
          rx={1.2}
          fill={r === null ? "var(--sunken)" : colors[i]}
        />
      ))}
    </svg>
  );
}

/* ── Table view, shared shape ────────────────────────────────────────── */

export function DataTable({
  head,
  rows,
}: {
  head: string[];
  rows: Array<Array<ReactNode>>;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={i === 0 ? undefined : { textAlign: "right" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className={j === 0 ? undefined : "num"}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const STAGE_COLORS = [
  "var(--stage-1)",
  "var(--stage-2)",
  "var(--stage-3)",
  "var(--stage-4)",
  "var(--stage-5)",
];

export const SERIES = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
];

/* ── Geography ──────────────────────────────────────────────────────────── */

/**
 * The three market buckets. Validated as a categorical trio against the light
 * surface (#fafafa): lightness band, chroma floor, CVD separation (worst
 * adjacent ΔE 19.6 protan) and 3:1 contrast all pass. Do not substitute a grey
 * for "Other" — grey fails the chroma floor and collapses to ΔE 4.4 against
 * the India hue under deuteranopia.
 */
export const GEO_COLORS = {
  core: "var(--geo-core)",
  india: "var(--geo-india)",
  other: "var(--geo-other)",
} as const;

export const GEO_LEGEND = [
  { label: "Core market", color: GEO_COLORS.core },
  { label: "India", color: GEO_COLORS.india },
  { label: "Other", color: GEO_COLORS.other },
];

/**
 * One reel's lead mix as a single stacked bar.
 *
 * Proportional, not absolute: the question this answers is "what share of this
 * reel's leads are worth having", and reels with very different lead counts
 * must stay comparable. Absolute volume is carried by the adjacent number.
 *
 * 2px surface gaps between segments so adjacent fills never touch, per the
 * mark spec. Segments under 6% still render at 6% width with the true value in
 * the tooltip — a 1-lead segment that rounds to nothing would read as zero.
 */
export function SplitBar({
  core,
  india,
  other,
  height = 22,
}: {
  core: number;
  india: number;
  other: number;
  height?: number;
}) {
  const total = core + india + other;
  if (total <= 0) {
    return (
      <div
        style={{
          height,
          background: "var(--sunken)",
          borderRadius: "var(--radius-sm)",
        }}
        aria-label="No leads"
      />
    );
  }

  const parts = [
    { key: "core", label: "Core market", value: core, color: GEO_COLORS.core },
    { key: "india", label: "India", value: india, color: GEO_COLORS.india },
    { key: "other", label: "Other", value: other, color: GEO_COLORS.other },
  ].filter((p) => p.value > 0);

  return (
    <div
      style={{ display: "flex", gap: 2, height, width: "100%" }}
      role="img"
      aria-label={parts
        .map((p) => `${p.label} ${p.value} of ${total}`)
        .join(", ")}
    >
      {parts.map((p, i) => (
        <div
          key={p.key}
          title={`${p.label}: ${p.value} of ${total} (${((p.value / total) * 100).toFixed(0)}%)`}
          style={{
            flexGrow: Math.max(p.value / total, 0.06),
            flexBasis: 0,
            background: p.color,
            borderTopLeftRadius: i === 0 ? 4 : 0,
            borderBottomLeftRadius: i === 0 ? 4 : 0,
            borderTopRightRadius: i === parts.length - 1 ? 4 : 0,
            borderBottomRightRadius: i === parts.length - 1 ? 4 : 0,
          }}
        />
      ))}
    </div>
  );
}

export type Status = "good" | "warning" | "critical" | "neutral";

/**
 * Threshold verdict for a share of leads. Status hue is RESERVED — it never
 * doubles as a categorical slot, and it never travels without the label beside
 * it, so the reading survives colorblindness and greyscale print.
 */
export function statusForCoreShare(share: number | null): Status {
  if (share === null) return "neutral";
  if (share >= 0.6) return "good";
  if (share >= 0.4) return "warning";
  return "critical";
}

/**
 * Battle-station tile: one number, big, with the verdict attached.
 *
 * `hint` is the sentence that says what to do about it — a tile that reports a
 * number without a threshold is a number the reader has to interpret under
 * pressure, which is the thing this view exists to prevent.
 */
export function StatTile({
  label,
  value,
  hint,
  status = "neutral",
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  status?: Status;
  accent?: string;
}) {
  return (
    <div className={`stat stat-${status}`}>
      <span className="eyebrow" style={{ display: "block", marginBottom: 10 }}>
        {label}
      </span>
      <div className="n" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {hint ? <div className="meta">{hint}</div> : null}
    </div>
  );
}
