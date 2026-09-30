// Auth/account calls, in one place.
//
// Like the other service wrappers, this file only describes paths and response
// shapes. Every authorization rule is enforced server-side.

import { api } from "./api";

const unwrap = (promise) => promise.then((res) => res.data);

/** This account's own profile. */
export const getProfile = () => unwrap(api.get("/auth/profile"));

/**
 * Delete this account for good.
 *
 * Rejects with `409 ACCOUNT_OWNS_ORGANIZATION` when the person is the last
 * owner of an organization, since an org must always keep an owner. That error
 * carries `organizations` so the UI can name which ones need a new owner.
 */
export const deleteAccount = () => unwrap(api.delete("/auth/account"));