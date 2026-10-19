import { useEffect } from "react";
import { STAT_VIEWS, useDashboard } from "../state/store";
import { toggleFullscreen } from "../components/layout/TopBar";

/** Space: pause cycling · 1–5: pick stat view · F: fullscreen · M: enlarge the map. */
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))) {
        if (!(el.tagName === "INPUT" && (el as HTMLInputElement).type === "range")) return;
      }
      const s = useDashboard.getState();
      if (e.code === "Space") {
        e.preventDefault();
        s.toggleCyclePaused();
      } else if (/^[1-9]$/.test(e.key) && Number(e.key) <= STAT_VIEWS.length) {
        s.setView(Number(e.key) - 1);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "m" || e.key === "M") {
        s.toggleTrackExpanded();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
