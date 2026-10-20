import type { PointerEvent } from "react";
import { useDashboard } from "../state/store";

/**
 * Hover handlers for anything that represents a driver. Only a real mouse
 * hovers: on touch screens a tap selects the driver instead (see the docked card).
 */
export function useDriverHover() {
  const setHovered = useDashboard((s) => s.setHovered);
  return (driver: number) => ({
    onPointerEnter: (e: PointerEvent) => e.pointerType === "mouse" && setHovered({ driver, x: e.clientX, y: e.clientY }),
    onPointerMove: (e: PointerEvent) => e.pointerType === "mouse" && setHovered({ driver, x: e.clientX, y: e.clientY }),
    onPointerLeave: (e: PointerEvent) => e.pointerType === "mouse" && setHovered(null),
  });
}
