import test from "node:test";
import assert from "node:assert/strict";
import { requireAdmin, requireSuperAdmin } from "../src/middleware/authMiddleware.js";

function call(handler, req) {
  let status = 0;
  let body = null;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  const next = (err) => ({ nextCalled: true, err });
  handler(req, res, next);
  return { status, body };
}

test("requireAdmin rejects requests without an authenticated principal", () => {
  const { status, body } = call(requireAdmin, {});
  assert.equal(status, 401);
  assert.match(body.message, /Not authorized/);
});

test("requireAdmin rejects non-admin roles", () => {
  const { status, body } = call(requireAdmin, { user: { role: "user" } });
  assert.equal(status, 403);
  assert.match(body.message, /Admin role required/);
});

test("requireAdmin accepts admin and superadmin roles", () => {
  const adminResult = call(requireAdmin, { user: { role: "admin" } });
  assert.equal(adminResult.status, 0);
  const superResult = call(requireAdmin, { user: { role: "superadmin" } });
  assert.equal(superResult.status, 0);
});

test("requireSuperAdmin only accepts superadmin", () => {
  assert.equal(call(requireSuperAdmin, {}).status, 401);
  assert.equal(call(requireSuperAdmin, { user: { role: "admin" } }).status, 403);
  assert.equal(call(requireSuperAdmin, { user: { role: "user" } }).status, 403);
  const ok = call(requireSuperAdmin, { user: { role: "superadmin" } });
  assert.equal(ok.status, 0);
});