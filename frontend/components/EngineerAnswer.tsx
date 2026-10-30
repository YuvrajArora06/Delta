"use client";

import { Fragment, useMemo, type ReactNode } from "react";

import type { DriverInfo, Provenance } from "@/lib/api";
import { delta as fmtDelta, teamColour } from "@/lib/format";
import { ConfidenceBadge, NoteList, ProvenanceBadge } from "./ui";

/* ------------------------------------------------------------------ */
/* The evidence fields this view reads                                 */
/* ------------------------------------------------------------------ */

interface SectorEvidence {
  sector: number;
  a_seconds: number | null;
  b_seconds: number | null;
  delta_seconds: number | null;
  provenance: Provenance;
}

interface CornerEvidence {
  corner: number;
  time_delta_s: number | null;
  confidence: string;
  interpretation: string;
}

interface EvidenceView {
  lap_delta?: {
    driver_a: number;
    driver_b: number;
    lap_a: number | null;
    lap_b: number | null;
    final_delta_s: number | null;
    sectors?: SectorEvidence[];
    notes?: string[];
  };
  corner_analysis?: CornerEvidence[];
}

function readEvidence(evidence: Record<string, unknown>): EvidenceView {
  return evidence as EvidenceView;
}

function nameOf(drivers: DriverInfo[], number: number | undefined, fallback: string) {
  const driver = drivers.find((d) => d.driver_number === number);
  return driver?.name_acronym ?? (number != null ? `#${number}` : fallback);
}

/** Keeps the backend's wording but says who "driver A" and "driver B" are. */
function nameDrivers(text: string, a: string, b: string) {
  return text.replace(/\bdriver A\b/g, a).replace(/\bdriver B\b/g, b);
}

/* ------------------------------------------------------------------ */
/* Written answers                                                     */
/* ------------------------------------------------------------------ */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:corner|sector|stint|lap)[^\]]{0,40}\](?!\())/gi;

/** What a citation points at, so it can be checked without opening the raw data. */
function citationDetail(label: string, evidence: EvidenceView, a: string, b: string) {
  const match = /^(corner|sector)\s+(\d+)$/i.exec(label.trim());
  if (!match) return undefined;
  const number = Number(match[2]);
  if (match[1].toLowerCase() === "corner") {
    const row = evidence.corner_analysis?.find((c) => c.corner === number);
    return row ? nameDrivers(row.interpretation, a, b) : undefined;
  }
  const row = evidence.lap_delta?.sectors?.find((s) => s.sector === number);
  return row ? `${a} ${row.a_seconds ?? "—"} s · ${b} ${row.b_seconds ?? "—"} s` : undefined;
}

function Inline({ text, cite }: { text: string; cite: (label: string) => string | undefined }) {
  return (
    <>
      {text.split(INLINE).map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return (
            <strong key={index} className="font-semibold text-ink">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return (
            <code key={index} className="num rounded bg-graphite-800 px-1 text-xs">
              {part.slice(1, -1)}
            </code>
          );
        }
        if (/^\[(corner|sector|stint|lap)/i.test(part) && part.endsWith("]")) {
          const label = part.slice(1, -1);
          return (
            <span
              key={index}
              title={cite(label)}
              className="num mx-0.5 inline-block whitespace-nowrap rounded-sm border border-signal-info/30 bg-signal-info/10 px-1 align-baseline text-2xs text-signal-info"
            >
              {label}
            </span>
          );
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}

const TABLE_RULE = /^\|?[\s:|-]+\|?$/;
const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());

/**
 * The small part of Markdown the model actually writes. It builds React nodes
 * rather than HTML, so nothing in a model's answer can ever run as markup.
 */
function Markdown({ source, cite }: { source: string; cite: (label: string) => string | undefined }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = blocks.length;

    if (!line.trim()) {
      i += 1;
    } else if (/^#{1,6}\s/.test(line)) {
      blocks.push(
        <h3 key={key} className="pt-2 text-sm font-semibold text-ink first:pt-0">
          <Inline text={line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "")} cite={cite} />
        </h3>,
      );
      i += 1;
    } else if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "") && lines[i + 1].includes("-")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(cells(lines[i]));
        i += 1;
      }
      blocks.push(
        <div key={key} className="overflow-x-auto rounded border border-graphite-700">
          <table className="data-table">
            <thead>
              <tr>
                {head.map((cell, c) => (
                  <th key={c}>{cell}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="!whitespace-normal">
                      <Inline text={cell} cite={cite} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        i += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key} className={`space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"} marker:text-ink-faint`}>
          {items.map((item, n) => (
            <li key={n}>
              <Inline text={item} cite={cite} />
            </li>
          ))}
        </List>,
      );
    } else {
      const paragraph: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^#{1,6}\s/.test(lines[i]) &&
        !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]) &&
        !(lines[i].includes("|") && TABLE_RULE.test(lines[i + 1] ?? ""))
      ) {
        paragraph.push(lines[i]);
        i += 1;
      }
      blocks.push(
        <p key={key}>
          <Inline text={paragraph.join(" ")} cite={cite} />
        </p>,
      );
    }
  }

  return <div className="space-y-2.5 text-sm leading-relaxed text-ink">{blocks}</div>;
}

