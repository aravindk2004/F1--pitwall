import {
  emptySnapshot,
  type F1DataSource,
  type F1Snapshot,
  type Listener,
  type SourceMode,
  type SourceStatus,
  type Topic,
  type TopicHealth,
} from "./types";
import { LiveState } from "./liveState";

export const DEFAULT_BRIDGE_URL = "ws://localhost:8765";

const STALE_AFTER_MS = 5000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
/** Render cars this far behind the newest sample so there is always a "next" point to glide to. */
const RENDER_BUFFER_MS = 1200;
/** Topics that stream continuously while cars are on track. */
const STREAMING_TOPICS: Topic[] = ["car_data", "location"];

interface BridgeMessage {
  topic?: string;
  data?: unknown;
}

/** Consumes the local Python bridge (FastF1 live timing → WebSocket). */
export class LiveBridgeSource implements F1DataSource {
  readonly kind = "live" as const;
  private ws: WebSocket | null = null;
  private connected = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private raf: number | null = null;
  private stopped = true;
  private state = new LiveState();
  private lastMessage: Partial<Record<string, number>> = {};
  private lastAny: number | null = null;
  private snapshot: F1Snapshot = emptySnapshot();
  private listeners = new Set<Listener>();
  private dirty = false;
  private currentStatus: SourceStatus = "OFFLINE";

  constructor(private url: string = DEFAULT_BRIDGE_URL) {}

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): F1Snapshot {
    return this.snapshot;
  }

  status(): SourceStatus {
    return this.currentStatus;
  }

  mode(): SourceMode {
    return "live";
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
    this.healthTimer = setInterval(() => this.checkHealth(), 1000);
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.reconnectTimer = this.healthTimer = null;
    this.raf = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.connected = false;
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect(`Bad bridge URL: ${(err as Error).message}`);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.attempts = 0;
      this.patch({ error: null, loading: "Connected — waiting for timing data…" });
      this.checkHealth();
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onerror = () => {
      /* onclose follows and handles reconnect */
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.ws = null;
      this.scheduleReconnect(`Bridge not reachable at ${this.url}`);
    };
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempts) * (0.8 + Math.random() * 0.4);
    this.attempts++;
    this.patch({ error: `${reason}. Retrying in ${Math.round(delay / 1000)}s…`, loading: null });
    this.checkHealth();
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private onMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(raw) as BridgeMessage;
    } catch {
      return;
    }
    if (!msg || typeof msg.topic !== "string") return;
    const now = Date.now();
    this.lastMessage[msg.topic] = now;
    this.lastAny = now;
    try {
      if (this.state.apply(msg.topic, msg.data)) this.dirty = true;
    } catch (err) {
      console.warn("bad bridge message", msg.topic, err);
    }
    if (this.snapshot.loading) this.patch({ loading: null });
  }

  private topicHealth(now: number): Partial<Record<Topic, TopicHealth>> {
    const out: Partial<Record<Topic, TopicHealth>> = {};
    for (const [topic, last] of Object.entries(this.lastMessage)) {
      if (last == null) continue;
      out[topic as Topic] = { lastMessage: last, stale: now - last > STALE_AFTER_MS };
    }
    return out;
  }

  private checkHealth(): void {
    const now = Date.now();
    const topics = this.topicHealth(now);
    let status: SourceStatus;
    if (!this.connected) status = "OFFLINE";
    else if (this.lastAny == null || now - this.lastAny > STALE_AFTER_MS) status = "STALE";
    else if (STREAMING_TOPICS.some((t) => topics[t]?.stale)) status = "STALE";
    else status = "LIVE";
    this.currentStatus = status;
    this.patch({ topics });
  }

  private frame(): void {
    let next = this.snapshot;
    if (this.dirty) {
      next = this.state.build(next);
      this.dirty = false;
    }
    const latest = this.state.locations.latestTime();
    if (latest != null) {
      const renderAt = Date.now() - (this.state.latency ?? 0) - RENDER_BUFFER_MS;
      const all = this.state.locations.sampleAll(Math.min(renderAt, latest));
      for (const n of Object.keys(all)) if (this.state.isRetired(Number(n))) delete all[Number(n)];
      next = { ...next, locations: all };
    }
    if (next !== this.snapshot) {
      this.snapshot = next;
      this.emit();
    }
  }

  private patch(p: Partial<F1Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...p };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) {
      try {
        l(this.snapshot);
      } catch (err) {
        console.error("listener failed", err);
      }
    }
  }
}
