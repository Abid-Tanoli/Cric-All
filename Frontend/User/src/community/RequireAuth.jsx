import { Link, useLocation } from "react-router-dom";
import { getStoredUser } from "../pages/auth/auth";

/**
 * Require a signed-in account for a page, otherwise render a friendly prompt
 * with a link back here after login. Mirrors the pattern MyPlayers uses
 * (<Navigate to="/login?next=…">) but renders inline so the surrounding shell
 * (header/footer) stays visible.
 */
export default function RequireAuth({ children, message = "Please sign in to continue." }) {
  const location = useLocation();
  const user = getStoredUser();
  if (!user?._id) {
    const next = encodeURIComponent(location.pathname + location.search);
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-sm font-bold text-cric-text">{message}</p>
        <Link
          to={`/login?next=${next}`}
          className="mt-4 inline-block rounded-lg bg-cric-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }
  return children;
}
