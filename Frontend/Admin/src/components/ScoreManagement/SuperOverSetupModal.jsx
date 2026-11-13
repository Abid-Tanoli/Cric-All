import React from "react";
import { useToast } from "../Toast";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedSuperOverSetupModal from "../../../../Shared/scoring/components/ScoreManagement/SuperOverSetupModal";

export default function SuperOverSetupModal(props) {
  const toast = useToast();
  return (
    <ScoringAdaptersProvider value={{ showToast: toast?.showToast }}>
      <SharedSuperOverSetupModal {...props} />
    </ScoringAdaptersProvider>
  );
}
