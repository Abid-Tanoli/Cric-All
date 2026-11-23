import React, { useEffect, useState } from "react";
import api from "../services/api";

const errorText = (error) =>
  error?.response?.data?.message || error?.message || "Something went wrong";

/**
 * Support view for the email-only verification gate. Shows each User's
 * emailVerified state and lets staff mark an address verified for genuine
 * delivery failures. The backend writes an audit entry for every override,
 * including no-ops; this screen never issues or displays a verification code.
 */
export default function EmailVerificationSupport() {
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noteFor, setNoteFor] = useState(null);
  const [note, setNote] = useState("");

  const load = async () => {
    setBusy(true);
    setError("");
    try {
      const params = { page, limit: 25, search: term };
      if (filter) params.emailVerified = filter;
      const { data } = await api.get("/admin/users", { params });
      setUsers(data?.users || []);
      setTotal(data?.total || 0);
      setPages(data?.pages || 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, term, filter]);

  const markVerified = async (user) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.post(`/admin/users/${user._id}/mark-email-verified`, { note });
      setNotice(data?.message || "Email marked verified. The override was audited.");
      setNoteFor(null);
      setNote("");
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-cric-bg p-6 lg:p-10">
      <div className="mb-8">
        <h1 className="text-3xl font-black uppercase tracking-widest text-cric-text">
          Email verification support
        </h1>
        <p className="mt-2 text-sm text-cric-muted">
          {total} user account{total === 1 ? "" : "s"}. Marking an email verified manually is
          recorded in the audit log. Phone numbers are never verified by this app.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          aria-label="Search users"
          placeholder="Search name or email…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setPage(1);
              setTerm(search);
            }
          }}
          className="min-w-64 flex-1 rounded-xl border border-cric-border bg-cric-card px-4 py-3 text-sm text-cric-text"
        />
        <button
          type="button"
          onClick={() => {
            setPage(1);
            setTerm(search);
          }}
          className="rounded-xl bg-cric-accent px-4 py-3 text-xs font-black uppercase tracking-widest text-white"
        >
          Search
        </button>
        <select
          aria-label="Email verification filter"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
            setPage(1);
          }}
          className="rounded-xl border border-cric-border bg-cric-card px-4 py-3 text-sm text-cric-text"
        >
          <option value="">All users</option>
          <option value="false">Unverified</option>
          <option value="true">Verified</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-cric-border bg-cric-card">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Email verified</th>
              <th className="p-3 text-left">Phone</th>
              <th className="p-3 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id} className="border-t border-cric-border">
                <td className="p-3 font-bold text-cric-text">{user.name || "—"}</td>
                <td className="p-3 text-cric-muted">{user.email || "—"}</td>
                <td className="p-3">
                  <span
                    data-testid={`email-verified-${user._id}`}
                    className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      user.emailVerified
                        ? "bg-green-500/15 text-green-600"
                        : "bg-cric-accent/15 text-cric-accent"
                    }`}
                  >
                    {user.emailVerified ? "Verified" : "Not verified"}
                  </span>
                </td>
                <td className="p-3 text-cric-muted">Not verified</td>
                <td className="p-3">
                  {user.emailVerified ? (
                    <span className="text-[10px] text-cric-muted">—</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || noteFor === user._id}
                      onClick={() => {
                        setNoteFor(user._id);
                        setNote("");
                      }}
                      className="rounded-lg bg-cric-accent px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-50"
                    >
                      Mark verified
                    </button>
                  )}
                  {noteFor === user._id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input
                        aria-label={`Support note for ${user.name || user.email}`}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        maxLength={500}
                        placeholder="Why? (audited)"
                        className="rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-xs text-cric-text"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => markVerified(user)}
                        className="rounded-lg bg-cric-text px-3 py-2 text-[10px] font-black uppercase tracking-widest text-cric-bg disabled:opacity-50"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => setNoteFor(null)}
                        className="text-[10px] font-black uppercase tracking-widest text-cric-muted underline"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!users.length && !busy && (
              <tr>
                <td colSpan={5} className="p-6 text-center text-sm text-cric-muted">
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4 text-xs font-black text-cric-muted">
          <button type="button" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page} of {pages}</span>
          <button type="button" disabled={page >= pages || busy} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
