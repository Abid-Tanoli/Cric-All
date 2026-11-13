import React from "react";
import IssueReportButton from "./IssueReportButton";

export default function RequestDeletionButton({
  orgId,
  label = "Request deletion",
  targetType,
  targetId,
  subject,
  className = "rounded-lg border border-red-300 bg-white px-5 py-2 text-[10px] font-black uppercase tracking-widest text-red-600 transition hover:bg-red-50",
  onCreated,
}) {
  return (
    <IssueReportButton
      orgId={orgId}
      type="deletion_request"
      targetType={targetType}
      targetId={targetId}
      label={label}
      initialSubject={subject || `Deletion request: ${label.replace(/^Request\s+/i, "")}`}
      className={className}
      onCreated={onCreated}
    />
  );
}
