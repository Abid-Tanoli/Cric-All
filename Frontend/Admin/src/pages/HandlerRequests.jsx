import React, { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { useToast } from "../components/Toast";
import ConfirmModal from "../components/ConfirmModal";

const FILTERS = [
  { value: "", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const statusStyles = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  approved: "bg-green-100 text-green-800 border-green-300",
  rejected: "bg-red-100 text-red-800 border-red-300",
};

const typeLabel = (type) => (type === "tournament" ? "Tournament" : "Team");

export default function HandlerRequests() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("");
  const [confirmModal, setConfirmModal] = useState(null);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/admin/handler-requests", { params: { status: filter } });
      setRequests(res.data.requests || []);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const resolve = async (id, action, note = "") => {
    try {
      await api.post(`/admin/handler-requests/${id}/${action}`, { note });
      showToast(
        action === "approve" ? "Request approved — record created" : "Request rejected",
        action === "approve" ? "success" : "warning"
      );
      loadRequests();
    } catch (err) {
      showToast(err.response?.data?.message || err.message || `Failed to ${action} request`, "error");
    }
  };

  const openApprove = (r) =>
    setConfirmModal({
      title: "Approve this request?",
      message: `This will create the ${typeLabel(r.type).toLowerCase()} "${r.details?.name}" and link it to ${r.user?.name || "the requester"}.`,
      confirmLabel: "Approve & Create",
      onConfirm: async () => {
        setConfirmModal(null);
        await resolve(r._id, "approve");
      },
    });

  const openReject = (r) =>
    setConfirmModal({
      title: "Reject this request?",
      message: `The request for "${r.details?.name}" will be marked rejected.`,
      confirmLabel: "Reject",
      variant: "danger",
      onConfirm: async () => {
        setConfirmModal(null);
        await resolve(r._id, "reject");
      },
    });

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-black uppercase tracking-tight text-cric-text">Handler Requests</h1>
          <p className="mt-1 text-xs font-semibold text-cric-muted">
            Cricket Handler / Organization Admin requests to create teams and tournaments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-lg border px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${
                filter === f.value
                  ? "border-cric-accent bg-cric-accent text-white"
                  : "border-cric-border bg-cric-card text-cric-muted hover:text-cric-text"
              }`}
            >
              {f.label}
              {f.value === "pending" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>}

      {loading ? (
        <p className="text-sm font-semibold text-cric-muted">Loading...</p>
      ) : requests.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cric-border bg-cric-card p-10 text-center">
          <p className="text-sm font-black text-cric-text">No requests found</p>
          <p className="mt-1 text-xs font-semibold text-cric-muted">Requests from handlers and org admins will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {requests.map((r) => (
            <div key={r._id} className="rounded-2xl border border-cric-border bg-cric-card p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-black text-cric-text">{r.details?.name || "Unnamed"}</h3>
                    <span className={`rounded-full border px-2.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${statusStyles[r.status] || statusStyles.pending}`}>
                      {r.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cric-muted">
                    {typeLabel(r.type)} · {r.details?.category || "Other"}
                    {r.details?.eventType ? ` · ${r.details.eventType.replace(/-/g, " ")}` : ""}
                    {r.details?.format ? ` · ${r.details.format}` : ""}
                  </p>
                </div>
                <div className="text-right text-[10px] font-bold text-cric-muted">
                  <p>{new Date(r.createdAt).toLocaleString()}</p>
                  {r.decidedAt && <p>Decided {new Date(r.decidedAt).toLocaleString()}</p>}
                </div>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-cric-border bg-cric-bg p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Requester</p>
                  <p className="mt-1 text-sm font-black text-cric-text">{r.user?.name || "Unknown"}</p>
                  <p className="text-xs font-semibold text-cric-muted">
                    {r.user?.email}
                    {r.user?.organizationName ? ` · ${r.user.organizationName}` : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-cric-border bg-cric-bg p-3">
                  <p className="text-[9px] font-black uppercase tracking-widest text-cric-muted">Details</p>
                  <p className="mt-1 text-sm font-semibold text-cric-muted">
                    {r.details?.description || "No notes provided."}
                    {r.details?.organization ? ` Organization: ${r.details.organization}` : ""}
                  </p>
                </div>
              </div>

              {r.adminNote && (
                <p className="mt-3 text-xs font-semibold text-cric-muted">
                  <span className="font-black uppercase tracking-widest">Admin note:</span> {r.adminNote}
                </p>
              )}

              {r.status === "approved" && r.resourceId && (
                <p className="mt-2 text-xs font-bold text-cric-text">
                  Created {r.resourceType}: <span className="text-cric-accent">{String(r.resourceId)}</span>
                </p>
              )}

              {r.status === "pending" && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => openApprove(r)}
                    className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Approve &amp; Create
                  </button>
                  <button
                    onClick={() => openReject(r)}
                    className="px-4 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 text-[10px] font-black uppercase tracking-widest transition-all"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {confirmModal && (
        <ConfirmModal
          open
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          variant={confirmModal.variant}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}