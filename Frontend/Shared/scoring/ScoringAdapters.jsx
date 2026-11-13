import React, { createContext, useContext } from "react";

const ScoringAdaptersContext = createContext(null);

export function ScoringAdaptersProvider({ value, children }) {
  return (
    <ScoringAdaptersContext.Provider value={value}>
      {children}
    </ScoringAdaptersContext.Provider>
  );
}

export function useScoringAdapters() {
  const adapters = useContext(ScoringAdaptersContext);
  if (!adapters) {
    throw new Error("Scoring components must be rendered inside ScoringAdaptersProvider");
  }
  return adapters;
}
