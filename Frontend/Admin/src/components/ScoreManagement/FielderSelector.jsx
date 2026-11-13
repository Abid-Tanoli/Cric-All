import React from "react";
import api from "../../services/api";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedFielderSelector from "../../../../Shared/scoring/components/ScoreManagement/FielderSelector";

export default function FielderSelector(props) {
  return (
    <ScoringAdaptersProvider value={{ api }}>
      <SharedFielderSelector {...props} />
    </ScoringAdaptersProvider>
  );
}
