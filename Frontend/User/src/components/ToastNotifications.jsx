import React, { useEffect, useState } from 'react';

const ToastNotifications = ({ events = [] }) => {
  const [visibleToasts, setVisibleToasts] = useState([]);

  useEffect(() => {
    if (events.length > 0) {
      const newEvent = events[events.length - 1];
      const id = Date.now();
      
      setVisibleToasts(prev => [...prev.slice(-3), { ...newEvent, id }]);
      
      setTimeout(() => {
        setVisibleToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    }
  }, [events]);

  const getToastStyle = (type) => {
    switch (type) {
      case 'wicket':
        return 'bg-red-600 border-red-400 text-white';
      case 'four':
        return 'bg-blue-600 border-blue-400 text-white';
      case 'six':
        return 'bg-purple-600 border-purple-400 text-white';
      case '50':
      case '100':
        return 'bg-amber-500 border-amber-400 text-white';
      case 'over':
        return 'bg-slate-600 border-slate-400 text-white';
      case 'innings':
        return 'bg-purple-600 border-purple-400 text-white';
      case 'result':
        return 'bg-green-600 border-green-400 text-white';
      case 'drs':
        return 'bg-teal-600 border-teal-400 text-white';
      default:
        return 'bg-slate-700 border-slate-500 text-white';
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'wicket': return '🏏';
      case 'four': return '4';
      case 'six': return '6';
      case '50': return '5️⃣0';
      case '100': return '💯';
      case 'over': return '📊';
      case 'innings': return '🔄';
      case 'result': return '🏆';
      case 'drs': return '📺';
      default: return '•';
    }
  };

  if (visibleToasts.length === 0) return null;

  return (
    <div className="fixed top-20 right-4 z-50 flex flex-col gap-2">
      {visibleToasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-xl border-2 shadow-xl animate-slide-in-right ${getToastStyle(toast.type)}`}
        >
          <div className="flex items-center gap-3">
            <span className="text-lg">{getIcon(toast.type)}</span>
            <div>
              <p className="font-black text-sm uppercase">{toast.message || toast.type}</p>
              {toast.player && (
                <p className="text-xs opacity-90">{toast.player}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default ToastNotifications;