export function EngineerAnswer({
  answer,
  evidence,
  drivers,
}: {
  answer: string;
  evidence: Record<string, unknown>;
  drivers: DriverInfo[];
}) {
  const view = useMemo(() => readEvidence(evidence), [evidence]);
  const a = nameOf(drivers, view.lap_delta?.driver_a, "Driver A");
  const b = nameOf(drivers, view.lap_delta?.driver_b, "Driver B");
  return <Markdown source={answer} cite={(label) => citationDetail(label, view, a, b)} />;
}

/* ------------------------------------------------------------------ */
/* The numbers behind an answer                                        */
/* ------------------------------------------------------------------ */

function SectorBar({
  sector,
  largest,
  a,
  b,
  colourA,
  colourB,
}: {
  sector: SectorEvidence;
  largest: number;
  a: string;
  b: string;
  colourA: string;
  colourB: string;
}) {
  const value = sector.delta_seconds;
  const share = value != null && largest > 0 ? (Math.abs(value) / largest) * 100 : 0;
  // A positive sector delta means A's sector time was the shorter one.
  const faster = value == null || value === 0 ? null : value > 0 ? a : b;
  const summary =
    value == null
      ? "No sector time"
      : faster
        ? `${faster} faster by ${Math.abs(value).toFixed(3)} s`
        : "Level";

  return (
    <div
      className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_6.5rem] items-center gap-x-px py-1"
      title={`Sector ${sector.sector}: ${a} ${sector.a_seconds ?? "—"} s, ${b} ${sector.b_seconds ?? "—"} s`}
    >
      <span className="num text-2xs text-ink-muted">S{sector.sector}</span>
      <div className="flex h-2.5 justify-end border-r border-graphite-500">
        {value != null && value > 0 && (
          <span className="rounded-l" style={{ width: `${share}%`, background: colourA }} />
        )}
      </div>
      <div className="flex h-2.5">
        {value != null && value < 0 && (
          <span className="rounded-r" style={{ width: `${share}%`, background: colourB }} />
        )}
      </div>
      <span className="num pl-2 text-right text-2xs text-ink">
        {faster ? `${faster} ${fmtDelta(Math.abs(value as number)).replace("+", "−")}` : "—"}
        <span className="sr-only"> {summary}</span>
      </span>
    </div>
  );
}

export function EvidenceBrief({
  evidence,
  drivers,
}: {
  evidence: Record<string, unknown>;
  drivers: DriverInfo[];
}) {
  const view = readEvidence(evidence);
  const lap = view.lap_delta;

  if (!lap) {
    return (
      <p className="text-xs leading-relaxed text-ink-muted">
        No lap comparison is available for this selection. Pick two drivers to compare their laps,
        sectors and corners.
      </p>
    );
  }

  const a = nameOf(drivers, lap.driver_a, "Driver A");
  const b = nameOf(drivers, lap.driver_b, "Driver B");
  const colourOf = (number: number) =>
    teamColour(drivers.find((d) => d.driver_number === number)?.team_colour);
  const gap = lap.final_delta_s;
  const sectors = lap.sectors ?? [];
  const largest = Math.max(0, ...sectors.map((s) => Math.abs(s.delta_seconds ?? 0)));
  const corners = [...(view.corner_analysis ?? [])]
    .filter((c) => c.time_delta_s != null)
    .sort((x, y) => Math.abs(y.time_delta_s as number) - Math.abs(x.time_delta_s as number))
    .slice(0, 3);
  const notes = Array.from(new Set(lap.notes ?? []));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <div>
          <p className="field-label">Telemetry gap at the line</p>
          {gap == null ? (
            <p className="num text-2xl font-semibold text-ink-faint">—</p>
          ) : (
            <>
              <p className="num text-2xl font-semibold text-ink">
                {Math.abs(gap).toFixed(3)}
                <span className="ml-1 text-sm font-normal text-ink-muted">s</span>
              </p>
              <p className="text-xs text-ink-muted">
                {gap === 0 ? "Level" : `${gap > 0 ? a : b} ahead`}
              </p>
            </>
          )}
          <p className="num mt-1 text-2xs text-ink-faint">
            {a} L{lap.lap_a ?? "?"} · {b} L{lap.lap_b ?? "?"}
          </p>
        </div>

        {sectors.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="field-label !mb-0">Sector times</p>
              <ProvenanceBadge kind={sectors[0].provenance} />
            </div>
            <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_6.5rem] gap-x-px text-2xs text-ink-faint">
              <span />
              <span className="text-right pr-1.5">← {a} faster</span>
              <span className="pl-1.5">{b} faster →</span>
              <span />
            </div>
            {sectors.map((sector) => (
              <SectorBar
                key={sector.sector}
                sector={sector}
                largest={largest}
                a={a}
                b={b}
                colourA={colourOf(lap.driver_a)}
                colourB={colourOf(lap.driver_b)}
              />
            ))}
          </div>
        )}
      </div>

      {corners.length > 0 && (
        <div>
          <p className="field-label">Biggest corner swings</p>
          <ul className="divide-y divide-graphite-800 rounded border border-graphite-700">
            {corners.map((corner) => (
              <li key={corner.corner} className="flex items-start gap-3 px-2.5 py-2">
                <span className="num pt-0.5 text-xs font-semibold text-ink">T{corner.corner}</span>
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-muted">
                  {nameDrivers(corner.interpretation, a, b)}
                </p>
                <ConfidenceBadge level={corner.confidence} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <details>
          <summary className="cursor-pointer text-2xs text-ink-muted hover:text-ink">
            Data caveats ({notes.length})
          </summary>
          <div className="mt-2">
            <NoteList notes={notes} />
          </div>
        </details>
      )}
    </div>
  );
}
