"use client";

import { useMemo } from "react";

import type { CircuitMapResponse, CircuitSector, Corner } from "@/lib/api";

// Kept away from the green and purple that mark best times on the timing tower,
// so a sector's colour never reads as a verdict on its pace.
const SECTOR_COLOURS: Record<number, string> = {
  1: "#ff5c7a",
  2: "#38bdf8",
  3: "#f5e04a",
};

function sectorColour(sectors: CircuitSector[], corner: Corner, lapLength: number) {
  const distance = corner.apex_m % lapLength;
  const sector = sectors.find((s) => distance < s.end_m) ?? sectors[sectors.length - 1];
  return sector ? SECTOR_COLOURS[sector.number] : undefined;
}

/**
 * The circuit drawn from the reference lap's own position samples.
 *
 * This is not a surveyed track map. It is the line one car took on one lap,
 * which is why corner markers are placed at the point of maximum curvature on
 * *that* line and labelled as approximate everywhere they appear.
 */
export function CircuitMap({
  circuit,
  selected,
  onSelect,
  height = 420,
}: {
  circuit: CircuitMapResponse["circuit"];
  selected: number | null;
  onSelect: (corner: number | null) => void;
  height?: number;
}) {
  // The frontend and API deploy separately, so the field can be briefly absent.
  const sectors = useMemo(() => circuit.sectors ?? [], [circuit]);

  const geometry = useMemo(() => {
    const xs = (circuit.x ?? []).filter((v): v is number => v != null);
    // SVG's y axis grows downward while the position feed's grows upward, so
    // the sign is flipped once here. Doing it in the data rather than with a
    // CSS transform keeps text upright without a counter-transform.
    const ys = (circuit.y ?? []).filter((v): v is number => v != null).map((v) => -v);
    if (xs.length < 10 || ys.length < 10 || xs.length !== ys.length) return null;

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = maxX - minX || 1;
    const depth = maxY - minY || 1;
    const pad = Math.max(width, depth) * 0.08;

    const points = xs.map((x, index) => `${x},${ys[index]}`).join(" ");

    // Each stretch carries on to the first sample of the next, so the colours
    // meet at the boundary instead of leaving a gap in the line.
    const step = circuit.config.grid_step_m ?? 5;
    const sectorLines = sectors.map((sector, position) => {
      const last = position === sectors.length - 1;
      const inSector = xs
        .map((x, index) => ({ x, y: ys[index], d: circuit.distance[index] }))
        .filter(({ d }) => d != null && d >= sector.start_m && (last || d <= sector.end_m + step));
      return {
        number: sector.number,
        points: inSector.map(({ x, y }) => `${x},${y}`).join(" "),
      };
    });

    const markerFor = (distanceM: number) => {
      const distances = circuit.distance;
      let closest = 0;
      let best = Infinity;
      for (let i = 0; i < distances.length; i += 1) {
        const d = distances[i];
        if (d == null) continue;
        const gap = Math.abs(d - (distanceM % circuit.lap_length_m));
        if (gap < best) {
          best = gap;
          closest = i;
        }
      }
      return { x: xs[closest] ?? minX, y: ys[closest] ?? minY };
    };

    return {
      points,
      sectorLines,
      viewBox: `${minX - pad} ${minY - pad} ${width + pad * 2} ${depth + pad * 2}`,
      scale: Math.max(width, depth),
      markerFor,
    };
  }, [circuit, sectors]);

  if (!geometry) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-xs font-medium text-ink-muted">No track geometry available</p>
        <p className="max-w-sm text-2xs leading-relaxed text-ink-faint">
          This session has no usable car-position data, so the circuit cannot be drawn. Corner
          boundaries below were approximated from speed minima instead.
        </p>
      </div>
    );
  }

  const r = geometry.scale * 0.022;

  return (
    <div className="relative flex flex-col" style={{ height }}>
      {sectors.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 pt-1">
          {sectors.map((sector) => (
            <span key={sector.number} className="num flex items-center gap-1.5 text-2xs text-ink-muted">
              <span
                className="h-1 w-4 rounded-full"
                style={{ backgroundColor: SECTOR_COLOURS[sector.number] }}
              />
              S{sector.number} · {sector.duration_s.toFixed(3)} s
            </span>
          ))}
        </div>
      )}

      <svg
        viewBox={geometry.viewBox}
        className="min-h-0 w-full flex-1"
        role="img"
        aria-label={`Circuit map with ${circuit.corners.length} detected corners`}
      >
        <polyline
          points={geometry.points}
          fill="none"
          stroke="#2a323b"
          strokeWidth={geometry.scale * 0.014}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {geometry.sectorLines.length === 0 && (
          <polyline
            points={geometry.points}
            fill="none"
            stroke="#4a5563"
            strokeWidth={geometry.scale * 0.006}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {geometry.sectorLines.map((line) => (
          <g key={line.number} fill="none" stroke={SECTOR_COLOURS[line.number]} strokeLinejoin="round">
            <polyline points={line.points} strokeWidth={geometry.scale * 0.024} strokeOpacity={0.18} />
            <polyline points={line.points} strokeWidth={geometry.scale * 0.008} />
          </g>
        ))}

        {circuit.corners.map((corner) => {
          const point = geometry.markerFor(corner.apex_m);
          const isSelected = selected === corner.number;
          const accent = sectorColour(sectors, corner, circuit.lap_length_m);
          return (
            <g
              key={corner.number}
              onClick={() => onSelect(isSelected ? null : corner.number)}
              style={{ cursor: "pointer" }}
            >
              <circle
                cx={point.x}
                cy={point.y}
                r={r}
                fill={isSelected ? (accent ?? "#4da6ff") : "#101317"}
                stroke={isSelected ? (accent ?? "#4da6ff") : (accent ?? "#5d6670")}
                strokeWidth={geometry.scale * 0.003}
              />
              <text
                x={point.x}
                y={point.y}
                textAnchor="middle"
                dominantBaseline="central"
                fill={isSelected ? "#07080a" : "#e9edf2"}
                fontSize={r * 1.1}
                fontFamily="var(--font-mono)"
                fontWeight="600"
              >
                {corner.number}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="absolute bottom-1 left-2 text-2xs text-ink-faint">
        Reference: car #{circuit.reference_driver}
        {circuit.reference_lap != null && ` lap ${circuit.reference_lap}`} ·{" "}
        {circuit.method === "curvature-of-racing-line"
          ? "corners from path curvature"
          : "corners approximated from speed"}
      </p>
    </div>
  );
}

export function CornerChips({
  corners,
  sectors,
  lapLength,
  selected,
  onSelect,
}: {
  corners: Corner[];
  sectors: CircuitSector[];
  lapLength: number;
  selected: number | null;
  onSelect: (corner: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {corners.map((corner) => {
        const isSelected = selected === corner.number;
        const accent = sectorColour(sectors, corner, lapLength);
        return (
          <button
            key={corner.number}
            type="button"
            onClick={() => onSelect(isSelected ? null : corner.number)}
            className={`num rounded border px-2 py-1 text-2xs transition-colors ${
              isSelected
                ? "border-signal-info/60 bg-signal-info/15 text-signal-info"
                : "border-graphite-700 bg-graphite-850 text-ink-muted hover:border-graphite-500"
            }`}
            style={
              accent
                ? isSelected
                  ? { backgroundColor: accent, borderColor: accent, color: "#07080a" }
                  : { borderColor: accent }
                : undefined
            }
            title={
              corner.min_radius_m
                ? `Turn ${corner.number} · ${corner.direction} · ~${corner.min_radius_m.toFixed(0)} m radius`
                : `Turn ${corner.number}`
            }
          >
            T{corner.number}
          </button>
        );
      })}
    </div>
  );
}
