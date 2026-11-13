import React, { useCallback, useEffect, useState } from "react";
import { listOrganizationIssues } from "../../services/organizationApi";
import { Banner, card, cardSubtle, sectionTitle } from "./orgStyles";

const statusStyles = {
  open: "border-amber-300 bg-amber-50 text-amber-900",
  in_review: "border-blue-300 bg-blue-50 text-blue-900",
  resolved: "border-green-300 bg-green-50 text-green-900",
  rejected: "border-red-300 bg-red-50 text-red-900",
};

const formatStatus = (status) => String(status || "").replace("_", " ");

export default function OrgIssueReports({ orgId }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await listOrganizationIssues(orgId);
      setItems(Array.isArray(response?.items) ? response.items : []);
    } catch (requestError) {
      setError(requestError.message || "Could not load reports.");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    window.addEventListener("bq-organization-issues-changed", load);
    return () => window.removeEventListener("bq-organization-issues-changed", load);
  }, [load]);

  return (
    <section className={card}>
      <h2 className={sectionTitle}>My reports</h2>
      <p className="mt-1 text-xs font-semibold text-cric-muted">
        Review report status and replies from the platform administrators.
      </p>
      {error ? <div className="mt-4"><Banner kind="error">{error}</Banner></div> : null}
      {loading ? (
        <p className="mt-4 text-sm font-semibold text-cric-muted">Loading reports…</p>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-cric-border p-6 text-center">
          <p className="text-sm font-bold">No reports yet</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {items.map((report) => (
            <article key={report._id} className={cardSubtle}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-black">{report.subject}</h3>
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-cric-muted">
                    {report.type.replace("_", " ")} · {new Date(report.createdAt).toLocaleDateString()}
                    {report.targetType ? ` · ${report.targetType}` : ""}
                  </p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusStyles[report.status] || ""}`}>
                  {formatStatus(report.status)}
                </span>
              </div>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm font-semibold text-cric-muted">{report.description}</p>
              {report.adminReply ? (
                <div className="mt-3 rounded-lg border border-cric-border bg-cric-bg p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cric-accent">Admin reply</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold">{report.adminReply}</p>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
