"use client";

import { useState } from "react";
import { DriverLapPicker } from "@/components/DriverLapPicker";
import { SessionPicker, useSelection, type Selection } from "@/components/SessionPicker";
import { Empty, ErrorPanel, Loading, Note, Panel } from "@/components/ui";
import { api, type EngineerResponse } from "@/lib/api";

const SUGGESTIONS = [
  "Where did driver A lose the most time to driver B?",
  "Which corners show significant braking-point differences?",
  "Is the time loss on corner entry, minimum speed, or exit?",
  "Which driver had the more consistent long-run pace?",
  "How did tyre age correlate with lap time?",
  "Which strategy scenarios are worth investigating?",
];
const RACE_ANALYSIS = "Write an engineering race analysis of the selected session and drivers. Summarise pace and lap delta, significant corner differences, tyre degradation, pit stops and strategy. Separate measured findings from estimates, cite the evidence, identify missing data, and finish with engineering questions worth investigating. Do not infer race results or incidents from unavailable data.";
type Turn = { question: string; result: EngineerResponse };

export default function EngineerPage() {
  const [selection] = useSelection();
  // A new context starts a new chat, including requests still in flight.
  const contextKey = [selection.sessionKey, selection.driverA, selection.driverB, selection.lapA, selection.lapB].join(":");
  return <EngineerChat key={contextKey} selection={selection} />;
}

function EngineerChat({ selection }: { selection: Selection }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState("");
  const [generation, setGeneration] = useState(0);
  const ready = selection.sessionKey != null && question.trim().length > 2;

  async function submit(prompt = question) {
    if (loading || selection.sessionKey == null || prompt.trim().length < 3) return;
    const submitted = prompt.trim();
    setLoading(true);
    setPending(submitted);
    setError(null);
    try {
      const history = turns.filter(turn => turn.result.narration === "generated").slice(-6).flatMap(turn => [
        { role: "user" as const, content: turn.question },
        { role: "assistant" as const, content: turn.result.answer!.slice(0, 12000) },
      ]);
      const result = await api.ask({
        session_key: selection.sessionKey,
        question: submitted,
        history,
        driver_a: selection.driverA, driver_b: selection.driverB,
        lap_a: selection.lapA, lap_b: selection.lapB,
      });
      setTurns(previous => [...previous, { question: submitted, result }]);
      if (result.narration === "generated") setQuestion("");
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
      setPending("");
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="Race context" bodyClassName="space-y-3 p-3">
        <SessionPicker compact />
        <DriverLapPicker />
        <Note>Gemma analyses the computed session evidence, including lap deltas, corners, stint fits and uncertainties. Select two drivers for lap and corner comparisons. Changing the session, drivers or laps starts a new conversation. Answers can be wrong; inspect their evidence before making a decision.</Note>
      </Panel>
      <Panel title="Gemma race engineer" bodyClassName="space-y-3 p-3" right={
        <button type="button" className="btn" disabled={loading || !turns.length} onClick={() => { setTurns([]); setError(null); setGeneration(value => value + 1); }}>New chat</button>
      }>
        <div className="flex items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={loading || selection.sessionKey == null} onClick={() => submit(RACE_ANALYSIS)}>Analyse race</button>
          <span className="text-2xs text-ink-faint">Pace · corners · tyres · strategy</span>
        </div>
        <div key={generation} className="space-y-4" role="log" aria-label="Race engineer conversation" aria-live="polite" aria-busy={loading}>
          {!turns.length && !loading && <Empty title="Ask your race engineer" detail="Generate a race analysis or ask a question, then follow up in this conversation." />}
          {turns.map((turn, index) => <div key={index} className="space-y-2 border-t border-graphite-700 pt-3">
            <div className="text-2xs font-semibold text-ink-faint">YOU</div>
            <p className="whitespace-pre-wrap text-sm text-ink">{turn.question}</p>
            <div className="text-2xs font-semibold text-ink-faint">GEMMA {turn.result.model ? `· ${turn.result.model}` : ""}</div>
            {turn.result.answer ? <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{turn.result.answer}</div> : <Empty title="Analysis unavailable" detail={turn.result.reason ?? "The evidence remains available below."} />}
            {turn.result.disclaimer && <Note>{turn.result.disclaimer}</Note>}
            <details className="rounded border border-graphite-700 p-3">
              <summary className="cursor-pointer text-2xs text-ink-muted">Inspect evidence for this answer</summary>
              <pre className="num mt-3 max-h-[420px] overflow-auto text-2xs text-ink-muted">{JSON.stringify(turn.result.evidence, null, 2)}</pre>
            </details>
          </div>)}
          {loading && <div><p className="whitespace-pre-wrap text-sm text-ink">{pending}</p><Loading label="Computing evidence and asking Gemma…" /></div>}
        </div>
        {error && <ErrorPanel error={error} />}
        <label className="block text-2xs text-ink-muted" htmlFor="engineer-question">Ask a question or follow up</label>
        <textarea id="engineer-question" className="field min-h-[90px] resize-y" placeholder="Ask about pace, braking, tyre degradation or strategy…" value={question} maxLength={2000} disabled={loading} onChange={event => setQuestion(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } }} />
        <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map(suggestion => <button key={suggestion} type="button" disabled={loading} className="rounded border border-graphite-700 bg-graphite-850 px-2 py-1 text-2xs text-ink-muted hover:text-ink" onClick={() => setQuestion(suggestion)}>{suggestion}</button>)}</div>
        <div className="flex items-center gap-2"><button type="button" className="btn btn-primary" disabled={!ready || loading} onClick={() => submit()}>{loading ? "Analysing…" : "Send"}</button><span className="text-2xs text-ink-faint">⌘/Ctrl + Enter · {question.length}/2000</span></div>
      </Panel>
    </div>
  );
}
