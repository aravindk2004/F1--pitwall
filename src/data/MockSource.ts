import { ReplayRuntime } from "./replayRuntime";
import { createMockDataset } from "./mock/mockData";
import type { SessionOption } from "./types";

/** Plays the bundled synthetic race through the replay engine. Works offline. */
export class MockSource extends ReplayRuntime {
  readonly kind = "mock" as const;
  readonly selectableSessions = false;
  readonly seasons = [2025];
  readonly sourceLabel = "Offline mock race";

  override start(): void {
    super.start();
    if (!this.timeline) this.setDataset(createMockDataset());
  }

  async listSessions(): Promise<SessionOption[]> {
    return [{ key: 0, label: "Synthetica — Race (mock)", year: 2025, date: 0 }];
  }

  async loadSession(): Promise<void> {
    this.setDataset(createMockDataset());
  }

  currentSessionKey(): number | null {
    return 0;
  }
}
