import React, { useEffect, useState } from "react";

export default function OfflineBanner({
  message = "You're offline — showing last saved data",
}) {
  const [offline, setOffline] = useState(null);

  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (offline === null || !offline) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[100] bg-amber-500 text-white text-center text-xs sm:text-sm font-bold px-4 py-2 shadow-lg"
    >
      ⚠ {message}
    </div>
  );
}