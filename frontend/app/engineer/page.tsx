"use client";

import { useEffect, useRef, useState } from "react";

import { DriverLapPicker } from "@/components/DriverLapPicker";
import { EngineerAnswer, EvidenceBrief } from "@/components/EngineerAnswer";
import { SessionPicker, useSelection, type Selection } from "@/components/SessionPicker";
import { ErrorPanel, Note, useAsync } from "@/components/ui";
import { api, type DriverInfo, type EngineerResponse } from "@/lib/api";
import { sessionLabel, teamColour } from "@/lib/format";

type Suggestion = {
  tag: string;
  needsDrivers: boolean;
  text: (a: string, b: string) => string;
};

const SUGGESTIONS: Suggestion[] = [
  {
    tag: "Lap time",
    needsDrivers: true,
    text: (a, b) => `Where did ${a} lose the most time to ${b}?`,
  },
  {
    tag: "Braking",
    needsDrivers: true,
    text: () => "Which corners show significant braking-point differences?",
  },
  {
    tag: "Corners",
    needsDrivers: true,
    text: () => "Is the time loss on corner entry, minimum speed, or exit?",
  },
  {
    tag: "Long run",
    needsDrivers: false,
    text: () => "Which driver had the more consistent long-run pace?",
  },
  { tag: "Tyres", needsDrivers: false, text: () => "How did tyre age correlate with lap time?" },
  {
    tag: "Strategy",
    needsDrivers: false,
    text: () => "Which strategy scenarios are worth investigating?",
  },
];

const RACE_ANALYSIS =
  "Write an engineering race analysis of the selected session and drivers. Summarise pace and lap delta, significant corner differences, tyre degradation, pit stops and strategy. Separate measured findings from estimates, cite the evidence, identify missing data, and finish with engineering questions worth investigating. Do not infer race results or incidents from unavailable data.";
const RACE_ANALYSIS_LABEL = "Analyse this race";
const QUESTION_LIMIT = 2000;

type Turn = { question: string; result: EngineerResponse };

const displayQuestion = (question: string) =>
  question === RACE_ANALYSIS ? RACE_ANALYSIS_LABEL : question;

