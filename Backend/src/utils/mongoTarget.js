export function getMongoTarget(mongoUrl) {
  if (!mongoUrl) {
    return { host: "", databaseName: "" };
  }

  try {
    const url = new URL(mongoUrl);
    return {
      host: url.host,
      databaseName: decodeURIComponent(url.pathname.replace(/^\//, "")),
    };
  } catch {
    return { host: "", databaseName: "" };
  }
}

export function assertMongoDatabaseName(mongoUrl) {
  const { databaseName } = getMongoTarget(mongoUrl);
  if (databaseName) return;

  const message = "Mongo URL is missing an explicit database name. Add one like /cric-all; otherwise MongoDB drivers default to the test database.";
  if (process.env.NODE_ENV === "production" || process.env.REQUIRE_MONGO_DB_NAME === "true") {
    throw new Error(message);
  }

  console.warn(message);
}
