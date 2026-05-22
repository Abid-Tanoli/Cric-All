import React, { memo } from "react";
import { Link } from "react-router-dom";

const MatchListComponent = function MatchList({ matches, selected, onSelect }) {
  const matchesArray = Array.isArray(matches) ? matches : [];

  if (!matchesArray.length) return <div className="text-gray-500">No matches available</div>;

  return (
    <ul className="space-y-2 overflow-y-auto max-h-[80vh]">
      {matchesArray.map((match) => (
        <li key={match._id}>
          <Link
            to={`/match/${match._id}`}
            onClick={() => onSelect?.(match)}
            className={`block p-3 rounded cursor-pointer transition-all ${selected?._id === match._id
                ? "bg-blue-600 text-white font-semibold"
                : "bg-gray-100 hover:bg-gray-200"
              }`}
          >
            {match.title || `${match.teams?.[0]?.name || 'Team A'} vs ${match.teams?.[1]?.name || 'Team B'}`}
          </Link>
        </li>
      ))}
</ul>
  );
};

export default memo(MatchListComponent);