export default function EngineerPage() {
  const [selection] = useSelection();
  const [editing, setEditing] = useState(false);

  const drivers = useAsync(
    () => api.drivers(selection.sessionKey as number),
    [selection.sessionKey],
    selection.sessionKey != null,
  );
  const weekend = useAsync(
    () => api.weekend(selection.meetingKey as number),
    [selection.meetingKey],
    selection.meetingKey != null,
  );

  const list = drivers.data?.drivers ?? [];
  const session = weekend.data?.sessions.find((s) => s.session_key === selection.sessionKey);
  const contextReady =
    selection.sessionKey != null && selection.driverA != null && selection.driverB != null;
  // The pickers stay mounted while hidden because they choose the default
  // session and drivers, and they must be visible whenever that has not worked.
  const showPickers = editing || !contextReady;

  // A new context starts a new chat, including requests still in flight.
  const contextKey = [
    selection.sessionKey,
    selection.driverA,
    selection.driverB,
    selection.lapA,
    selection.lapB,
  ].join(":");

  return (
    <div className="mx-auto max-w-4xl space-y-3">
      <section className="panel">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
          <div className="min-w-0">
            <p className="field-label !mb-0">Session</p>
            <p className="truncate text-sm font-medium text-ink">
              {session
                ? `${session.circuit_short_name ?? session.location ?? "Circuit"} · ${sessionLabel(session)}${session.year ? ` ${session.year}` : ""}`
                : "Choose a session"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <DriverTile driver={list.find((d) => d.driver_number === selection.driverA)} lap={selection.lapA} />
            <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">vs</span>
            <DriverTile driver={list.find((d) => d.driver_number === selection.driverB)} lap={selection.lapB} />
          </div>
          <button
            type="button"
            className="btn ml-auto"
            aria-expanded={showPickers}
            aria-controls="engineer-context"
            disabled={!contextReady}
            onClick={() => setEditing((value) => !value)}
          >
            {showPickers ? "Done" : "Change"}
          </button>
        </div>
        <div
          id="engineer-context"
          className={showPickers ? "space-y-3 border-t border-graphite-700 p-3" : "hidden"}
        >
          <SessionPicker compact />
          <DriverLapPicker />
          <p className="text-2xs text-ink-faint">Changing any of these starts a new conversation.</p>
        </div>
      </section>

      <EngineerChat key={contextKey} selection={selection} drivers={list} />
    </div>
  );
}

function DriverTile({ driver, lap }: { driver?: DriverInfo; lap: number | null }) {
  return (
    <div className="flex items-center gap-2 rounded border border-graphite-700 bg-graphite-850 py-1 pl-1.5 pr-2.5">
      <span
        className="h-7 w-1 shrink-0 rounded-sm"
        style={{ background: teamColour(driver?.team_colour) }}
        aria-hidden
      />
      <div>
        <p className="num text-sm font-semibold leading-tight text-ink">
          {driver?.name_acronym ?? "—"}
        </p>
        <p className="text-2xs leading-tight text-ink-faint">{lap != null ? `Lap ${lap}` : "Fastest lap"}</p>
      </div>
    </div>
  );
}

function EngineerChat({ selection, drivers }: { selection: Selection; drivers: DriverInfo[] }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const request = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef<HTMLDivElement>(null);

  const loading = pending != null;
  const sessionReady = selection.sessionKey != null;
  const canSend = sessionReady && !loading && question.trim().length > 2;
  const hasDrivers = selection.driverA != null && selection.driverB != null;
  const a = drivers.find((d) => d.driver_number === selection.driverA)?.name_acronym ?? "driver A";
  const b = drivers.find((d) => d.driver_number === selection.driverB)?.name_acronym ?? "driver B";

  const suggestions = SUGGESTIONS.filter((s) => hasDrivers || !s.needsDrivers).map((s) => ({
    tag: s.tag,
    text: s.text(a, b),
  }));
  const asked = new Set(turns.map((turn) => turn.question));
  const followUps = suggestions.filter((s) => !asked.has(s.text)).slice(0, 3);

  useEffect(() => {
    latest.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [turns.length, loading]);

  async function submit(prompt: string, fromComposer = false) {
    const submitted = prompt.trim();
    if (loading || selection.sessionKey == null || submitted.length < 3) return;

    const id = (request.current += 1);
    setPending(submitted);
    setError(null);
    if (fromComposer) setQuestion("");

    try {
      const history = turns
        .filter((turn) => turn.result.narration === "generated")
        .slice(-6)
        .flatMap((turn) => [
          { role: "user" as const, content: turn.question },
          { role: "assistant" as const, content: turn.result.answer!.slice(0, 12000) },
        ]);
      const result = await api.ask({
        session_key: selection.sessionKey,
        question: submitted,
        history,
        driver_a: selection.driverA,
        driver_b: selection.driverB,
        lap_a: selection.lapA,
        lap_b: selection.lapB,
      });
      if (id !== request.current) return;
      setTurns((previous) => [...previous, { question: submitted, result }]);
    } catch (err) {
      if (id !== request.current) return;
      setError(err as Error);
      if (fromComposer) setQuestion((current) => current || submitted);
    } finally {
      if (id === request.current) {
        setPending(null);
        input.current?.focus();
      }
    }
  }

  function stopWaiting() {
    request.current += 1;
    if (pending && pending !== RACE_ANALYSIS) setQuestion((current) => current || pending);
    setPending(null);
  }

  function retry(index: number) {
    const turn = turns[index];
    setTurns((previous) => previous.filter((_, i) => i !== index));
    void submit(turn.question);
  }

  function newChat() {
    setTurns([]);
    setError(null);
    setQuestion("");
    input.current?.focus();
  }

  return (
    <>
      <div
        className="space-y-4"
        role="log"
        aria-label="Race engineer conversation"
        aria-live="polite"
        aria-busy={loading}
      >
        {!turns.length && !loading && (
          <section className="panel p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <RadioBars />
              <div>
                <h1 className="text-lg font-semibold text-ink">Radio check. What should we look at?</h1>
                <p className="text-xs text-ink-muted">
                  Your race engineer answers from this session&apos;s telemetry, then you can follow up.
                </p>
              </div>
            </div>

            <button
              type="button"
              className="mt-4 flex w-full items-center justify-between gap-3 rounded border border-signal-info/40 bg-signal-info/10 px-4 py-3 text-left transition-colors hover:border-signal-info/70 hover:bg-signal-info/20 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!sessionReady}
              onClick={() => submit(RACE_ANALYSIS)}
            >
              <span>
                <span className="block text-sm font-semibold text-signal-info">Analyse race</span>
                <span className="block text-2xs text-ink-muted">
                  Pace · corners · tyres · strategy, in one report
                </span>
              </span>
              <span aria-hidden className="text-signal-info">→</span>
            </button>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.tag}
                  type="button"
                  disabled={!sessionReady}
                  onClick={() => submit(suggestion.text)}
                  className="rounded border border-graphite-700 bg-graphite-850 p-3 text-left transition-colors hover:border-graphite-500 hover:bg-graphite-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
                    {suggestion.tag}
                  </span>
                  <span className="mt-1 block text-xs leading-snug text-ink">{suggestion.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            ref={index === turns.length - 1 && !loading ? latest : undefined}
            className="scroll-mt-28 space-y-2"
          >
            <UserMessage text={displayQuestion(turn.question)} />
            <EngineerMessage
              result={turn.result}
              drivers={drivers}
              onRetry={turn.result.narration === "generated" ? undefined : () => retry(index)}
              retryDisabled={loading}
            />
          </div>
        ))}

        {pending != null && (
          <div ref={latest} className="scroll-mt-28 space-y-2">
            <UserMessage text={displayQuestion(pending)} />
            <Thinking onStop={stopWaiting} />
          </div>
        )}

        {error && (
          <div className="panel border-signal-alert/30">
            <ErrorPanel error={error} />
          </div>
        )}
      </div>

      <section className="panel sticky bottom-2 z-20 space-y-2 p-2.5 shadow-lg shadow-graphite-950">
        {turns.length > 0 && !loading && followUps.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto">
            {followUps.map((suggestion) => (
              <button
                key={suggestion.tag}
                type="button"
                onClick={() => submit(suggestion.text)}
                className="shrink-0 rounded-full border border-graphite-700 bg-graphite-850 px-2.5 py-1 text-2xs text-ink-muted transition-colors hover:border-graphite-500 hover:text-ink"
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor="engineer-question">
            Ask a question or follow up
          </label>
          <textarea
            id="engineer-question"
            ref={input}
            rows={2}
            className="field max-h-48 min-h-[44px] flex-1 resize-y"
            placeholder={
              turns.length
                ? "Ask a follow-up…"
                : "Ask about pace, braking, tyre degradation or strategy…"
            }
            value={question}
            maxLength={QUESTION_LIMIT}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) submit(question, true);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary h-[44px] px-4"
            disabled={!canSend}
            onClick={() => submit(question, true)}
          >
            Send
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-2xs text-ink-faint">
          <span>
            Enter to send · Shift + Enter for a new line
            {question.length > QUESTION_LIMIT - 200 && ` · ${question.length}/${QUESTION_LIMIT}`}
          </span>
          <span className="flex items-center gap-3">
            Answers can be wrong, so check the numbers.
            {turns.length > 0 && (
              <button
                type="button"
                className="underline hover:text-ink disabled:opacity-40"
                disabled={loading}
                onClick={newChat}
              >
                New chat
              </button>
            )}
          </span>
        </div>
      </section>
    </>
  );
}

function RadioBars({ active = false }: { active?: boolean }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center gap-[3px] rounded-full border border-signal-info/40 bg-signal-info/10" aria-hidden>
      {[0, 150, 300].map((delay, index) => (
        <span
          key={delay}
          className={`w-[3px] rounded-full bg-signal-info ${active ? "motion-safe:animate-radio-bar" : ""} ${index === 1 ? "h-3.5" : "h-2"}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end motion-safe:animate-message-in">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm border border-signal-info/25 bg-signal-info/10 px-3 py-2 text-sm text-ink">
        {text}
      </p>
    </div>
  );
}

function Thinking({ onStop }: { onStop: () => void }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="panel flex items-center gap-3 p-3 motion-safe:animate-message-in">
      <RadioBars active />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">Checking the data and asking Gemma…</p>
        <p className="num text-2xs text-ink-faint">
          {seconds} s{seconds >= 20 && " · long answers can take a few minutes"}
        </p>
      </div>
      <button type="button" className="btn" onClick={onStop}>
        Stop waiting
      </button>
    </div>
  );
}

function EngineerMessage({
  result,
  drivers,
  onRetry,
  retryDisabled,
}: {
  result: EngineerResponse;
  drivers: DriverInfo[];
  onRetry?: () => void;
  retryDisabled: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const answered = result.answer != null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.answer ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="panel motion-safe:animate-message-in">
      <header className="flex items-center gap-2 border-b border-graphite-800 px-3 py-2">
        <RadioBars />
        <span className="text-xs font-semibold text-ink">Race engineer</span>
        {result.model && <span className="num truncate text-2xs text-ink-faint">{result.model}</span>}
        {answered && (
          <button type="button" className="ml-auto text-2xs text-ink-muted hover:text-ink" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </header>

      <div className="space-y-3 p-3">
        {answered ? (
          <EngineerAnswer answer={result.answer as string} evidence={result.evidence} drivers={drivers} />
        ) : (
          <div className="rounded border border-signal-warn/30 bg-signal-warn/5 p-3">
            <p className="text-sm font-medium text-ink">
              {result.narration === "unavailable"
                ? "Gemma isn't connected, but the numbers are ready"
                : "Gemma couldn't answer this time, but the numbers are ready"}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">{result.reason}</p>
            {onRetry && (
              <button type="button" className="btn mt-2" disabled={retryDisabled} onClick={onRetry}>
                Try again
              </button>
            )}
          </div>
        )}

        <details open={!answered} className="group rounded border border-graphite-700 bg-graphite-850">
          <summary className="cursor-pointer select-none px-3 py-2 text-xs text-ink-muted hover:text-ink">
            {answered ? "See the numbers behind this answer" : "The numbers"}
          </summary>
          <div className="space-y-4 border-t border-graphite-700 p-3">
            <EvidenceBrief evidence={result.evidence} drivers={drivers} />
            {result.disclaimer && <Note>{result.disclaimer}</Note>}
            <details>
              <summary className="cursor-pointer text-2xs text-ink-muted hover:text-ink">
                Raw evidence (everything the engineer was given)
              </summary>
              <pre className="num mt-2 max-h-[420px] overflow-auto rounded border border-graphite-700 bg-graphite-950 p-3 text-2xs leading-relaxed text-ink-muted">
                {JSON.stringify(result.evidence, null, 2)}
              </pre>
            </details>
          </div>
        </details>
      </div>
    </article>
  );
}
