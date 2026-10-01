import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

// A real, throwaway MongoDB for tests that need persistence. The binary is
// downloaded once by mongodb-memory-server and cached outside the repo.
export async function startTestDb() {
  // Windows may need more than the upstream 10s default to start the bundled
  // mongod binary, especially while its first indexes are being initialized.
  const mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 30_000 } });
  await mongoose.connect(mongod.getUri(), { dbName: "cricall_test" });
  return mongod;
}

export async function stopTestDb(mongod) {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
  if (mongod) await mongod.stop();
}

export function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

export function mockReq(overrides = {}) {
  return { body: {}, params: {}, headers: {}, ...overrides };
}
