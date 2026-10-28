import { number, idOf, sameId, longTeamName, playerName, formatDate, getTossLine, getPlayingXI, statusLabel } from "../utils/matchHelpers";
import InfoCard from "./InfoCard";
import InfoRow from "./InfoRow";
import BattingPositionBadge from "@shared/components/BattingPositionBadge";

export default function MatchInfoTab({ match }) {
  const weather = match.weather?.condition
    ? `${match.weather.condition}${match.weather.temperature ? `, ${match.weather.temperature}C` : ""}`
    : "Not available";
  const umpires = (match.umpires || []).map((umpire) => `${umpire.name}${umpire.role ? ` (${umpire.role})` : ""}`).join(", ");
  const address = match.address
    ? [match.address.town, match.address.district, match.address.city, match.address.province, match.address.country].filter(Boolean).join(", ")
    : "";

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <InfoCard title="Match Details">
        <InfoRow label="Venue" value={match.venue || "TBC"} />
        <InfoRow label="Address" value={address || "Not available"} />
        <InfoRow label="Date" value={formatDate(match.startAt)} />
        <InfoRow label="Match Type" value={match.matchType || "T20"} />
        <InfoRow label="Category" value={[match.matchCategory || match.category, match.subCategory, match.ageGroup].filter(Boolean).join(" - ")} />
      </InfoCard>
      <InfoCard title="Officials & Conditions">
        <InfoRow label="Toss" value={getTossLine(match)} />
        <InfoRow label="Umpires" value={umpires || "Not available"} />
        <InfoRow label="Series" value={match.series || "Not available"} />
        <InfoRow label="Weather" value={weather} />
        <InfoRow label="Status" value={statusLabel(match.status)} />
      </InfoCard>
      {(match.teams || []).map((team) => (
        <InfoCard key={idOf(team)} title={`${longTeamName(team)} Playing XI`}>
          {getPlayingXI(match, team).length ? (
            <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs sm:text-sm leading-6 sm:leading-7 text-cric-text">
              {getPlayingXI(match, team).map((player, index) => (
                <span key={idOf(player) || index} className="inline-flex items-center gap-1">
                  <span>{playerName(player)}{index < getPlayingXI(match, team).length - 1 ? "," : ""}</span>
                  <BattingPositionBadge value={player?.battingPosition} />
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs sm:text-sm leading-6 sm:leading-7 text-cric-text">Playing XI not announced</p>
          )}
        </InfoCard>
      ))}
    </section>
  );
}
