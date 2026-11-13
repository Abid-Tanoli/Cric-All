import React from "react";
import api from "../../services/api";
import { useToast } from "../Toast";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedImpactPlayerSetup from "../../../../Shared/scoring/components/ScoreManagement/ImpactPlayerSetup";

export default function ImpactPlayerSetup(props) {
  const toast = useToast();
  return (
    <ScoringAdaptersProvider value={{ api, showToast: toast?.showToast }}>
      <SharedImpactPlayerSetup {...props} />
    </ScoringAdaptersProvider>
  );
}
