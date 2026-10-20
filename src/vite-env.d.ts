/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" for a static build with no bridge or external APIs (e.g. a hosted demo). */
  readonly VITE_STATIC_SITE?: string;
  /** Default replay backend: "openf1" or "library". */
  readonly VITE_REPLAY_BACKEND?: string;
  /** "page" when the build runs inside Claude, where the race engineer uses the viewer's account only. */
  readonly VITE_ENGINEER?: string;
}
