import React from "react";
import api from "../../services/api";
import { ScoringAdaptersProvider } from "../../../../Shared/scoring/ScoringAdapters";
import SharedPlayerOfMatchCard from "../../../../Shared/scoring/components/ScoreManagement/PlayerOfMatchCard";

export default function PlayerOfMatchCard(props) {
  return (
    <ScoringAdaptersProvider value={{ api, showToast: props.showToast }}>
      <SharedPlayerOfMatchCard {...props} />
    </ScoringAdaptersProvider>
  );
}
