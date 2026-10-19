import type { SourceKind } from "./types";

/** Where Replay mode gets its races. */
export type ReplayBackend = "library" | "openf1";

/** A static build (hosted demo) has no bridge and cannot reach external APIs. */
export const STATIC_SITE = import.meta.env.VITE_STATIC_SITE === "1";
export const AVAILABLE_KINDS: SourceKind[] = STATIC_SITE ? ["replay", "mock"] : ["live", "replay", "mock"];
export const AVAILABLE_BACKENDS: ReplayBackend[] = STATIC_SITE ? ["library"] : ["openf1", "library"];
