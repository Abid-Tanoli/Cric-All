import React, { useCallback, useEffect, useState } from "react";
import * as issuesApi from "../services/issuesApi";

const STATUSES = ["open", "in_review", "resolved", "rejected"];
const DELETABLE_TARGETS = new Set(["match", "event", "tournament", "series"]);

const statusClass = {
  open: "border-amber-300 bg-amber-100 text-amber-900",
  in_review: "border-blue-300 bg-blue-100 text-blue-900",
  resolved: "border-green-300 bg-green-100 text-green-900",
  rejected: "border-red-300 bg-red-100 text-red-900",
};

const label = (value) => String(value || "").replace(/_/g, " ");
const panel = "rounded-2xl border border-cric-border bg-cric-card p-5 shadow-sm";
const fieldClass = "min-h-11 rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm font-semibold text-cric-text";
const buttonClass = "min-h-11 rounded-lg border border-cric-border px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-text disabled:opacity-50";

export default function Issues() {
  const [status, setStatus] = useState("open");
  const [type, setType] = useState("");
  const [organization, setOrganization] = useState("");
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [reply, setReply] = useState("");
  const [nextStatus, setNextStatus] = useState("in_review");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await issuesApi.listIssues({
        status: status || undefined,
        type: type || undefined,
        organization: organization.trim() || undefined,
      });
      const nextItems = Array.isArray(response?.items) ? response.items : [];
      setItems(nextItems);
      if (selectedId && !nextItems.some((item) => item._id === selectedId)) {
        setSelectedId(null);
        setDetail(null);
      }
      return nextItems;
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not load reports.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [status, type, organization, selectedId]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const selectReport = async (issueId) => {
    setSelectedId(issueId);
    setDetail(null);
    setError("");
    try {
      const response = await issuesApi.getIssue(issueId);
      setDetail(response.report);
      setReply(response.report?.adminReply || "");
      setNextStatus(response.report?.status || "in_review");
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not load this report.");
    }
  };

  const refreshSelected = async () => {
    const nextItems = await loadList();
    if (selectedId && nextItems?.some((item) => item._id === selectedId)) {
      await selectReport(selectedId);
    } else {
      setSelectedId(null);
      setDetail(null);
    }
    window.dispatchEvent(new Event("bq-issues-changed"));
  };

  const sendReply = async (event) => {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await issuesApi.replyToIssue(selectedId, reply);
      await refreshSelected();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not save the reply.");
    } finally {
      setBusy(false);
    }
  };

  const saveStatus = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await issuesApi.updateIssueStatus(selectedId, {
        status: nextStatus,
        ...(nextStatus === "rejected" ? { adminReply: reply } : {}),
      });
      await refreshSelected();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not update status.");
    } finally {
      setBusy(false);
    }
  };

  const approveDelete = async () => {
    if (!selectedId) return;
    setBusy(true);
    setError("");
    try {
      await issuesApi.approveAndDeleteIssue(selectedId);
      setConfirmDelete(false);
      await refreshSelected();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not approve deletion.");
    } finally {
      setBusy(false);
    }
  };

  const canApproveDelete =
    detail?.type === "deletion_request" &&
    DELETABLE_TARGETS.has(detail.targetType) &&
    Boolean(detail.targetId) &&
    !["resolved", "rejected"].includes(detail.status);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-black uppercase tracking-tight text-cric-text">Issues inbox</h1>
        <p className="mt-1 text-xs font-semibold text-cric-muted">
          Review organization issues and deletion requests.
        </p>
      </header>

      <div className={`${panel} flex flex-wrap items-end gap-3`}>
        <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
          Status
          <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
            <option value="">All statuses</option>
            {STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
          Type
          <select value={type} onChange={(event) => setType(event.target.value)} className={fieldClass}>
            <option value="">All types</option>
            <option value="issue">Issue</option>
            <option value="deletion_request">Deletion request</option>
          </select>
        </label>
        <label className="flex min-w-56 flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
          Organization ID
          <input value={organization} onChange={(event) => setOrganization(event.target.value)} className={fieldClass} />
        </label>
        <button type="button" onClick={loadList} className={buttonClass}>Apply filters</button>
      </div>

      {error ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.2fr)]">
        <section className={`${panel} space-y-3`}>
          <h2 className="text-sm font-black uppercase tracking-widest text-cric-text">Reports</h2>
          {loading ? <p className="text-sm font-semibold text-cric-muted">Loading…</p> : items.length === 0 ? (
            <p className="text-sm font-semibold text-cric-muted">No reports match these filters.</p>
          ) : items.map((item) => (
            <button
              type="button"
              key={item._id}
              onClick={() => selectReport(item._id)}
              className={`w-full rounded-xl border p-3 text-left transition ${selectedId === item._id ? "border-cric-accent bg-cric-accent/10" : "border-cric-border bg-cric-bg hover:border-cric-accent"}`}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-words text-sm font-black text-cric-text">{item.subject}</span>
                <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase ${statusClass[item.status] || ""}`}>{label(item.status)}</span>
              </span>
              <span className="mt-1 block text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                {item.organization?.name || "Organization"} · {label(item.type)}
              </span>
            </button>
          ))}
        </section>

        <section className={`${panel} min-w-0`}>
          {!selectedId ? <p className="text-sm font-semibold text-cric-muted">Select a report to view details.</p> : !detail ? (
            <p className="text-sm font-semibold text-cric-muted">Loading report…</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">
                    {detail.organization?.name || "Organization"} · {label(detail.type)}
                  </p>
                  <h2 className="mt-1 break-words text-lg font-black text-cric-text">{detail.subject}</h2>
                  <p className="mt-1 text-xs font-semibold text-cric-muted">
                    By {detail.reporter?.name || "Unknown"} · {new Date(detail.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase ${statusClass[detail.status] || ""}`}>{label(detail.status)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words rounded-xl border border-cric-border bg-cric-bg p-4 text-sm font-semibold text-cric-text">{detail.description}</p>
              {detail.targetType ? (
                <p className="break-all text-xs font-bold text-cric-muted">Target: {detail.targetType} · {String(detail.targetId || "not linked")}</p>
              ) : null}

              <form onSubmit={sendReply} className="space-y-2">
                <label className="block text-xs font-black text-cric-text">
                  Admin reply
                  <textarea value={reply} onChange={(event) => setReply(event.target.value)} maxLength={5000} rows={4} className={`${fieldClass} mt-1 w-full`} />
                </label>
                <button type="submit" disabled={busy || !reply.trim()} className="min-h-11 rounded-lg bg-cric-accent px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                  {busy ? "Saving…" : "Save reply"}
                </button>
              </form>

              <div className="flex flex-wrap items-end gap-2 border-t border-cric-border pt-4">
                <label className="flex flex-col gap-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                  Change status
                  <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className={fieldClass}>
                    {STATUSES.map((value) => <option key={value} value={value}>{label(value)}</option>)}
                  </select>
                </label>
                <button type="button" onClick={saveStatus} disabled={busy} className={buttonClass}>Update status</button>
                {canApproveDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(true)}
                    disabled={busy}
                    className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    Approve and delete
                  </button>
                ) : null}
                {detail.type === "deletion_request" && !DELETABLE_TARGETS.has(detail.targetType) ? (
                  <p className="basis-full text-xs font-semibold text-cric-muted">
                    This target must be handled through its Admin management page.
                  </p>
                ) : null}
              </div>

              {detail.statusHistory?.length ? (
                <div className="border-t border-cric-border pt-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cric-muted">Status history</p>
                  <ul className="mt-2 space-y-1">
                    {detail.statusHistory.map((entry, index) => (
                      <li key={`${entry.status}-${entry.changedAt}-${index}`} className="text-xs font-semibold text-cric-muted">
                        {label(entry.status)} · {new Date(entry.changedAt).toLocaleString()} {entry.note ? `· ${entry.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {confirmDelete ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl border border-red-300 bg-cric-card p-5 shadow-2xl">
            <h2 className="text-lg font-black text-cric-text">Confirm deletion</h2>
            <p className="mt-2 text-sm font-semibold text-cric-muted">
              Delete the linked {detail?.targetType} for “{detail?.subject}”? This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className={buttonClass}>Cancel</button>
              <button type="button" onClick={approveDelete} disabled={busy} className="min-h-11 rounded-lg bg-red-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                {busy ? "Deleting…" : "Confirm delete"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
