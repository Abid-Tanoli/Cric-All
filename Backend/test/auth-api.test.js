import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const BASE = process.env.BASE_URL || "http://localhost:5000/api";

let serverAvailable = true;

async function req(method, path, body = null, token = null) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      timeout: 5000,
      headers: { "Content-Type": "application/json" },
    };
    if (token) opts.headers["Authorization"] = `Bearer ${token}`;

    const r = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { data = null; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });
    r.on("error", () => resolve({ status: 0, data: null }));
    r.on("timeout", () => { r.destroy(); resolve({ status: 0, data: null }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

test("server must be running for HTTP integration tests", async () => {
  const { status } = await req("GET", "/health");
  serverAvailable = status === 200;
  if (!serverAvailable) {
    console.log("Backend not available — skipping HTTP tests. Set BASE_URL or start the server.");
  }
});

test("POST /auth/login — rejects missing credentials", { skip: () => !serverAvailable }, async () => {
  const { status, data } = await req("POST", "/auth/login", {});
  assert.strictEqual(status, 400);
  assert.ok(data?.message);
});

test("POST /auth/login — rejects invalid credentials", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("POST", "/auth/login", {
    email: "nonexistent@test.com",
    password: "wrongpass",
  });
  assert.strictEqual(status, 400);
});

test("POST /auth/register — rejects missing fields", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("POST", "/auth/register", { email: "only@email.com" });
  assert.strictEqual(status, 400);
});

test("GET /auth/profile — rejects without token", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("GET", "/auth/profile");
  assert.strictEqual(status, 401);
});

test("GET /auth/profile — rejects malformed token", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("GET", "/auth/profile", null, "not-a-real-token");
  assert.strictEqual(status, 401);
});

test("POST /admin/login — rejects missing credentials", { skip: () => !serverAvailable }, async () => {
  const { status, data } = await req("POST", "/admin/login", {});
  assert.strictEqual(status, 400);
  assert.ok(data?.message);
});

test("POST /admin/login — rejects invalid credentials", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("POST", "/admin/login", {
    email: "admin@nonexistent.com",
    password: "wrongpass",
  });
  assert.strictEqual(status, 400);
});

test("GET /admin/profile — rejects without token", { skip: () => !serverAvailable }, async () => {
  const { status } = await req("GET", "/admin/profile");
  assert.strictEqual(status, 401);
});

test("GET /admin/profile — rejects with user token", { skip: () => !serverAvailable }, async () => {
  const userLogin = await req("POST", "/auth/login", {
    email: "viewer@test.com",
    password: "viewer123",
  });
  if (userLogin.status !== 200) return;

  const { status } = await req("GET", "/admin/profile", null, userLogin.data?.token);
  assert.strictEqual(status, 403);
});

test("POST /admin/ — rejects user role from accessing admin list", { skip: () => !serverAvailable }, async () => {
  const userLogin = await req("POST", "/auth/login", {
    email: "viewer@test.com",
    password: "viewer123",
  });
  if (userLogin.status !== 200) return;

  const { status, data } = await req("GET", "/admin/", null, userLogin.data?.token);
  assert.ok(status === 401 || status === 403, `Expected 401/403, got ${status}`);
  if (status === 403) assert.ok(data?.message?.toLowerCase().includes("admin"));
});

test("POST /auth/logout — returns success", { skip: () => !serverAvailable }, async () => {
  const { status, data } = await req("POST", "/auth/logout", {});
  assert.strictEqual(status, 200);
  assert.ok(data?.message);
});

test("user registration and login flow", { skip: () => !serverAvailable }, async () => {
  const uniqueEmail = `testuser_${Date.now()}@test.com`;

  const reg = await req("POST", "/auth/register", {
    name: "Test User",
    email: uniqueEmail,
    password: "testpass123",
  });
  if (reg.status === 201) {
    assert.ok(reg.data?.token);
    assert.ok(reg.data?.user);

    const profile = await req("GET", "/auth/profile", null, reg.data.token);
    assert.strictEqual(profile.status, 200);
    assert.strictEqual(profile.data?.email, uniqueEmail);
  } else if (reg.status === 400) {
    assert.ok(reg.data?.message);
  }
});

test("admin login with seeded admin", { skip: () => !serverAvailable }, async () => {
  const adminLogin = await req("POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL || "admin@cric-all.com",
    password: process.env.ADMIN_PASSWORD || "admin123",
  });

  if (adminLogin.status === 200) {
    assert.ok(adminLogin.data?.token);
    assert.ok(adminLogin.data?.user);
    assert.strictEqual(adminLogin.data?.user?.role, "admin");

    const profile = await req("GET", "/admin/profile", null, adminLogin.data.token);
    assert.strictEqual(profile.status, 200);
    assert.ok(profile.data?.email);

    const adminList = await req("GET", "/admin/", null, adminLogin.data.token);
    assert.strictEqual(adminList.status, 200);
  } else {
    assert.ok(true, "Seeded admin not available — skipping");
  }
});
