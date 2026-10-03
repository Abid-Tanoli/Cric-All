/**
 * Local-only fixture helpers for the security suites.
 *
 * These are the two things the public API cannot do, and both are needed to
 * build a complete actor matrix:
 *
 *   1. `POST /api/admin/register` closes as soon as one Admin document exists,
 *      and `DELETE /api/admin/:id` refuses to delete the caller's own account.
 *      A database that was empty when the suite started therefore has no way
 *      back to empty, so a self-bootstrapping suite cannot get a platform-admin
 *      principal without this.
 *   2. There is no endpoint that sets `User.status = "suspended"` at all, so the
 *      suspended actor cannot be produced through HTTP.
 *
 * Safety: the connection string is hardcoded to the disposable loopback
 * database and is re-checked on every call. There is no environment override,
 * so this module cannot be pointed at a remote cluster even by accident. It
 * never reads Backend/.env.
 *
 * These write *fixtures*, not results. No scoring, scorecard or verdict is ever
 * produced this way - every assertion in the suites goes through the HTTP API.
 */

import mongoose from "mongoose";
import Admin from "../../src/models/Admin.js";
import User from "../../src/models/User.js";

export const LOCAL_URI = "mongodb://127.0.0.1:27017/cric-all-e2e";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

function assertDisposableDb() {
  const url = new URL(LOCAL_URI);
  if (!LOOPBACK.has(url.hostname)) {
    throw new Error(`REFUSING TO WRITE: ${LOCAL_URI} is not loopback.`);
  }
  if (url.pathname.slice(1) !== "cric-all-e2e") {
    throw new Error(`REFUSING TO WRITE: expected the disposable database cric-all-e2e.`);
  }
}

export async function connectLocal() {
  assertDisposableDb();
  mongoose.set("strictQuery", true);
  await mongoose.connect(LOCAL_URI, { serverSelectionTimeoutMS: 5000 });
  return mongoose.connection;
}

export async function disconnectLocal() {
  await mongoose.disconnect();
}

/**
 * Empties the Admin collection so `POST /api/admin/register` reopens its
 * one-time bootstrap window. Returns how many were removed.
 */
export async function resetPlatformAdmins() {
  assertDisposableDb();
  await connectLocal();
  try {
    const { deletedCount } = await Admin.deleteMany({});
    return deletedCount ?? 0;
  } finally {
    await disconnectLocal();
  }
}

/**
 * Suspends a verified account so the suspended-actor rows in the matrix have
 * something real to run against. `authMiddleware` reads `User.status` on every
 * request, so the next call with that account's existing token is refused.
 */
export async function setUserSuspended(email) {
  assertDisposableDb();
  await connectLocal();
  try {
    const res = await User.updateOne({ email: String(email).toLowerCase() }, { $set: { status: "suspended" } });
    return res.matchedCount === 1;
  } finally {
    await disconnectLocal();
  }
}

/** Reactivates an account, so a suite can clean up after itself. */
export async function setUserActive(email) {
  assertDisposableDb();
  await connectLocal();
  try {
    const res = await User.updateOne({ email: String(email).toLowerCase() }, { $set: { status: "active" } });
    return res.matchedCount === 1;
  } finally {
    await disconnectLocal();
  }
}

/**
 * Creates the platform-admin principal for the cross-tenant suite.
 *
 * This used to go through POST /admin/register. That route is now gated on
 * ALLOW_ADMIN_REGISTER, which is read by the *server* process - a test process
 * setting the variable for itself changes nothing about the running server. So
 * the admin is written straight into the disposable database instead, which also
 * matches how the suspended actor is built.
 *
 * `Admin.create` runs the model's pre-save hook, so the password is bcrypt
 * hashed exactly as a real registration would be, and the bootstrap claim is set
 * so this account also closes the HTTP bootstrap window.
 */
export async function createPlatformAdmin({ name, email, password }) {
  assertDisposableDb();
  await connectLocal();
  try {
    const admin = await Admin.create({
      name,
      email: String(email).toLowerCase(),
      password,
      role: "superadmin",
      bootstrapClaim: "first-admin",
    });
    return { id: String(admin._id), email: admin.email, role: admin.role };
  } finally {
    await disconnectLocal();
  }
}
