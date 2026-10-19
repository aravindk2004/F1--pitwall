// The only entry point the UI uses to obtain data. Components receive an
// F1DataSource through context and never import a provider module.

import type { F1DataSource, SourceKind } from "./types";
import { DEFAULT_BRIDGE_URL, LiveBridgeSource } from "./LiveBridgeSource";
import { OpenF1ReplaySource } from "./OpenF1ReplaySource";
import { LibraryReplaySource } from "./LibraryReplaySource";
import { MockSource } from "./MockSource";

import { AVAILABLE_BACKENDS, AVAILABLE_KINDS, STATIC_SITE, type ReplayBackend } from "./config";

export * from "./types";
export * from "./config";
export { DataSourceProvider, useDataSource } from "./context";

const SETTING_KEY = "f1dash.source";
const BACKEND_KEY = "f1dash.replayBackend";

function readParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/** Resolve the startup source: ?source=live|replay|mock, then saved setting, then a default. */
export function initialSourceKind(): SourceKind {
  for (const v of [readParam("source"), readSetting(SETTING_KEY)]) {
    if (v && (AVAILABLE_KINDS as string[]).includes(v)) return v as SourceKind;
  }
  return STATIC_SITE ? "replay" : "mock";
}

/** Resolve the replay backend: ?replay=library|openf1, then saved setting, then build default. */
export function initialReplayBackend(): ReplayBackend {
  const fallback = (import.meta.env.VITE_REPLAY_BACKEND as ReplayBackend | undefined) ?? "openf1";
  for (const v of [readParam("replay"), readSetting(BACKEND_KEY), fallback]) {
    if (v && (AVAILABLE_BACKENDS as string[]).includes(v)) return v as ReplayBackend;
  }
  return AVAILABLE_BACKENDS[0];
}

export function saveSourceKind(kind: SourceKind, backend: ReplayBackend): void {
  writeSetting(SETTING_KEY, kind);
  writeSetting(BACKEND_KEY, backend);
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("source", kind);
    if (kind === "replay" && !STATIC_SITE) url.searchParams.set("replay", backend);
    else url.searchParams.delete("replay");
    window.history.replaceState(null, "", url);
  } catch {
    /* ignore */
  }
}

export function createDataSource(kind: SourceKind, backend: ReplayBackend): F1DataSource {
  switch (kind) {
    case "live":
      return new LiveBridgeSource(readParam("bridge") ?? DEFAULT_BRIDGE_URL);
    case "replay": {
      const session = Number(readParam("session"));
      const initial = Number.isFinite(session) && session > 0 ? session : null;
      return backend === "library" ? new LibraryReplaySource("races/", initial) : new OpenF1ReplaySource(initial);
    }
    default:
      return new MockSource();
  }
}
