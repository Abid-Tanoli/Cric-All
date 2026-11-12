import { MongoMemoryServer } from "mongodb-memory-server";

const mongod = await MongoMemoryServer.create({
  instance: { port: 27017, dbName: "cric-all-e2e", launchTimeout: 60000 },
});
console.log(`READY ${mongod.getUri("cric-all-e2e")}`);
process.on("SIGTERM", async () => {
  await mongod.stop();
  process.exit(0);
});
setInterval(() => {}, 60_000);
