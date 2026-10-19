import { useEffect, useMemo } from "react";
import { createDataSource, DataSourceProvider, saveSourceKind } from "./data";
import { useDashboard } from "./state/store";
import { useKeyboardShortcuts } from "./hooks/useKeyboard";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { TopBar } from "./components/layout/TopBar";
import { TimingTower } from "./components/timing/TimingTower";
import { RadioFeed } from "./components/radio/RadioFeed";
import { TrackMap } from "./components/track/TrackMap";
import { PositionPanel } from "./components/positions/PositionPanel";
import { DriverHoverCard } from "./components/hover/DriverHoverCard";
import { RacePicker } from "./components/races/RacePicker";

export default function App() {
  const kind = useDashboard((s) => s.kind);
  const trackExpanded = useDashboard((s) => s.trackExpanded);
  const backend = useDashboard((s) => s.replayBackend);
  const source = useMemo(() => createDataSource(kind, backend), [kind, backend]);
  useKeyboardShortcuts();

  useEffect(() => {
    saveSourceKind(kind, backend);
    const push = () => useDashboard.getState().setSourceState(source.getSnapshot(), source.status(), source.mode());
    const unsubscribe = source.subscribe(push);
    source.start();
    push();
    return () => {
      unsubscribe();
      source.stop();
    };
  }, [source, kind, backend]);

  return (
    <DataSourceProvider source={source}>
      <div className="app-bg flex h-screen min-h-[640px] flex-col overflow-hidden text-white">
        <ErrorBoundary name="Top bar">
          <TopBar />
        </ErrorBoundary>
        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 lg:grid-cols-[minmax(540px,34%)_1fr] lg:overflow-hidden">
          <div className="min-h-[600px] lg:min-h-0">
            <ErrorBoundary name="Timing tower">
              <TimingTower />
            </ErrorBoundary>
          </div>
          {/* The map takes most of the right side; Expand (or M) gives it the whole column. */}
          <div
            className={`grid min-h-0 gap-3 ${
              trackExpanded ? "grid-rows-[minmax(520px,1fr)]" : "grid-rows-[170px_minmax(480px,1fr)] lg:grid-rows-[150px_1fr]"
            }`}
          >
            {!trackExpanded && (
              <ErrorBoundary name="Team radio">
                <RadioFeed />
              </ErrorBoundary>
            )}
            <div className={`grid min-h-0 gap-3 ${trackExpanded ? "grid-cols-1" : "grid-cols-[1fr_210px]"}`}>
              <ErrorBoundary name="Track map">
                <TrackMap />
              </ErrorBoundary>
              {!trackExpanded && (
                <ErrorBoundary name="Positions">
                  <PositionPanel />
                </ErrorBoundary>
              )}
            </div>
          </div>
        </main>
        <ErrorBoundary name="Driver card">
          <DriverHoverCard />
        </ErrorBoundary>
        <ErrorBoundary name="Race picker">
          <RacePicker />
        </ErrorBoundary>
      </div>
    </DataSourceProvider>
  );
}
