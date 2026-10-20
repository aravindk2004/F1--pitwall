// Two ways to ask Claude: the published page's `sample` capability (the viewer's own
// Claude account), or the Anthropic API with the user's key in the local app.

export type Transport = "page" | "api";

export interface AskOptions {
  onText(text: string): void;
  signal: AbortSignal;
}

const KEY_STORAGE = "f1dash.anthropicKey";
const MODEL = "claude-opus-5-5";

interface SampleFn {
  (input: string, options?: { onText?(u: { text: string }): void; signal?: AbortSignal; cache?: boolean }): Promise<{ text: string; truncated: boolean }>;
}

let samplePromise: Promise<SampleFn | null> | null = null;

/** The page capability, when this page runs inside a Claude viewer that grants it. */
export function pageSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const claude = (window as unknown as { claude?: { use?(name: string): Promise<unknown> } }).claude;
    samplePromise = claude?.use ? (claude.use("sample") as Promise<SampleFn | null>).catch(() => null) : Promise.resolve(null);
  }
  return samplePromise;
}

export function savedKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function saveKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
}

/** A friendly error message for a failed request. */
export class EngineerError extends Error {
  constructor(
    message: string,
    readonly partial?: string,
  ) {
    super(message);
  }
}

async function askPage(sample: SampleFn, prompt: string, opts: AskOptions): Promise<string> {
  try {
    const { text, truncated } = await sample(prompt, { onText: ({ text }) => opts.onText(text), signal: opts.signal, cache: false });
    return truncated ? `${text}\n\n(Answer cut short.)` : text;
  } catch (e) {
    const err = e as { code?: string; text?: string };
    const messages: Record<string, string> = {
      cancelled: "Stopped.",
      not_granted: "Claude isn't allowed on this page. You can allow it from the page's permissions.",
      sampling_disabled: "Claude isn't available for this account.",
      rate_limited: "Too many requests or usage limit reached. Try again later.",
      refused: "Claude declined to answer that. Try asking differently.",
    };
    throw new EngineerError(messages[err.code ?? ""] ?? "Claude couldn't answer just now. Try again.", err.code === "refused" ? undefined : err.text);
  }
}

async function askApi(apiKey: string, prompt: string, opts: AskOptions): Promise<string> {
  // Loaded on demand so the dashboard doesn't carry the SDK until it's used.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // The key stays in this browser; it is sent only to api.anthropic.com.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium" },
      // If Claude Opus 5.5 declines, the API retries on a suitable fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{ role: "user", content: prompt }],
    },
    { signal: opts.signal },
  );
  stream.on("text", (_delta, snapshot) => opts.onText(snapshot));
  try {
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") throw new EngineerError("Claude declined to answer that. Try asking differently.");
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return message.stop_reason === "max_tokens" ? `${text}\n\n(Answer cut short.)` : text;
  } catch (e) {
    if (e instanceof EngineerError) throw e;
    if (e instanceof Anthropic.APIUserAbortError) throw new EngineerError("Stopped.");
    if (e instanceof Anthropic.AuthenticationError) throw new EngineerError("That API key wasn't accepted. Check it and try again.");
    if (e instanceof Anthropic.RateLimitError) throw new EngineerError("Rate limited by the API. Wait a moment and try again.");
    if (e instanceof Anthropic.APIConnectionError) throw new EngineerError("Couldn't reach the Anthropic API from this browser.");
    if (e instanceof Anthropic.APIError) throw new EngineerError(`The API returned an error (${e.status ?? "?"}). Try again.`);
    throw new EngineerError("Something went wrong asking Claude.");
  }
}

export async function askClaude(transport: Transport, prompt: string, opts: AskOptions, apiKey?: string | null): Promise<string> {
  if (transport === "page") {
    const sample = await pageSample();
    if (!sample) throw new EngineerError("Claude isn't available on this page.");
    return askPage(sample, prompt, opts);
  }
  if (!apiKey) throw new EngineerError("Add an Anthropic API key first.");
  return askApi(apiKey, prompt, opts);
}
