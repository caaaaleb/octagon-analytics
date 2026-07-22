"use client";

import { useMemo, useState } from "react";
import type { OddsHistoryPoint } from "@/lib/upcoming-card";

// Categorical palette (dataviz skill's reference palette, dark-mode steps,
// validated against our own surface #141414 — see skill's validate_palette.js).
// Fixed order, never cycled or reassigned per filter.
const SERIES_COLORS = [
  "#3987e5", // blue
  "#199e70", // aqua
  "#c98500", // yellow
  "#008300", // green
  "#9085e9", // violet
  "#e66767", // red
  "#d55181", // magenta
  "#d95926", // orange
];

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 12, right: 16, bottom: 24, left: 36 };

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LineMovementChart({ fighterAName, history }: { fighterAName: string; history: OddsHistoryPoint[] }) {
  const [showTable, setShowTable] = useState(false);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const books = useMemo(() => Array.from(new Set(history.map((h) => h.sportsbook))), [history]);
  const timestamps = useMemo(
    () => Array.from(new Set(history.map((h) => h.fetchedAt))).sort(),
    [history]
  );

  const seriesByBook = useMemo(() => {
    const map = new Map<string, OddsHistoryPoint[]>();
    for (const book of books) {
      map.set(
        book,
        history.filter((h) => h.sportsbook === book).sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt))
      );
    }
    return map;
  }, [books, history]);

  if (history.length === 0) {
    return <p className="mt-3 border-t border-border pt-3 text-sm text-muted">No odds history yet.</p>;
  }

  // A real time scale breaks down for odds history: one sync run writes all
  // books within milliseconds of each other, but runs themselves land
  // hours or days apart (and can be very lopsided — one early check plus a
  // cluster of recent ones). Plotting by elapsed time either squashes a
  // whole run into one pixel or lets a single old outlier stretch every
  // other point into an invisible sliver at one edge — reading as "just a
  // straight line" either way. Instead, cluster timestamps into distinct
  // sync events (anything within BUCKET_GAP_MS counts as the same check)
  // and space those events evenly across the width — an ordinal axis, not
  // a proportional one. Every real sync always gets its own visible slot.
  const BUCKET_GAP_MS = 1000 * 60 * 5; // 5 minutes
  const bucketIndexByTimestamp = new Map<string, number>();
  let bucketCount = 0;
  let lastBucketTime = -Infinity;
  for (const t of timestamps) {
    const tMs = new Date(t).getTime();
    if (tMs - lastBucketTime > BUCKET_GAP_MS) bucketCount++;
    bucketIndexByTimestamp.set(t, bucketCount - 1);
    lastBucketTime = tMs;
  }

  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;

  function xFor(iso: string) {
    const idx = bucketIndexByTimestamp.get(iso) ?? 0;
    if (bucketCount <= 1) return PAD.left + innerW / 2;
    return PAD.left + (idx / (bucketCount - 1)) * innerW;
  }
  function yFor(probA: number) {
    return PAD.top + (1 - probA) * innerH;
  }

  const nearestTimestamp = (() => {
    if (hoverX === null) return null;
    let closest = timestamps[0];
    let closestDist = Infinity;
    for (const t of timestamps) {
      const d = Math.abs(xFor(t) - hoverX);
      if (d < closestDist) {
        closestDist = d;
        closest = t;
      }
    }
    return closest;
  })();

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs uppercase tracking-wide text-muted">Line Movement — {fighterAName} implied win %</div>
        <button onClick={() => setShowTable((v) => !v)} className="text-xs text-muted hover:text-accent hover:underline">
          {showTable ? "Show chart" : "Show as table"}
        </button>
      </div>

      {showTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border text-muted">
                <th className="py-1 pr-3">Sportsbook</th>
                <th className="py-1 pr-3">Time</th>
                <th className="py-1">{fighterAName} Win %</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-b border-border/50">
                  <td className="py-1 pr-3">{h.sportsbook}</td>
                  <td className="py-1 pr-3 text-muted">{formatTime(h.fetchedAt)}</td>
                  <td className="py-1 font-mono">{pct(h.probA)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="w-full"
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
              setHoverX(Math.max(PAD.left, Math.min(WIDTH - PAD.right, x)));
            }}
            onPointerLeave={() => setHoverX(null)}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={WIDTH - PAD.right}
                  y1={PAD.top + (1 - f) * innerH}
                  y2={PAD.top + (1 - f) * innerH}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text x={PAD.left - 6} y={PAD.top + (1 - f) * innerH + 3} textAnchor="end" fontSize={9} fill="var(--muted)">
                  {Math.round(f * 100)}%
                </text>
              </g>
            ))}

            {books.map((book, i) => {
              const points = seriesByBook.get(book)!;
              const color = SERIES_COLORS[i % SERIES_COLORS.length];
              const glow = { filter: `drop-shadow(0 0 5px ${color}aa)` };
              if (points.length === 1) {
                const p = points[0];
                return (
                  <circle
                    key={book}
                    cx={xFor(p.fetchedAt)}
                    cy={yFor(p.probA)}
                    r={5}
                    fill={color}
                    stroke="var(--surface)"
                    strokeWidth={2}
                    style={glow}
                  />
                );
              }
              const d = points.map((p, idx) => `${idx === 0 ? "M" : "L"} ${xFor(p.fetchedAt)} ${yFor(p.probA)}`).join(" ");
              return (
                <g key={book} style={glow}>
                  <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {points.map((p, idx) => (
                    <circle key={idx} cx={xFor(p.fetchedAt)} cy={yFor(p.probA)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />
                  ))}
                </g>
              );
            })}

            {hoverX !== null && nearestTimestamp && (
              <line x1={xFor(nearestTimestamp)} x2={xFor(nearestTimestamp)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" strokeWidth={1} strokeDasharray="2,2" />
            )}
          </svg>

          {hoverX !== null && nearestTimestamp && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <div className="mb-1 text-muted">{formatTime(nearestTimestamp)}</div>
              {books.map((book, i) => {
                const point = seriesByBook.get(book)!.find((p) => p.fetchedAt === nearestTimestamp);
                if (!point) return null;
                return (
                  <div key={book} className="flex items-center gap-2">
                    <span className="inline-block h-0.5 w-3" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                    <span className="text-muted">{book}</span>
                    <span className="font-mono font-semibold text-foreground">{pct(point.probA)}</span>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {books.map((book, i) => (
              <div key={book} className="flex items-center gap-1.5 text-xs text-muted">
                <span className="inline-block h-0.5 w-3" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} />
                {book}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
