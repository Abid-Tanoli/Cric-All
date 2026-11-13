import React, { useState } from "react";
import { createOrganizationIssue } from "../services/organizationApi";

const buttonStyles =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-cric-border bg-cric-card px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-text transition hover:border-cric-accent disabled:opacity-60";

export default function IssueReportButton({
  orgId,
  type = "issue",
  targetType,
  targetId,
  label = "Report an issue",
  initialSubject = "",
  className = buttonStyles,
  onCreated,
}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const openForm = () => {
    setSubject(initialSubject);
    setDescription("");
    setError("");
    setSubmitted(false);
    setOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await createOrganizationIssue(orgId, {
        type,
        subject: subject.trim(),
        description: description.trim(),
        ...(targetType ? { targetType } : {}),
        ...(targetId ? { targetId } : {}),
      });
      setSubmitted(true);
      window.dispatchEvent(new Event("bq-organization-issues-changed"));
      onCreated?.();
    } catch (requestError) {
      setError(requestError.response?.data?.message || requestError.message || "Could not send this report.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={openForm} className={className}>
        {label}
      </button>
      {open ? (
        <div className="fixed inset-0 z-[12000] flex items-center justify-center bg-black/60 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="issue-report-title"
            className="w-full max-w-lg rounded-2xl border border-cric-border bg-cric-card p-5 text-cric-text shadow-2xl sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="issue-report-title" className="text-lg font-black">
                  {type === "deletion_request" ? "Request deletion" : "Report an issue"}
                </h2>
                <p className="mt-1 text-xs font-semibold text-cric-muted">
                  Your report is visible to the platform administrators.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="min-h-11 min-w-11 rounded-lg border border-cric-border px-3 text-sm font-black text-cric-muted"
                aria-label="Close report form"
              >
                ×
              </button>
            </div>

            {submitted ? (
              <div className="mt-5 space-y-4">
                <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-4 text-sm font-bold text-green-800">
                  Report submitted. You can follow its status from My reports.
                </p>
                <button type="button" onClick={() => setOpen(false)} className={buttonStyles}>
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                {error ? (
                  <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
                    {error}
                  </p>
                ) : null}
                <label className="block text-xs font-black">
                  Subject *
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    required
                    maxLength={150}
                    className="mt-1 min-h-11 w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <label className="block text-xs font-black">
                  {type === "deletion_request" ? "Reason *" : "Description *"}
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    required
                    maxLength={5000}
                    rows={5}
                    className="mt-1 w-full rounded-lg border border-cric-border bg-cric-bg px-3 py-2 text-sm font-semibold"
                  />
                </label>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="min-h-11 rounded-lg border border-cric-border px-4 py-2 text-xs font-black uppercase tracking-widest text-cric-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !subject.trim() || !description.trim()}
                    className="min-h-11 rounded-lg bg-cric-accent px-5 py-2 text-xs font-black uppercase tracking-widest text-white disabled:opacity-60"
                  >
                    {busy ? "Sending…" : "Submit report"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
