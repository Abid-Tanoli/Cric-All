import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../utils/db.js";
import { seedLocations } from "../seed/locations.js";

// Idempotent: inserts only missing nodes. Safe to run on every deploy.
//   npm run seed:locations
const run = async () => {
  const connection = await connectDB();
  if (!connection) {
    console.error("Cannot seed locations: MongoDB is not reachable. Set MONGO_URL / MONGODB_URI.");
    process.exit(1);
  }

  const result = await seedLocations({
    onProgress: (counts) => {
      console.log(
        `created countries=${counts.countries} provinces=${counts.provinces} ` +
          `districts=${counts.districts} cities=${counts.cities} towns=${counts.towns} ` +
          `(existing skipped=${counts.skipped})`
      );
    },
  });

  console.log(`Location seed v${result.version} complete: ${result.totalSeeded} nodes created this run.`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Location seed failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
