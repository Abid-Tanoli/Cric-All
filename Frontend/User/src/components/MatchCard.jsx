import { memo } from "react";
import { Link } from "react-router-dom";

const MatchCardComponent = ({ match }) => {
  const matchTitle = match?.title || `${match?.teams?.[0]?.name || 'Team A'} vs ${match?.teams?.[1]?.name || 'Team B'}`;
  
  return (
    <Link to={`/match/${match?._id}`}>
      <div className="border p-4 rounded shadow hover:bg-gray-50 transition-colors">
        <h3 className="font-bold">{matchTitle}</h3>
        <p className="text-sm text-slate-500">Status: {match?.status || 'Unknown'}</p>
        <p className="text-sm text-slate-500">Overs: {match?.totalOvers || 20}</p>
      </div>
    </Link>
  );
};

export default memo(MatchCardComponent);
