import type { ReactNode } from "react";

interface Props {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ title, right, children, className = "", bodyClassName = "" }: Props) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900/85 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_20px_40px_-20px_rgba(0,0,0,0.8)] backdrop-blur ${className}`}>
      <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] px-3">
        <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
          <span className="h-3 w-[3px] rounded-full bg-cyan-glow shadow-[0_0_8px_#22e5ff]" />
          {title}
        </h2>
        {right}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
