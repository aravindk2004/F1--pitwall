import {
  emptySnapshot,
  type F1DataSource,
  type F1Snapshot,
  type Listener,
  type PlaybackSpeed,
  type ReplayControls,
  type SessionOption,
  type SourceKind,
  type SourceMode,
  type SourceStatus,
} from "./types";
import { Timeline, type HeavyState, type TimelineDataset } from "./timeline";
import { trackGeometry, type TrackGeometry } from "./track";
import type { LapTrace, Point } from "./types";

const HEAVY_INTERVAL_MS = 200;

/** Playback clock + snapshot assembly for any source backed by a Timeline. */
export abstract class ReplayRuntime implements F1DataSource, ReplayControls {
  abstract readonly kind: SourceKind;
  abstract readonly selectableSessions: boolean;
  abstract readonly seasons: number[];
  abstract readonly sourceLabel: string;
  abstract listSessions(year: number): Promise<SessionOption[]>;
  abstract loadSession(key: number): Promise<void>;
  abstract currentSessionKey(): number | null;

  readonly replay: ReplayControls = this;

  protected timeline: Timeline | null = null;
  private geometry: TrackGeometry | null = null;
  private snapshot: F1Snapshot = emptySnapshot();
  private listeners = new Set<Listener>();
  private playing = false;
  private speed: PlaybackSpeed = 1;
  private time = 0;
  private raf: number | null = null;
  private lastFrame = 0;
  private lastHeavy = 0;
  private heavy: HeavyState | null = null;
  private needsHeavy = false;
  private needsTelemetry = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): F1Snapshot {
    return this.snapshot;
  }

  status(): SourceStatus {
    return this.timeline ? "REPLAY" : "OFFLINE";
  }

  mode(): SourceMode {
    return "replay";
  }

  start(): void {
    if (this.raf != null) return;
    this.lastFrame = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame();
      } catch (err) {
        console.error("replay frame failed", err);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  play(): void {
    if (!this.timeline) return;
    if (this.time >= this.timeline.end) this.time = this.timeline.start;
    this.playing = true;
    this.needsTelemetry = true;
  }

  pause(): void {
    this.playing = false;
    this.needsTelemetry = true;
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
    this.needsTelemetry = true;
  }

  pastLocation(driver: number, secondsAgo: number): Point | null {
    if (!this.timeline) return null;
    const t = this.time - secondsAgo * 1000;
    this.timeline.ensureTelemetry(t);
    return this.timeline.locationAt(driver, t);
  }

  async lapTrace(driver: number, lap: number): Promise<LapTrace | null> {
    const tl = this.timeline;
    if (!tl) return null;
    const geo = this.geometry;
    return tl.lapTrace(driver, lap, (p) => geo?.fractionOf(p) ?? null);
  }

  seek(time: number): void {
    if (!this.timeline) return;
    this.time = Math.min(this.timeline.end, Math.max(this.timeline.start, time));
    this.needsHeavy = true;
    this.needsTelemetry = true;
  }

  protected setDataset(ds: TimelineDataset, autoplay = true): void {
    const timeline = new Timeline(ds);
    timeline.setChunkListener(() => (this.needsTelemetry = true));
    this.timeline = timeline;
    this.geometry = trackGeometry(ds.track);
    this.time = ds.start;
    this.playing = autoplay;
    this.heavy = null;
    this.needsHeavy = true;
    this.needsTelemetry = true;
    this.update({
      session: ds.session,
      track: ds.track,
      standings: ds.standings ?? null,
      loading: null,
      error: null,
      locations: {},
      car: {},
    });
  }

  protected clearDataset(): void {
    this.timeline = null;
    this.playing = false;
    this.heavy = null;
    this.geometry = null;
    this.snapshot = emptySnapshot();
    this.emit();
  }

  protected update(patch: Partial<F1Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
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

  private frame(): void {
    const now = performance.now();
    const dt = Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    const tl = this.timeline;
    if (!tl) return;

    if (this.playing) {
      this.time += dt * this.speed;
      if (this.time >= tl.end) {
        this.time = tl.end;
        this.playing = false;
      }
    }
    tl.ensureTelemetry(this.time);

    const patch: Partial<F1Snapshot> = {};
    if (this.needsHeavy || !this.heavy || (this.playing && now - this.lastHeavy > HEAVY_INTERVAL_MS)) {
      this.heavy = tl.computeHeavy(this.time);
      this.lastHeavy = now;
      this.needsHeavy = false;
      Object.assign(patch, this.heavy);
    }
    if (this.playing || this.needsTelemetry) {
      const heavy = this.heavy;
      const { locations, car } = tl.telemetryAt(this.time, (d) => heavy?.drivers[d]?.retired ?? false);
      patch.locations = locations;
      patch.car = car;
      patch.playback = { playing: this.playing, speed: this.speed, time: this.time, start: tl.start, end: tl.end };
      patch.now = this.time;
      patch.loading = tl.isTelemetryLoading(this.time) && Object.keys(locations).length === 0 ? "Loading telemetry…" : null;
      this.needsTelemetry = false;
    }
    if (Object.keys(patch).length) this.update(patch);
  }
}
