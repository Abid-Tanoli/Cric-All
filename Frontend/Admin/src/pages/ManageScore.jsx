import React from "react";
import { NavLink, useNavigate, useParams } from "react-router-dom";
import { API_BASE_URL } from "../../../Shared/config/env.js";
import MatchSettings from "../components/MatchSettings";
import ConfirmModal from "../components/ConfirmModal";
import { useLayoutContext } from "../context/LayoutContext";
import { useToast } from "../components/Toast";
import { api } from "../services/api";
import { getSocket, joinMatchRoom, leaveMatchRoom } from "../store/socket";
import { getScoreTabPath } from "../components/ScoreManagement/constants";
import { ScoringAdaptersProvider } from "../../../Shared/scoring/ScoringAdapters";
import SharedManageScore from "../../../Shared/scoring/ManageScore";

export default function ManageScore() {
  const navigate = useNavigate();
  const { matchId, tabId } = useParams();
  const layout = useLayoutContext();
  const toast = useToast();
  const adapters = {
    api,
    apiBaseUrl: API_BASE_URL,
    getToken: () => localStorage.getItem("token") || localStorage.getItem("bq_token"),
    socket: getSocket(),
    getSocket,
    joinMatchRoom,
    leaveMatchRoom,
    showToast: toast?.showToast,
    navigate,
    buildScorePath: getScoreTabPath,
    LinkComponent: NavLink,
    buildScoreListPath: () => "/admin/score",
    buildEventsPath: () => "/admin/events",
    allowSettings: true,
    allowDeleteMatch: true,
    allowFormatEdit: true,
    allowRuleEdit: true,
    allowSquadSetup: true,
    SettingsComponent: MatchSettings,
    ConfirmModal,
    onToggleMenu: layout?.toggleSidebar,
    fetchMatches: async () => {
      const response = await api.get("/matches");
      return response.data?.matches || response.data || [];
    },
  };

  return (
    <ScoringAdaptersProvider value={adapters}>
      <SharedManageScore matchId={matchId} tabId={tabId} />
    </ScoringAdaptersProvider>
  );
}
