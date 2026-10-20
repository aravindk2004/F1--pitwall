import { useEffect, useRef, useState } from "react";
import { STATIC_SITE } from "../../data/config";
import { askClaude, EngineerError, pageSample, saveKey, savedKey, type Transport } from "../../engineer/claude";
import { buildRaceContext, ENGINEER_INSTRUCTIONS } from "../../insights/context";
import { useDashboard } from "../../state/store";
import { Panel } from "../common/Panel";

interface Exchange {
  id: number;
  question: string;
  answer: string;
  lap: number | null;
  error?: string;
  pending: boolean;
}

const QUICK = [
  "Summarise the race so far",
  "What are the key strategy calls right now?",
  "Who has the best race pace?",
  "Which battles should I watch?",
];

/** Ask Claude about the race, using everything the dashboard currently knows. */
export function RaceEngineer() {
  const [transport, setTransport] = useState<Transport | null | "checking">("checking");
  const [apiKey, setApiKey] = useState<string | null>(() => savedKey());
  const [keyDraft, setKeyDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [question, setQuestion] = useState("");
  const [log, setLog] = useState<Exchange[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const counter = useRef(0);
  const selected = useDashboard((s) => s.selected);
  const selectedCode = useDashboard((s) => (s.selected != null ? s.snapshot.drivers[s.selected]?.code : undefined));
  const busy = log.some((e) => e.pending);

  useEffect(() => {
    let cancelled = false;
    void pageSample().then((sample) => {
      if (cancelled) return;
      // On the hosted page, ask through the viewer's own Claude account; locally, use an API key.
      setTransport(sample ? "page" : STATIC_SITE ? null : "api");
    });
    return () => {
      cancelled = true;
      ctl.current?.abort();
    };
  }, []);

  const ask = async (q: string) => {
    if (!q.trim() || busy || !transport || transport === "checking") return;
    const st = useDashboard.getState();
    const context = buildRaceContext(st.snapshot, st.insights, st.events);
    const prompt = `${ENGINEER_INSTRUCTIONS}\n\nRACE DATA:\n${context}\n\nQUESTION: ${q.trim()}`;
    const id = ++counter.current;
    const update = (patch: Partial<Exchange>) => setLog((l) => l.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    setLog((l) => [{ id, question: q.trim(), answer: "", lap: st.snapshot.lap.current, pending: true }, ...l].slice(0, 6));
    setQuestion("");
    ctl.current = new AbortController();
    try {
      const answer = await askClaude(transport, prompt, { onText: (text) => update({ answer: text }), signal: ctl.current.signal }, apiKey);
      update({ answer, pending: false });
    } catch (e) {
      const err = e instanceof EngineerError ? e : new EngineerError("Something went wrong asking Claude.");
      update({ answer: err.partial ?? "", error: err.message, pending: false });
    }
  };

  const saveApiKey = () => {
    const k = keyDraft.trim();
    if (!k) return;
    setApiKey(k);
    if (remember) saveKey(k);
    setKeyDraft("");
  };

  const forgetKey = () => {
    saveKey(null);
    setApiKey(null);
  };

  const ready = transport === "page" || (transport === "api" && apiKey);
  const quick = selectedCode ? [...QUICK, `What should ${selectedCode} do next?`] : QUICK;

  return (
    <Panel
      title="Race engineer · Claude"
      right={
        transport === "api" && apiKey ? (
          <button onClick={forgetKey} className="text-[10px] text-white/45 hover:text-white">
            Remove API key
          </button>
        ) : transport === "page" ? (
          <span className="text-[10px] text-white/40">Uses your Claude account</span>
        ) : null
      }
      bodyClassName="flex flex-col gap-3 p-3"
    >
      {transport === "checking" ? (
        <p className="text-sm text-white/40">Connecting…</p>
      ) : transport === null ? (
        <p className="text-sm text-white/45">Claude isn't available in this view. Open the page in Claude to ask the race engineer.</p>
      ) : transport === "api" && !apiKey ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            saveApiKey();
          }}
        >
          <p className="text-[12px] text-white/60">
            Add an Anthropic API key to ask Claude about the race. The key stays in this browser and is sent only to the
            Anthropic API; each question uses a small amount of API credit.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="engineer-key"
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-ant-…"
              className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-ink-850 px-3 text-[12px] text-white outline-none focus:border-cyan-glow/60"
              aria-label="Anthropic API key"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-white/55">
              <input id="engineer-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-cyan-400" />
              Remember on this device
            </label>
            <button type="submit" className="h-8 rounded-md bg-cyan-glow px-3 text-[12px] font-bold text-ink-950 hover:brightness-110">
              Save key
            </button>
          </div>
        </form>
      ) : null}

      {ready && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q}
                disabled={busy}
                onClick={() => void ask(q)}
                className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/70 hover:border-cyan-glow/50 hover:text-cyan-glow disabled:opacity-40"
              >
                {q}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(question);
            }}
          >
            <input
              id="engineer-question"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={selected != null ? `Ask about ${selectedCode ?? "the race"}…` : "Ask your race engineer…"}
              className="h-9 min-w-0 flex-1 rounded-md border border-white/10 bg-ink-850 px-3 text-[13px] text-white placeholder:text-white/30 outline-none focus:border-cyan-glow/60"
              aria-label="Question for the race engineer"
            />
            {busy ? (
              <button type="button" onClick={() => ctl.current?.abort()} className="h-9 rounded-md border border-white/15 px-3 text-[12px] text-white/80 hover:text-white">
                Stop
              </button>
            ) : (
              <button type="submit" disabled={!question.trim()} className="h-9 rounded-md bg-cyan-glow px-4 text-[12px] font-bold text-ink-950 disabled:opacity-40">
                Ask
              </button>
            )}
          </form>
        </>
      )}

      {log.map((e) => (
        <article key={e.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <header className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="text-[12px] font-semibold text-white">{e.question}</span>
            <span className="shrink-0 font-mono text-[10px] text-white/35">{e.lap != null ? `at lap ${e.lap}` : ""}</span>
          </header>
          {e.pending && !e.answer ? (
            <p className="text-[12px] text-white/45">Thinking…</p>
          ) : (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-white/85">{e.answer}</p>
          )}
          {e.error && <p className="mt-1 text-[11px] text-amber-300/90">{e.error}</p>}
        </article>
      ))}
      {ready && !log.length && (
        <p className="text-[11px] text-white/35">
          Claude sees the timing, gaps, tyres, pit-stop projections, recent events and race control as they are right now. In
          replays it is told not to reveal what happens later.
        </p>
      )}
    </Panel>
  );
}
