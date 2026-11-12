import express from "express";
import mongoose from "mongoose";
import tournamentContentRoutes from "../src/routes/tournamentContentRoutes.js";

await mongoose.connect("mongodb://127.0.0.1:27017/cric-all-e2e", { serverSelectionTimeoutMS: 10000 });
const app = express();
app.use(express.json());
app.use("/api/tournaments", tournamentContentRoutes);
const server = app.listen(5055, "127.0.0.1", () => console.log("PUBLIC API READY 5055"));
process.on("SIGTERM", async () => {
  server.close();
  await mongoose.disconnect();
  process.exit(0);
});
