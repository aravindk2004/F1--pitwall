import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** Keeps one broken panel from taking the whole dashboard down. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-white/5 bg-ink-900/80 p-4 text-sm text-white/50">
        <span>{this.props.name} unavailable</span>
        <button
          className="rounded-md border border-cyan-glow/40 px-3 py-1 text-xs text-cyan-glow hover:bg-cyan-glow/10"
          onClick={() => this.setState({ error: null })}
        >
          Retry
        </button>
      </div>
    );
  }
}
