import React from "react";
import api from "../../services/api";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedMatchSetupWizard from "../../../../Shared/scoring/components/ScoreManagement/MatchSetupWizard";

export default function MatchSetupWizard(props) {
  return (
    <ScoringAdaptersProvider value={{ api, allowFormatEdit: true, allowRuleEdit: true, allowSquadSetup: true }}>
      <SharedMatchSetupWizard {...props} />
    </ScoringAdaptersProvider>
  );
}
