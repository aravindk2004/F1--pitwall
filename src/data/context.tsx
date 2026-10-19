import { createContext, useContext, type ReactNode } from "react";
import type { F1DataSource } from "./types";

const Ctx = createContext<F1DataSource | null>(null);

export function DataSourceProvider({ source, children }: { source: F1DataSource; children: ReactNode }) {
  return <Ctx.Provider value={source}>{children}</Ctx.Provider>;
}

export function useDataSource(): F1DataSource | null {
  return useContext(Ctx);
}
