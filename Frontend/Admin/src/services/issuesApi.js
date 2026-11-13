import api from "./api";

const unwrap = (promise) => promise.then((response) => response.data);

export const listIssues = (params = {}) => unwrap(api.get("/admin/issues", { params }));
export const getIssue = (issueId) => unwrap(api.get(`/admin/issues/${issueId}`));
export const getOpenIssueCount = () => unwrap(api.get("/admin/issues/open-count"));
export const replyToIssue = (issueId, adminReply) =>
  unwrap(api.post(`/admin/issues/${issueId}/reply`, { adminReply }));
export const updateIssueStatus = (issueId, payload) =>
  unwrap(api.patch(`/admin/issues/${issueId}/status`, payload));
export const approveAndDeleteIssue = (issueId) =>
  unwrap(api.post(`/admin/issues/${issueId}/approve-delete`));
