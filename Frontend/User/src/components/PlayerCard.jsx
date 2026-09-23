import React from "react";
import { Link } from "react-router-dom";
import SafeImage from "../../../Shared/components/SafeImage.jsx";

const PlayerCard = ({ player }) => {
  return (
    <div className="group relative bg-cric-card rounded-3xl shadow-sm hover:shadow-2xl border border-cric-border overflow-hidden transition-all duration-500 hover:-translate-y-1">
      {/* Abstract background accent */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-cric-bg rounded-bl-full -mr-16 -mt-16 group-hover:bg-cric-bg transition-colors duration-500" />
      
      <div className="p-6 relative">
        <div className="flex items-center gap-5 mb-6">
          <div className="relative shrink-0">
             {player.imageUrl ? (
                <SafeImage src={player.imageUrl} alt={player.name} className="w-16 h-16 rounded-2xl object-cover bg-cric-bg shadow-inner group-hover:scale-105 transition-transform" />
              ) : (
                <div className="w-16 h-16 rounded-2xl bg-cric-accent flex items-center justify-center text-white font-black text-xl italic italic">
                 {player.name?.substring(0, 2).toUpperCase()}
               </div>
             )}
             <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-lg flex items-center justify-center border-2 border-white shadow-lg">
                <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
             </div>
          </div>
          <div className="flex-1 min-w-0">
              <h4 className="font-black text-cric-text uppercase tracking-tighter truncate leading-tight group-hover:text-cric-accent transition-colors">{player.name}</h4>
              <p className="text-[9px] font-black text-cric-muted uppercase tracking-widest mb-1">{player.role || "Prospect"}</p>
              <p className="text-[8px] font-bold text-cric-accent bg-cric-bg px-2 py-0.5 rounded-full inline-block uppercase tracking-wider">
               {player.team?.name || player.team || "Free Agent"}
             </p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-cric-bg rounded-2xl p-3 border border-cric-border group-hover:bg-cric-card transition-colors">
               <p className="text-[8px] font-black text-cric-muted uppercase tracking-widest mb-1">Career Runs</p>
               <p className="text-lg font-black text-cric-accent">{player.stats?.runs || 0}</p>
            </div>
            <div className="bg-cric-bg rounded-2xl p-3 border border-cric-border group-hover:bg-cric-card transition-colors">
               <p className="text-[8px] font-black text-cric-muted uppercase tracking-widest mb-1">Wickets</p>
              <p className="text-lg font-black text-red-600">{player.stats?.wickets || 0}</p>
           </div>
        </div>

        <Link
          to={`/players/${player._id}`}
          className="block w-full py-3 bg-cric-bg hover:bg-cric-accent hover:text-white text-cric-accent font-black text-[9px] uppercase tracking-widest rounded-xl transition-all text-center border border-cric-border group-hover:border-transparent"
        >
          Full Bio & Stats
        </Link>
      </div>
    </div>
  );
};

export default PlayerCard;
